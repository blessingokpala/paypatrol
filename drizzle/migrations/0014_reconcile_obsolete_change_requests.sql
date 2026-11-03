CREATE OR REPLACE FUNCTION public.has_open_change_request(_pid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.supplier_change_requests
    WHERE purchase_id = _pid AND status IN ('pending_verification','verified_pending_decision'));
$$;

-- Closes only change requests made obsolete by a later approved baseline that already
-- equals the proposed recipient. Never marks them approved or verified; history is kept.
CREATE OR REPLACE FUNCTION public.reconcile_obsolete_change_requests(_supplier uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s public.suppliers%rowtype; cur public.supplier_versions%rowtype; base public.supplier_versions%rowtype; r record; n integer := 0;
BEGIN
  SELECT * INTO s FROM public.suppliers WHERE id = _supplier;
  IF NOT FOUND OR s.current_version_id IS NULL THEN RETURN 0; END IF;
  SELECT * INTO cur FROM public.supplier_versions WHERE id = s.current_version_id;
  IF cur.status <> 'active' OR cur.approved_at IS NULL THEN RETURN 0; END IF;
  FOR r IN SELECT * FROM public.supplier_change_requests
    WHERE supplier_id = _supplier AND status IN ('pending_verification','verified_pending_decision')
      AND base_version_id <> cur.id AND lower(trim(proposed_recipient)) = lower(trim(cur.paypal_merchant_id))
    FOR UPDATE
  LOOP
    SELECT * INTO base FROM public.supplier_versions WHERE id = r.base_version_id;
    UPDATE public.supplier_change_requests SET status = 'superseded', decided_at = now(), resulting_version_id = cur.id,
      decision_note = format('Obsolete: its base supplier record v%s was superseded by approved record v%s, which already lists this recipient. Not independently verified through this request.', base.version, cur.version)
    WHERE id = r.id;
    PERFORM public.log_audit(r.org_id, 'supplier_change_superseded', 'supplier_change_request', r.id, null,
      jsonb_build_object('purchase_id', r.purchase_id, 'previous_status', r.status, 'base_version', base.version,
        'current_version', cur.version, 'current_version_id', cur.id, 'proposed_recipient', r.proposed_recipient,
        'independent_verification_recorded', false), 'system');
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.reconcile_obsolete_change_requests(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.reconcile_on_supplier_version() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN PERFORM public.reconcile_obsolete_change_requests(new.id); RETURN new; END $$;
DROP TRIGGER IF EXISTS reconcile_obsolete_change_requests ON public.suppliers;
CREATE TRIGGER reconcile_obsolete_change_requests AFTER UPDATE OF current_version_id ON public.suppliers
FOR EACH ROW WHEN (new.current_version_id IS DISTINCT FROM old.current_version_id)
EXECUTE FUNCTION public.reconcile_on_supplier_version();

-- Server-side hold: no reservation, order or capture while any change request is open.
CREATE OR REPLACE FUNCTION public.guard_open_change_request() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.has_open_change_request(new.purchase_id) THEN
    RAISE EXCEPTION 'A supplier recipient change for this request is still awaiting verification. Payment is held.';
  END IF;
  RETURN new;
END $$;
DROP TRIGGER IF EXISTS hold_reservation_on_open_change ON public.budget_reservations;
CREATE TRIGGER hold_reservation_on_open_change BEFORE INSERT ON public.budget_reservations
FOR EACH ROW EXECUTE FUNCTION public.guard_open_change_request();
DROP TRIGGER IF EXISTS hold_attempt_on_open_change ON public.payment_attempts;
CREATE TRIGGER hold_attempt_on_open_change BEFORE INSERT ON public.payment_attempts
FOR EACH ROW EXECUTE FUNCTION public.guard_open_change_request();
DROP TRIGGER IF EXISTS hold_capture_on_open_change ON public.payment_attempts;
CREATE TRIGGER hold_capture_on_open_change BEFORE UPDATE OF status ON public.payment_attempts
FOR EACH ROW WHEN (new.status = 'capturing' AND old.status IS DISTINCT FROM new.status)
EXECUTE FUNCTION public.guard_open_change_request();

CREATE OR REPLACE FUNCTION public.evaluate_purchase(_pid uuid)
 RETURNS purchase_status LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_status public.purchase_status; p public.purchases%rowtype;
        v_quote_name text; v_quote_qty integer; v_quote_unit bigint; v_quote_total bigint;
        v_quote_currency text; v_quote_max integer; v_found boolean;
begin
  v_status := public.evaluate_purchase_core(_pid);
  select * into p from public.purchases where id = _pid;
  select l.name, li.quantity, li.unit_price_minor, li.line_total_minor, l.currency, l.max_quantity
    into v_quote_name, v_quote_qty, v_quote_unit, v_quote_total, v_quote_currency, v_quote_max
  from public.purchase_line_items li join public.listings l on l.id = li.listing_id
  where li.purchase_id = _pid and li.listing_id is not null order by li.created_at limit 1;
  v_found := found;
  if v_found and not (v_quote_total = p.total_minor and v_quote_currency = p.currency and v_quote_qty <= v_quote_max) then
    insert into public.findings(org_id,purchase_id,purchase_version,code,severity,message,next_action)
    values (p.org_id,_pid,p.version,'AMOUNT_DIFFERS_FROM_QUOTE','warning',
      format('The request asks for %s %s but the approved quote for "%s" (%s × %s = %s %s) differs%s. Both values are kept; neither was overwritten.',
        to_char(p.total_minor/100.0,'FM999999990.00'), p.currency, v_quote_name, v_quote_qty,
        to_char(v_quote_unit/100.0,'FM999999990.00'), to_char(v_quote_total/100.0,'FM999999990.00'), v_quote_currency,
        case when v_quote_qty > v_quote_max then ' and the quantity is above the listing limit of '||v_quote_max else '' end),
      'Resolve the difference before paying: correct the request or ask the supplier to re-issue it.');
    if v_status in ('cleared_for_checkout','approval_required') then
      update public.purchases set status = 'needs_clarification', updated_at = now() where id = _pid;
      perform public.log_audit(p.org_id,'status_changed','purchase',_pid,p.version,jsonb_build_object('from',v_status,'to','needs_clarification'),'system');
      v_status := 'needs_clarification';
    end if;
  end if;
  if public.has_open_change_request(_pid) and not exists (
      select 1 from public.findings where purchase_id=_pid and purchase_version=p.version and code='RECIPIENT_CHANGED') then
    insert into public.findings(org_id,purchase_id,purchase_version,code,severity,message,next_action)
    values (p.org_id,_pid,p.version,'CHANGE_REQUEST_UNRESOLVED','warning',
      'A supplier recipient change linked to this request is still awaiting independent verification.',
      'A different authorised reviewer must verify or reject it before payment.');
    if v_status in ('cleared_for_checkout','approval_required') then
      update public.purchases set status = 'verification_required', updated_at = now() where id = _pid;
      perform public.log_audit(p.org_id,'status_changed','purchase',_pid,p.version,jsonb_build_object('from',v_status,'to','verification_required'),'system');
      v_status := 'verification_required';
    end if;
  end if;
  return v_status;
end $function$;
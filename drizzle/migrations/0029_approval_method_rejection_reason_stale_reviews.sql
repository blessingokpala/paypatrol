ALTER TABLE public.approvals ADD COLUMN IF NOT EXISTS approval_method text;

DROP FUNCTION IF EXISTS public.approve_purchase(uuid, integer, text);
CREATE FUNCTION public.approve_purchase(_pid uuid, _version int, _note text default null, _via text default 'individual') RETURNS public.purchase_status
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
declare p public.purchases%rowtype; v_status public.purchase_status; v_via text;
begin
  v_via := case when _via = 'batch' then 'batch' else 'individual' end;
  select * into p from public.purchases where id = _pid;
  if not found then raise exception 'Purchase not found'; end if;
  if not (public.has_org_role(p.org_id,'payer') or public.has_org_role(p.org_id,'owner')) then raise exception 'Only payers or owners can approve purchases'; end if;
  if p.requested_by = auth.uid() then raise exception 'The requester cannot approve their own request'; end if;
  v_status := public.evaluate_purchase(_pid);
  select * into p from public.purchases where id = _pid;
  if p.version <> _version then raise exception 'This request changed (now version %). Review the current version before approving.', p.version; end if;
  if v_status <> 'approval_required' then raise exception 'This request cannot be approved in status %. Hard limits and verification holds cannot be overridden by approval.', v_status; end if;
  insert into public.approvals(org_id,purchase_id,purchase_version,digest,amount_minor,currency,recipient,supplier_version_id,policy_version_id,approver_id,note,approval_method)
  values (p.org_id,_pid,p.version,p.digest,p.total_minor,p.currency,p.requested_recipient,p.supplier_version_id,p.policy_version_id,auth.uid(),nullif(trim(_note),''),v_via);
  perform public.log_audit(p.org_id,'purchase_approved','purchase',_pid,p.version,jsonb_build_object('digest',p.digest,'amount_minor',p.total_minor,'currency',p.currency,'recipient',p.requested_recipient,'method',v_via));
  return public.evaluate_purchase(_pid);
end $$;
REVOKE ALL ON FUNCTION public.approve_purchase(uuid, integer, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_purchase(uuid, integer, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.decide_supplier_change(_cr uuid, _approve boolean, _note text) returns void
language plpgsql security definer set search_path = public as $$
declare cr public.supplier_change_requests%rowtype; sv public.supplier_versions%rowtype; v_new uuid; r record;
begin
  select * into cr from public.supplier_change_requests where id = _cr for update;
  if not found then raise exception 'Change request not found'; end if;
  if not (public.has_org_role(cr.org_id,'change_approver') or public.has_org_role(cr.org_id,'owner')) then raise exception 'Only change approvers or owners can decide'; end if;
  if cr.proposed_by = auth.uid() then raise exception 'The person who submitted this change cannot decide it'; end if;
  if exists (select 1 from public.purchases where id = cr.purchase_id and requested_by = auth.uid()) then raise exception 'The person who created this request cannot decide its supplier change'; end if;
  if cr.status not in ('pending_verification','verified_pending_decision') then raise exception 'This change is no longer open (status %)', cr.status; end if;
  if _approve then
    if not exists (select 1 from public.verification_records where change_request_id=_cr and outcome='confirmed' and reviewer_id <> cr.proposed_by) then
      raise exception 'Approval requires a confirmed verification through the trusted channel'; end if;
    if exists (select 1 from public.verification_records where change_request_id=_cr and outcome in ('denied','unreachable')
               and created_at > coalesce((select max(created_at) from public.verification_records where change_request_id=_cr and outcome='confirmed'), '-infinity')) then
      raise exception 'The latest verification did not confirm the change'; end if;
    select * into sv from public.supplier_versions where id = cr.base_version_id;
    update public.supplier_versions set status='superseded' where supplier_id = cr.supplier_id and status='active';
    insert into public.supplier_versions(org_id,supplier_id,version,paypal_merchant_id,recipient_email,trusted_contact_channel,trusted_contact_value,verification_evidence,enrolment_status,status,created_by,approved_by,approved_at)
    values (cr.org_id,cr.supplier_id,(select max(version)+1 from public.supplier_versions where supplier_id=cr.supplier_id),cr.proposed_recipient,sv.recipient_email,
      sv.trusted_contact_channel,sv.trusted_contact_value,'Recipient change confirmed via trusted channel. See verification records for change request '||_cr,'not_enrolled','active',cr.proposed_by,auth.uid(),now())
    returning id into v_new;
    update public.suppliers set current_version_id = v_new where id = cr.supplier_id;
    update public.supplier_change_requests set status='approved', decided_by=auth.uid(), decided_at=now(), decision_note=nullif(trim(_note),''), resulting_version_id=v_new where id=_cr;
    perform public.log_audit(cr.org_id,'supplier_change_approved','supplier',cr.supplier_id,null,jsonb_build_object('change_request',_cr,'purchase_id',cr.purchase_id,'new_recipient',cr.proposed_recipient,'enrolment','not_enrolled'));
    for r in select id from public.purchases where supplier_id = cr.supplier_id and status not in ('payment_pending','paid','failed','cancelled') loop
      perform public.invalidate_approvals(r.id, 'Supplier record changed');
      perform public.evaluate_purchase(r.id);
    end loop;
  else
    if coalesce(trim(_note),'') = '' then raise exception 'Enter a reason for rejecting this supplier change'; end if;
    update public.supplier_change_requests set status='rejected', decided_by=auth.uid(), decided_at=now(), decision_note=trim(_note) where id=_cr;
    perform public.log_audit(cr.org_id,'supplier_change_rejected','supplier',cr.supplier_id,null,jsonb_build_object('change_request',_cr,'purchase_id',cr.purchase_id,'rejected_recipient',cr.proposed_recipient,'retained_version_id',cr.base_version_id,'reason',trim(_note)));
    if cr.purchase_id is not null then perform public.evaluate_purchase(cr.purchase_id); end if;
  end if;
end $$;

-- A change request whose proposed recipient is no longer what its request asks for
-- (because the request was edited) describes an earlier version. It is marked superseded,
-- never approved or verified; history is kept and audited.
CREATE OR REPLACE FUNCTION public.supersede_stale_change_requests(_pid uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p public.purchases%rowtype; r record; n integer := 0;
BEGIN
  SELECT * INTO p FROM public.purchases WHERE id = _pid;
  IF NOT FOUND THEN RETURN 0; END IF;
  FOR r IN SELECT * FROM public.supplier_change_requests
    WHERE purchase_id = _pid AND status IN ('pending_verification','verified_pending_decision')
      AND lower(trim(proposed_recipient)) IS DISTINCT FROM lower(trim(coalesce(p.requested_recipient,'')))
    FOR UPDATE
  LOOP
    UPDATE public.supplier_change_requests SET status='superseded', decided_at=now(),
      decision_note=format('Earlier history: the request was edited (now v%s) and no longer asks to pay "%s". Not verified or approved.', p.version, r.proposed_recipient)
    WHERE id = r.id;
    PERFORM public.log_audit(r.org_id,'supplier_change_superseded','supplier_change_request',r.id,p.version,
      jsonb_build_object('purchase_id',_pid,'previous_status',r.status,'proposed_recipient',r.proposed_recipient,
        'current_requested_recipient',p.requested_recipient,'reason','request_edited','independent_verification_recorded',false),'system');
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.supersede_stale_change_requests(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.evaluate_purchase(_pid uuid)
 RETURNS purchase_status LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_status public.purchase_status; p public.purchases%rowtype;
        v_quote_name text; v_quote_qty integer; v_quote_unit bigint; v_quote_total bigint;
        v_quote_currency text; v_quote_max integer; v_found boolean;
begin
  perform public.supersede_stale_change_requests(_pid);
  v_status := public.evaluate_purchase_core(_pid);
  select * into p from public.purchases where id = _pid;
  update public.findings set next_action = 'Do not pay this recipient. Cancel the request, or correct it only if the source invoice and independent evidence support a different recipient (a correction creates a new version and reruns all checks).'
    where purchase_id = _pid and purchase_version = p.version and code = 'RECIPIENT_CHANGE_REJECTED';
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
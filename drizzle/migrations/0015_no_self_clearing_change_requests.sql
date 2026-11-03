-- The actor who replaced the baseline is the creator of the new current version.
-- Requests proposed by, or attached to purchases submitted by, that actor stay open for
-- independent verification: a requester can never clear their own change by replacing the record.
CREATE OR REPLACE FUNCTION public.reconcile_obsolete_change_requests(_supplier uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s public.suppliers%rowtype; cur public.supplier_versions%rowtype; base public.supplier_versions%rowtype; r record; n integer := 0;
BEGIN
  SELECT * INTO s FROM public.suppliers WHERE id = _supplier;
  IF NOT FOUND OR s.current_version_id IS NULL THEN RETURN 0; END IF;
  SELECT * INTO cur FROM public.supplier_versions WHERE id = s.current_version_id;
  IF cur.status <> 'active' OR cur.approved_at IS NULL OR cur.created_by IS NULL THEN RETURN 0; END IF;
  FOR r IN SELECT c.* FROM public.supplier_change_requests c LEFT JOIN public.purchases p ON p.id = c.purchase_id
    WHERE c.supplier_id = _supplier AND c.status IN ('pending_verification','verified_pending_decision')
      AND c.base_version_id <> cur.id AND lower(trim(c.proposed_recipient)) = lower(trim(cur.paypal_merchant_id))
      AND c.proposed_by <> cur.created_by AND c.proposed_by IS DISTINCT FROM cur.approved_by
      AND p.requested_by IS DISTINCT FROM cur.created_by AND p.requested_by IS DISTINCT FROM cur.approved_by
    FOR UPDATE OF c
  LOOP
    SELECT * INTO base FROM public.supplier_versions WHERE id = r.base_version_id;
    UPDATE public.supplier_change_requests SET status = 'superseded', decided_at = now(), resulting_version_id = cur.id,
      decision_note = format('Obsolete: its base supplier record v%s was superseded by approved record v%s (set by a different person), which already lists this recipient. Not independently verified through this request.', base.version, cur.version)
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

-- A superseded request is closed; only an audited reopening back to pending is allowed.
CREATE OR REPLACE FUNCTION public.guard_superseded_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF old.status = 'superseded' AND new.status NOT IN ('superseded','pending_verification') THEN
    RAISE EXCEPTION 'A superseded change request cannot be approved or rejected';
  END IF;
  RETURN new;
END $$;
DROP TRIGGER IF EXISTS guard_superseded_change ON public.supplier_change_requests;
CREATE TRIGGER guard_superseded_change BEFORE UPDATE OF status ON public.supplier_change_requests
FOR EACH ROW EXECUTE FUNCTION public.guard_superseded_change();

-- Audited reopening of a request closed in error. Only the service role may call it.
CREATE OR REPLACE FUNCTION public.reopen_change_request(_cr uuid, _reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cr public.supplier_change_requests%rowtype;
BEGIN
  SELECT * INTO cr FROM public.supplier_change_requests WHERE id = _cr FOR UPDATE;
  IF cr.status <> 'superseded' THEN RAISE EXCEPTION 'Only a superseded request can be reopened'; END IF;
  UPDATE public.supplier_change_requests SET status = 'pending_verification', decided_at = null, resulting_version_id = null,
    decision_note = 'Reopened: ' || _reason WHERE id = _cr;
  PERFORM public.log_audit(cr.org_id, 'supplier_change_reopened', 'supplier_change_request', _cr, null,
    jsonb_build_object('purchase_id', cr.purchase_id, 'previous_status', 'superseded', 'previous_note', cr.decision_note, 'reason', _reason), 'system');
  IF cr.purchase_id IS NOT NULL THEN PERFORM public.evaluate_purchase(cr.purchase_id); END IF;
END $$;
REVOKE ALL ON FUNCTION public.reopen_change_request(uuid, text) FROM PUBLIC, anon, authenticated;

-- Approving a verified change whose recipient the current approved record already lists
-- confirms it without creating a duplicate, unenrolled record.
CREATE OR REPLACE FUNCTION public.decide_supplier_change(_cr uuid, _approve boolean, _note text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare cr public.supplier_change_requests%rowtype; sv public.supplier_versions%rowtype; cur public.supplier_versions%rowtype; v_new uuid; r record;
begin
  select * into cr from public.supplier_change_requests where id = _cr for update;
  if not found then raise exception 'Change request not found'; end if;
  if not (public.has_org_role(cr.org_id,'change_approver') or public.has_org_role(cr.org_id,'owner')) then raise exception 'Only change approvers or owners can decide'; end if;
  if cr.proposed_by = auth.uid() then raise exception 'The person who submitted this change cannot decide it'; end if;
  if cr.status in ('approved','rejected','superseded') then raise exception 'Already decided'; end if;
  if _approve then
    if not exists (select 1 from public.verification_records where change_request_id=_cr and outcome='confirmed' and reviewer_id <> cr.proposed_by) then
      raise exception 'Approval requires a confirmed verification through the trusted channel'; end if;
    if exists (select 1 from public.verification_records where change_request_id=_cr and outcome in ('denied','unreachable')
               and created_at > coalesce((select max(created_at) from public.verification_records where change_request_id=_cr and outcome='confirmed'), '-infinity')) then
      raise exception 'The latest verification did not confirm the change'; end if;
    select v.* into cur from public.supplier_versions v join public.suppliers s on s.current_version_id = v.id where s.id = cr.supplier_id;
    if cur.id is not null and cur.status = 'active' and lower(trim(cur.paypal_merchant_id)) = lower(trim(cr.proposed_recipient)) then
      update public.supplier_change_requests set status='approved', decided_by=auth.uid(), decided_at=now(), decision_note=_note, resulting_version_id=cur.id where id=_cr;
      perform public.log_audit(cr.org_id,'supplier_change_approved','supplier',cr.supplier_id,cur.version,jsonb_build_object('change_request',_cr,'new_recipient',cr.proposed_recipient,'confirmed_existing_version',cur.version));
    else
      select * into sv from public.supplier_versions where id = cr.base_version_id;
      update public.supplier_versions set status='superseded' where supplier_id = cr.supplier_id and status='active';
      insert into public.supplier_versions(org_id,supplier_id,version,paypal_merchant_id,recipient_email,trusted_contact_channel,trusted_contact_value,verification_evidence,enrolment_status,status,created_by,approved_by,approved_at)
      values (cr.org_id,cr.supplier_id,(select max(version)+1 from public.supplier_versions where supplier_id=cr.supplier_id),cr.proposed_recipient,sv.recipient_email,
        sv.trusted_contact_channel,sv.trusted_contact_value,'Recipient change confirmed via trusted channel. See verification records for change request '||_cr,'not_enrolled','active',cr.proposed_by,auth.uid(),now())
      returning id into v_new;
      update public.suppliers set current_version_id = v_new where id = cr.supplier_id;
      update public.supplier_change_requests set status='approved', decided_by=auth.uid(), decided_at=now(), decision_note=_note, resulting_version_id=v_new where id=_cr;
      perform public.log_audit(cr.org_id,'supplier_change_approved','supplier',cr.supplier_id,null,jsonb_build_object('change_request',_cr,'new_recipient',cr.proposed_recipient,'enrolment','not_enrolled'));
    end if;
    for r in select id from public.purchases where supplier_id = cr.supplier_id and status not in ('payment_pending','paid','failed','cancelled') loop
      perform public.invalidate_approvals(r.id, 'Supplier record changed');
      perform public.evaluate_purchase(r.id);
    end loop;
  else
    update public.supplier_change_requests set status='rejected', decided_by=auth.uid(), decided_at=now(), decision_note=_note where id=_cr;
    perform public.log_audit(cr.org_id,'supplier_change_rejected','supplier',cr.supplier_id,null,jsonb_build_object('change_request',_cr,'rejected_recipient',cr.proposed_recipient));
    if cr.purchase_id is not null then perform public.evaluate_purchase(cr.purchase_id); end if;
  end if;
end $function$;
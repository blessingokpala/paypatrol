CREATE OR REPLACE FUNCTION public.evaluate_purchase_core(_pid uuid)
 RETURNS purchase_status
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  p public.purchases%rowtype;
  pol public.spending_policies%rowtype;
  sup public.suppliers%rowtype;
  sv public.supplier_versions%rowtype;
  li record;
  has_block boolean := false;
  needs_verif boolean := false;
  needs_clar boolean := false;
  v_committed bigint;
  v_status public.purchase_status;
  v_digest text;
  cr public.supplier_change_requests%rowtype;
begin
  select * into p from public.purchases where id = _pid for update;
  if not found then raise exception 'Purchase not found'; end if;
  if p.status in ('payment_pending','paid','failed','cancelled') then return p.status; end if;

  select * into pol from public.spending_policies where id = public.active_policy_id(p.org_id);
  if p.supplier_id is not null then
    select * into sup from public.suppliers where id = p.supplier_id;
    select * into sv from public.supplier_versions where id = sup.current_version_id;
  end if;

  update public.purchases set policy_version_id = pol.id, supplier_version_id = sv.id where id = _pid;
  p.policy_version_id := pol.id; p.supplier_version_id := sv.id;

  delete from public.findings where purchase_id = _pid and purchase_version = p.version;

  if pol.id is null then
    insert into public.findings(org_id,purchase_id,purchase_version,code,severity,message,next_action)
    values (p.org_id,_pid,p.version,'NO_POLICY','block','No active spending rules exist for this organisation.','An owner must set spending rules.');
    has_block := true;
  end if;

  if sup.id is null then
    insert into public.findings(org_id,purchase_id,purchase_version,code,severity,message,next_action)
    values (p.org_id,_pid,p.version,'NO_SUPPLIER','warning','This request is not matched to an approved supplier.','Match it to an approved supplier or add the supplier through verification.');
    needs_clar := true;
  elsif sup.status <> 'active' then
    insert into public.findings(org_id,purchase_id,purchase_version,code,severity,message,next_action)
    values (p.org_id,_pid,p.version,'SUPPLIER_NOT_ACTIVE','block','Supplier "'||sup.name||'" is not an approved active supplier.','Complete supplier approval by a second authorised person.');
    has_block := true;
  end if;

  if p.total_minor <= 0 then
    insert into public.findings(org_id,purchase_id,purchase_version,code,severity,message,next_action)
    values (p.org_id,_pid,p.version,'MISSING_AMOUNT','warning','The amount is missing or not positive.','Correct the amount.');
    needs_clar := true;
  end if;
  if p.source = 'invoice' and coalesce(trim(p.invoice_reference),'') = '' then
    insert into public.findings(org_id,purchase_id,purchase_version,code,severity,message,next_action)
    values (p.org_id,_pid,p.version,'MISSING_INVOICE_REF','warning','The invoice reference is missing.','Enter the invoice reference.');
    needs_clar := true;
  end if;
  if coalesce(trim(p.requested_recipient),'') = '' and sup.id is not null then
    insert into public.findings(org_id,purchase_id,purchase_version,code,severity,message,next_action)
    values (p.org_id,_pid,p.version,'MISSING_RECIPIENT','warning','The payment recipient is missing.','Enter the recipient shown on the invoice.');
    needs_clar := true;
  end if;

  if pol.id is not null then
    if coalesce(trim(p.currency),'') = '' then
      insert into public.findings(org_id,purchase_id,purchase_version,code,severity,message,next_action)
      values (p.org_id,_pid,p.version,'MISSING_CURRENCY','warning','The currency is missing, so the amount cannot be compared with the spending rules.','Confirm the currency with the supplier and correct the request.');
      needs_clar := true;
    elsif p.currency <> pol.currency then
      insert into public.findings(org_id,purchase_id,purchase_version,code,severity,message,next_action)
      values (p.org_id,_pid,p.version,'CURRENCY_NOT_ALLOWED','block','Currency '||p.currency||' is not allowed. Spending rules allow only '||pol.currency||'.','Request a corrected invoice in '||pol.currency||'.');
      has_block := true;
    end if;
    if sup.id is not null and array_length(pol.allowed_supplier_ids,1) > 0 and not (sup.id = any(pol.allowed_supplier_ids)) then
      insert into public.findings(org_id,purchase_id,purchase_version,code,severity,message,next_action)
      values (p.org_id,_pid,p.version,'SUPPLIER_NOT_ALLOWED','block','Supplier "'||sup.name||'" is not on the allowed supplier list.','An owner must change the spending rules; a purchase approval cannot override this.');
      has_block := true;
    end if;
    if array_length(pol.allowed_categories,1) > 0 then
      if p.category is not null and not (p.category = any(pol.allowed_categories)) then
        insert into public.findings(org_id,purchase_id,purchase_version,code,severity,message,next_action)
        values (p.org_id,_pid,p.version,'CATEGORY_NOT_ALLOWED','block','Category "'||p.category||'" is not allowed by the spending rules.','An owner must change the spending rules.');
        has_block := true;
      end if;
      for li in select * from public.purchase_line_items where purchase_id = _pid and category is not null and not (category = any(pol.allowed_categories)) loop
        insert into public.findings(org_id,purchase_id,purchase_version,code,severity,message,next_action)
        values (p.org_id,_pid,p.version,'CATEGORY_NOT_ALLOWED','block','Line "'||li.description||'" is in category "'||li.category||'", which is not allowed.','Remove the line or have an owner change the rules.');
        has_block := true;
      end loop;
    end if;
    if p.total_minor > pol.order_limit_minor then
      insert into public.findings(org_id,purchase_id,purchase_version,code,severity,message,next_action)
      values (p.org_id,_pid,p.version,'ORDER_LIMIT','block',
        format('Order total %s %s exceeds the per-order limit of %s %s.', to_char(p.total_minor/100.0,'FM999999990.00'), p.currency, to_char(pol.order_limit_minor/100.0,'FM999999990.00'), pol.currency),
        'Reduce the order. A purchase approver cannot override a hard limit; only a separately approved rule change can.');
      has_block := true;
    end if;
    v_committed := public.week_committed_minor(p.org_id, _pid);
    if v_committed + p.total_minor > pol.weekly_limit_minor then
      insert into public.findings(org_id,purchase_id,purchase_version,code,severity,message,next_action)
      values (p.org_id,_pid,p.version,'WEEKLY_LIMIT','block',
        format('This week %s %s is already reserved or spent. Adding %s %s would exceed the weekly limit of %s %s.', to_char(v_committed/100.0,'FM999999990.00'), pol.currency, to_char(p.total_minor/100.0,'FM999999990.00'), p.currency, to_char(pol.weekly_limit_minor/100.0,'FM999999990.00'), pol.currency),
        'Wait for the next week (business timezone) or reduce the order.');
      has_block := true;
    end if;
  end if;

  if p.invoice_reference is not null and exists (
    select 1 from public.purchases o where o.org_id = p.org_id and o.id <> p.id and o.supplier_id is not distinct from p.supplier_id
      and o.invoice_reference = p.invoice_reference and o.status not in ('cancelled','failed')) then
    insert into public.findings(org_id,purchase_id,purchase_version,code,severity,message,next_action)
    values (p.org_id,_pid,p.version,'DUPLICATE_INVOICE','block','Another open request already uses invoice reference '||p.invoice_reference||' for this supplier.','Link to the existing purchase instead of paying twice.');
    has_block := true;
  end if;

  if sv.id is not null and coalesce(trim(p.requested_recipient),'') <> '' then
    if lower(trim(p.requested_recipient)) <> lower(trim(sv.paypal_merchant_id)) then
      select * into cr from public.supplier_change_requests
        where purchase_id = _pid and lower(proposed_recipient) = lower(trim(p.requested_recipient))
        order by created_at desc limit 1;
      if cr.id is null then
        insert into public.supplier_change_requests(org_id,supplier_id,purchase_id,base_version_id,proposed_recipient,proposed_contact,proposed_by)
        values (p.org_id,sup.id,_pid,sv.id,trim(p.requested_recipient),p.requested_contact,p.requested_by)
        returning * into cr;
        perform public.log_audit(p.org_id,'supplier_change_detected','supplier_change_request',cr.id,null,
          jsonb_build_object('purchase_id',_pid,'approved_recipient',sv.paypal_merchant_id,'requested_recipient',p.requested_recipient,'supplier_version',sv.version),'system');
      end if;
      if cr.status = 'rejected' then
        insert into public.findings(org_id,purchase_id,purchase_version,code,severity,message,next_action)
        values (p.org_id,_pid,p.version,'RECIPIENT_CHANGE_REJECTED','block',
          'The requested recipient "'||p.requested_recipient||'" was rejected after independent verification. The approved recipient remains "'||sv.paypal_merchant_id||'".',
          'Do not pay this recipient. Cancel the request, or correct it to the approved recipient.');
        has_block := true;
      else
        insert into public.findings(org_id,purchase_id,purchase_version,code,severity,message,next_action)
        values (p.org_id,_pid,p.version,'RECIPIENT_CHANGED','warning',
          'Requested recipient "'||p.requested_recipient||'" differs from the approved recipient "'||sv.paypal_merchant_id||'" (supplier record v'||sv.version||').',
          'A different authorised reviewer must confirm the change through the trusted channel ('||sv.trusted_contact_channel||': '||sv.trusted_contact_value||'), not contact details in this request.');
        needs_verif := true;
      end if;
    elsif sv.enrolment_status not in ('enrolled','demo_fixture') then
      insert into public.findings(org_id,purchase_id,purchase_version,code,severity,message,next_action)
      values (p.org_id,_pid,p.version,'RECIPIENT_NOT_ENROLLED','block','The approved recipient has not completed supported PayPal enrolment ('||sv.enrolment_status||').','Complete PayPal enrolment once the PayPal integration is connected.');
      has_block := true;
    end if;
  end if;

  if has_block then v_status := 'blocked';
  elsif needs_clar then v_status := 'needs_clarification';
  elsif needs_verif then v_status := 'verification_required';
  else
    v_digest := public.purchase_digest(_pid);
    if p.total_minor > pol.approval_threshold_minor and not exists (
      select 1 from public.approvals a where a.purchase_id = _pid and a.is_valid and a.digest = v_digest) then
      insert into public.findings(org_id,purchase_id,purchase_version,code,severity,message,next_action)
      values (p.org_id,_pid,p.version,'APPROVAL_REQUIRED','info',
        format('Amount is above the internal approval threshold of %s %s.', to_char(pol.approval_threshold_minor/100.0,'FM999999990.00'), pol.currency),
        'An authorised payer other than the requester must approve this exact version.');
      v_status := 'approval_required';
    else
      v_status := 'cleared_for_checkout';
    end if;
  end if;

  update public.purchases set status = v_status, digest = public.purchase_digest(_pid), updated_at = now() where id = _pid;
  if p.status is distinct from v_status then
    perform public.log_audit(p.org_id,'status_changed','purchase',_pid,p.version,jsonb_build_object('from',p.status,'to',v_status),'system');
  end if;
  return v_status;
end $function$;
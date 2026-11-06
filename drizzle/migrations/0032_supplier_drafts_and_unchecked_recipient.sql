ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS is_test_supplier boolean NOT NULL DEFAULT false;
ALTER TABLE public.suppliers DROP CONSTRAINT suppliers_status_check;
ALTER TABLE public.suppliers ADD CONSTRAINT suppliers_status_check CHECK (status = ANY (ARRAY['draft','pending_approval','active','suspended']));
ALTER TABLE public.supplier_versions DROP CONSTRAINT supplier_versions_status_check;
ALTER TABLE public.supplier_versions ADD CONSTRAINT supplier_versions_status_check CHECK (status = ANY (ARRAY['draft','pending_approval','active','superseded']));

CREATE OR REPLACE FUNCTION public.save_supplier_draft(_org uuid, _name text, _merchant text, _email text, _channel text, _channel_value text, _evidence text, _is_test boolean)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
declare v_sup uuid; v_sv uuid; v_missing text[] := '{}';
begin
  if not (public.has_org_role(_org,'owner') or public.has_org_role(_org,'preparer')) then raise exception 'Only owners or preparers can save supplier drafts'; end if;
  if coalesce(trim(_name),'')='' then raise exception 'A supplier name is required to save a draft'; end if;
  if coalesce(trim(_merchant),'')='' then v_missing := v_missing || 'PayPal merchant ID'; end if;
  if coalesce(trim(_channel_value),'')='' then v_missing := v_missing || 'trusted contact'; end if;
  if coalesce(trim(_evidence),'')='' then v_missing := v_missing || 'independent verification evidence'; end if;
  insert into public.suppliers(org_id,name,status,created_by,is_test_supplier) values (_org,trim(_name),'draft',auth.uid(),coalesce(_is_test,false)) returning id into v_sup;
  insert into public.supplier_versions(org_id,supplier_id,version,paypal_merchant_id,recipient_email,trusted_contact_channel,trusted_contact_value,verification_evidence,enrolment_status,status,created_by)
  values (_org,v_sup,1,coalesce(trim(_merchant),''),nullif(trim(_email),''),coalesce(nullif(_channel,''),'phone'),coalesce(trim(_channel_value),''),nullif(trim(_evidence),''),'not_enrolled','draft',auth.uid()) returning id into v_sv;
  update public.suppliers set current_version_id = v_sv where id = v_sup;
  perform public.log_audit(_org,'supplier_draft_saved','supplier',v_sup,1,jsonb_build_object('name',_name,'paypal_merchant_id',nullif(trim(_merchant),''),'missing',v_missing,'test_supplier',coalesce(_is_test,false)));
  return v_sup;
end $$;
REVOKE ALL ON FUNCTION public.save_supplier_draft(uuid,text,text,text,text,text,text,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_supplier_draft(uuid,text,text,text,text,text,text,boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.submit_supplier_draft(_supplier uuid, _merchant text, _channel text, _channel_value text, _evidence text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
declare s public.suppliers%rowtype;
begin
  select * into s from public.suppliers where id=_supplier for update;
  if not found then raise exception 'Supplier not found'; end if;
  if not public.has_org_role(s.org_id,'owner') then raise exception 'Only owners can submit a supplier for approval'; end if;
  if s.status <> 'draft' then raise exception 'Only draft suppliers can be submitted'; end if;
  if coalesce(trim(_merchant),'')='' or coalesce(trim(_channel_value),'')='' or coalesce(trim(_evidence),'')='' then
    raise exception 'Merchant ID, trusted contact and independent verification evidence are required before approval can be requested'; end if;
  update public.supplier_versions set paypal_merchant_id=trim(_merchant), trusted_contact_channel=coalesce(nullif(_channel,''),'phone'), trusted_contact_value=trim(_channel_value), verification_evidence=trim(_evidence), status='pending_approval'
   where id=s.current_version_id;
  update public.suppliers set status='pending_approval' where id=_supplier;
  perform public.log_audit(s.org_id,'supplier_proposed','supplier',_supplier,1,jsonb_build_object('from','draft','paypal_merchant_id',trim(_merchant),'channel',_channel));
end $$;
REVOKE ALL ON FUNCTION public.submit_supplier_draft(uuid,text,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_supplier_draft(uuid,text,text,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.evaluate_purchase(_pid uuid)
 RETURNS purchase_status
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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
  -- Plain-language recipient status, and approval needs shown even while other issues remain.
  update public.findings set message = 'Recipient verification cannot be checked: payment recipient or approved supplier record missing.',
      next_action = 'Payment is unavailable until supplier onboarding and recipient verification are complete. Spending rules were still checked.'
    where purchase_id = _pid and purchase_version = p.version and code = 'NO_SUPPLIER';
  update public.findings set message = message || ' Recipient verification cannot be checked until it is approved.',
      next_action = 'Complete supplier onboarding; a second authorised person must approve it before payment.'
    where purchase_id = _pid and purchase_version = p.version and code = 'SUPPLIER_NOT_ACTIVE' and message not like '%cannot be checked%';
  if v_status not in ('cleared_for_checkout','approval_required') and not exists (
      select 1 from public.findings where purchase_id=_pid and purchase_version=p.version and code='APPROVAL_REQUIRED') then
    insert into public.findings(org_id,purchase_id,purchase_version,code,severity,message,next_action)
    select p.org_id,_pid,p.version,'APPROVAL_REQUIRED','info',
      format('Amount is above the internal approval threshold of %s %s.', to_char(pol.approval_threshold_minor/100.0,'FM999999990.00'), pol.currency),
      'Once the other issues are resolved, an authorised payer other than the requester must approve this exact version.'
    from public.spending_policies pol where pol.id = p.policy_version_id and p.total_minor > pol.approval_threshold_minor;
  end if;
  return v_status;
end $function$;
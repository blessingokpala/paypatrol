alter table public.verification_records add column if not exists check_kind text not null default 'trusted_contact';
alter table public.verification_records drop constraint if exists verification_records_check_kind_chk;
alter table public.verification_records add constraint verification_records_check_kind_chk check (check_kind in ('trusted_contact','paypal_sandbox_account_check'));

create or replace function public.record_sandbox_account_check(_cr uuid, _merchant_seen text, _business_account_seen text, _outcome verification_outcome, _evidence text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare cr public.supplier_change_requests%rowtype; cfg public.paypal_merchant_configs%rowtype; req uuid; v_id uuid;
begin
  select * into cr from public.supplier_change_requests where id = _cr for update;
  if not found then raise exception 'Change request not found'; end if;
  if not (public.has_org_role(cr.org_id,'change_approver') or public.has_org_role(cr.org_id,'owner')) then raise exception 'Only change approvers or owners can record a Sandbox account check'; end if;
  select requested_by into req from public.purchases where id = cr.purchase_id;
  if cr.proposed_by = auth.uid() or req = auth.uid() then raise exception 'The person who submitted this request or change cannot check it. A different reviewer is required.'; end if;
  if cr.status not in ('pending_verification','verified_pending_decision') then raise exception 'This change has already been decided'; end if;
  select * into cfg from public.paypal_merchant_configs where org_id = cr.org_id and supplier_id = cr.supplier_id;
  if not found then raise exception 'No Sandbox supplier is configured for this supplier, so a Sandbox account check does not apply'; end if;
  if cfg.configured_by = auth.uid() then raise exception 'The person who set up the Sandbox supplier cannot check it'; end if;
  if coalesce(trim(_business_account_seen),'')='' or coalesce(trim(_evidence),'')='' then raise exception 'Business Sandbox account and notes are required'; end if;
  if _outcome = 'confirmed' and (upper(trim(_merchant_seen)) <> upper(trim(cfg.merchant_id)) or upper(trim(_merchant_seen)) <> upper(trim(cr.proposed_recipient))) then
    raise exception 'The Merchant ID you saw does not match both the configured Sandbox supplier and the requested recipient. Record it as not confirmed.'; end if;
  insert into public.verification_records(org_id,change_request_id,supplier_id,channel,channel_value,person_contacted,contacted_at,outcome,evidence,reviewer_id,check_kind)
  values (cr.org_id,_cr,cr.supplier_id,'PayPal Developer Sandbox records',upper(trim(_merchant_seen)),
    'No supplier contacted. Sandbox Business account: '||trim(_business_account_seen),now(),_outcome,
    'SANDBOX ACCOUNT CHECK ONLY. No real supplier was contacted or verified. '||trim(_evidence),auth.uid(),'paypal_sandbox_account_check')
  returning id into v_id;
  update public.supplier_change_requests set status='verified_pending_decision' where id=_cr;
  perform public.log_audit(cr.org_id,'sandbox_account_check_recorded','supplier_change_request',_cr,null,
    jsonb_build_object('check_kind','paypal_sandbox_account_check','merchant_seen',upper(trim(_merchant_seen)),'outcome',_outcome,'real_supplier_contacted',false,'independent_supplier_verification',false));
  return v_id;
end $$;
revoke all on function public.record_sandbox_account_check(uuid,text,text,verification_outcome,text) from public, anon;
grant execute on function public.record_sandbox_account_check(uuid,text,text,verification_outcome,text) to authenticated;
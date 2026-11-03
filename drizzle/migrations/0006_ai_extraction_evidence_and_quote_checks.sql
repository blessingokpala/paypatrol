-- Phase two: AI extraction evidence (server-written), approved-quote linking,
-- and a discrepancy check that keeps the requested amount AND the approved quote.

create table public.ai_extractions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  purchase_id uuid references public.purchases(id) on delete set null,
  storage_path text,
  file_name text,
  model text not null,
  extracted jsonb not null,
  excerpts jsonb not null default '[]'::jsonb,
  uncertain_fields text[] not null default '{}',
  missing_fields text[] not null default '{}',
  created_by uuid not null,
  created_at timestamptz not null default now()
);
grant select on public.ai_extractions to authenticated;
grant all on public.ai_extractions to service_role;
alter table public.ai_extractions enable row level security;
create policy "members read ai extractions" on public.ai_extractions
  for select to authenticated using (public.is_org_member(org_id));

-- Server-written extraction evidence. The browser never inserts rows here.
create or replace function public.record_extraction(
  _org uuid, _storage_path text, _file_name text, _model text,
  _extracted jsonb, _excerpts jsonb, _uncertain text[], _missing text[])
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not (public.has_org_role(_org,'preparer') or public.has_org_role(_org,'owner')) then
    raise exception 'Only preparers or owners can record an extraction'; end if;
  if _storage_path is not null and split_part(_storage_path,'/',1) <> _org::text then
    raise exception 'Invalid document path'; end if;
  insert into public.ai_extractions(org_id,storage_path,file_name,model,extracted,excerpts,uncertain_fields,missing_fields,created_by)
  values (_org,_storage_path,_file_name,_model,_extracted,coalesce(_excerpts,'[]'::jsonb),coalesce(_uncertain,'{}'),coalesce(_missing,'{}'),auth.uid())
  returning id into v_id;
  perform public.log_audit(_org,'ai_extraction_recorded','ai_extraction',v_id,null,
    jsonb_build_object('model',_model,'missing_fields',coalesce(_missing,'{}'),'uncertain_fields',coalesce(_uncertain,'{}')));
  return v_id;
end $$;
revoke execute on function public.record_extraction(uuid,text,text,text,jsonb,jsonb,text[],text[]) from public, anon;
grant execute on function public.record_extraction(uuid,text,text,text,jsonb,jsonb,text[],text[]) to authenticated;

-- Attach an existing extraction to the purchase it fed. No field values pass through here.
create or replace function public.link_extraction(_extraction uuid, _purchase uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  select org_id into v_org from public.ai_extractions where id = _extraction;
  if v_org is null then raise exception 'Extraction not found'; end if;
  if not (public.has_org_role(v_org,'preparer') or public.has_org_role(v_org,'owner')) then
    raise exception 'Only preparers or owners can link an extraction'; end if;
  if not exists (select 1 from public.purchases where id = _purchase and org_id = v_org) then
    raise exception 'Purchase not found in this organisation'; end if;
  update public.ai_extractions set purchase_id = _purchase where id = _extraction;
  perform public.log_audit(v_org,'ai_extraction_attached','ai_extraction',_extraction,null,jsonb_build_object('purchase_id',_purchase));
end $$;
revoke execute on function public.link_extraction(uuid,uuid) from public, anon;
grant execute on function public.link_extraction(uuid,uuid) to authenticated;

-- Invoice submission may link the approved quote it was checked against.
create or replace function public.submit_invoice(_org uuid, _supplier uuid, _invoice_ref text, _amount_minor bigint, _currency text, _recipient text, _contact text, _category text, _description text, _message text, _storage_path text, _file_name text, _listing uuid default null, _quantity integer default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_p uuid; v_title text;
begin
  if not (public.has_org_role(_org,'preparer') or public.has_org_role(_org,'owner')) then raise exception 'Only preparers or owners can submit invoices'; end if;
  if _supplier is not null and not exists (select 1 from public.suppliers where id=_supplier and org_id=_org) then raise exception 'Unknown supplier'; end if;
  if _amount_minor is null or _amount_minor < 0 then raise exception 'Amount must be zero or positive minor units'; end if;
  if _storage_path is not null and split_part(_storage_path,'/',1) <> _org::text then raise exception 'Invalid document path'; end if;
  v_title := 'Invoice ' || coalesce(nullif(trim(_invoice_ref),''),'(no reference)') || coalesce(' — '||nullif(trim(_description),''),'');
  insert into public.purchases(org_id,source,supplier_id,title,invoice_reference,category,total_minor,currency,requested_recipient,requested_contact,requested_by)
  values (_org,'invoice',_supplier,v_title,nullif(trim(_invoice_ref),''),nullif(trim(_category),''),_amount_minor,upper(trim(_currency)),nullif(trim(_recipient),''),nullif(trim(_contact),''),auth.uid())
  returning id into v_p;
  if _amount_minor > 0 then
    insert into public.purchase_line_items(org_id,purchase_id,description,category,quantity,unit_price_minor,line_total_minor)
    values (_org,v_p,coalesce(nullif(trim(_description),''),'Invoice total'),nullif(trim(_category),''),1,_amount_minor,_amount_minor);
  end if;
  if _listing is not null then
    if _quantity is null or _quantity <= 0 then raise exception 'Quantity must be a positive whole number when an approved quote is linked'; end if;
    insert into public.purchase_line_items(org_id,purchase_id,listing_id,description,category,quantity,unit_price_minor,line_total_minor)
    select _org,v_p,l.id,'Approved quote: '||l.name,l.category,_quantity,l.unit_price_minor,l.unit_price_minor*_quantity
    from public.listings l where l.id=_listing and l.org_id=_org and l.is_active;
    if not found then raise exception 'Unknown or inactive listing'; end if;
  end if;
  insert into public.invoice_documents(org_id,purchase_id,storage_path,file_name,source_message,uploaded_by)
  values (_org,v_p,_storage_path,_file_name,_message,auth.uid());
  perform public.log_audit(_org,'purchase_submitted','purchase',v_p,1,jsonb_build_object('source','invoice','amount_minor',_amount_minor,'currency',_currency,'recipient',_recipient,'quote_listing',_listing,'quote_quantity',_quantity));
  perform public.evaluate_purchase(v_p);
  return v_p;
end $$;

-- Editing a request keeps the approved-quote line alongside the corrected request line.
create or replace function public.edit_purchase(_pid uuid, _amount_minor bigint, _currency text, _recipient text, _invoice_ref text, _category text)
returns public.purchase_status language plpgsql security definer set search_path = public as $$
declare p public.purchases%rowtype; v_changed text[] := '{}'; v_listing uuid; v_qty integer;
begin
  select * into p from public.purchases where id = _pid for update;
  if not found then raise exception 'Purchase not found'; end if;
  if not (public.has_org_role(p.org_id,'preparer') or public.has_org_role(p.org_id,'owner')) then raise exception 'Only preparers or owners can edit requests'; end if;
  if p.status in ('payment_pending','paid','failed','cancelled') then raise exception 'This request can no longer be edited'; end if;
  if p.source = 'ai_proposal' and (_amount_minor is distinct from p.total_minor or _recipient is distinct from p.requested_recipient) then
    raise exception 'AI proposal totals and recipients are resolved by the server and cannot be edited'; end if;
  if _amount_minor is null or _amount_minor < 0 then raise exception 'Amount must be zero or positive minor units'; end if;
  if _amount_minor is distinct from p.total_minor then v_changed := array_append(v_changed, 'amount'); end if;
  if upper(trim(_currency)) is distinct from p.currency then v_changed := array_append(v_changed, 'currency'); end if;
  if nullif(trim(_recipient),'') is distinct from p.requested_recipient then v_changed := array_append(v_changed, 'recipient'); end if;
  if nullif(trim(_invoice_ref),'') is distinct from p.invoice_reference then v_changed := array_append(v_changed, 'invoice_reference'); end if;
  if nullif(trim(_category),'') is distinct from p.category then v_changed := array_append(v_changed, 'category'); end if;
  if array_length(v_changed,1) is null then return p.status; end if;
  update public.purchases set total_minor = _amount_minor, currency = upper(trim(_currency)), requested_recipient = nullif(trim(_recipient),''),
    invoice_reference = nullif(trim(_invoice_ref),''), category = nullif(trim(_category),''), version = version + 1, updated_at = now()
  where id = _pid;
  if p.source = 'invoice' then
    select li.listing_id, li.quantity into v_listing, v_qty from public.purchase_line_items li
      where li.purchase_id = _pid and li.listing_id is not null order by li.created_at limit 1;
    delete from public.purchase_line_items where purchase_id = _pid;
    if _amount_minor > 0 then
      insert into public.purchase_line_items(org_id,purchase_id,description,category,quantity,unit_price_minor,line_total_minor)
      values (p.org_id,_pid,'Invoice total (corrected)',nullif(trim(_category),''),1,_amount_minor,_amount_minor);
    end if;
    if v_listing is not null then
      insert into public.purchase_line_items(org_id,purchase_id,listing_id,description,category,quantity,unit_price_minor,line_total_minor)
      select p.org_id,_pid,l.id,'Approved quote: '||l.name,l.category,v_qty,l.unit_price_minor,l.unit_price_minor*v_qty
      from public.listings l where l.id = v_listing;
    end if;
  end if;
  perform public.invalidate_approvals(_pid, 'Request changed: '||array_to_string(v_changed,', '));
  perform public.log_audit(p.org_id,'purchase_edited','purchase',_pid,p.version+1,jsonb_build_object('changed',v_changed,'previous_version',p.version));
  return public.evaluate_purchase(_pid);
end $$;

-- The shared checker stays the single entry point. The tested core is renamed and
-- wrapped so an approved-quote discrepancy is reported without overwriting either value.
alter function public.evaluate_purchase(uuid) rename to evaluate_purchase_core;
revoke execute on function public.evaluate_purchase_core(uuid) from public, anon, authenticated;

create or replace function public.evaluate_purchase(_pid uuid)
returns public.purchase_status language plpgsql security definer set search_path = public as $$
declare v_status public.purchase_status; p public.purchases%rowtype;
        v_quote_name text; v_quote_qty integer; v_quote_unit bigint; v_quote_total bigint;
        v_quote_currency text; v_quote_max integer;
begin
  v_status := public.evaluate_purchase_core(_pid);
  select l.name, li.quantity, li.unit_price_minor, li.line_total_minor, l.currency, l.max_quantity
    into v_quote_name, v_quote_qty, v_quote_unit, v_quote_total, v_quote_currency, v_quote_max
  from public.purchase_line_items li join public.listings l on l.id = li.listing_id
  where li.purchase_id = _pid and li.listing_id is not null order by li.created_at limit 1;
  if not found then return v_status; end if;
  select * into p from public.purchases where id = _pid;
  if v_quote_total = p.total_minor and v_quote_currency = p.currency and v_quote_qty <= v_quote_max then
    return v_status;
  end if;
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
  return v_status;
end $$;
revoke execute on function public.evaluate_purchase(uuid) from public, anon, authenticated;
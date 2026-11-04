DROP FUNCTION public.edit_purchase(uuid, bigint, text, text, text, text);

CREATE OR REPLACE FUNCTION public.edit_purchase(_pid uuid, _amount_minor bigint, _currency text, _recipient text, _invoice_ref text, _category text, _invoice_date date, _due_date date, _buyer text, _subtotal_minor bigint, _tax_minor bigint, _shipping_minor bigint, _reason text)
 RETURNS purchase_status
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  if _invoice_date is distinct from p.invoice_date then v_changed := array_append(v_changed, 'invoice_date'); end if;
  if _due_date is distinct from p.due_date then v_changed := array_append(v_changed, 'due_date'); end if;
  if nullif(trim(_buyer),'') is distinct from p.buyer_name then v_changed := array_append(v_changed, 'buyer'); end if;
  if _subtotal_minor is distinct from p.subtotal_minor then v_changed := array_append(v_changed, 'subtotal'); end if;
  if _tax_minor is distinct from p.tax_minor then v_changed := array_append(v_changed, 'tax'); end if;
  if _shipping_minor is distinct from p.shipping_minor then v_changed := array_append(v_changed, 'shipping'); end if;
  if array_length(v_changed,1) is null then return p.status; end if;
  if nullif(trim(coalesce(_reason,'')),'') is null then raise exception 'A correction reason is required'; end if;
  update public.purchases set total_minor = _amount_minor, currency = upper(trim(_currency)), requested_recipient = nullif(trim(_recipient,''),''),
    invoice_reference = nullif(trim(_invoice_ref,''),''), category = nullif(trim(_category,''),''),
    invoice_date = _invoice_date, due_date = _due_date, buyer_name = nullif(trim(_buyer),''),
    subtotal_minor = _subtotal_minor, tax_minor = _tax_minor, shipping_minor = _shipping_minor,
    version = version + 1, updated_at = now()
  where id = _pid;
  if p.source = 'invoice' then
    select li.listing_id, li.quantity into v_listing, v_qty from public.purchase_line_items li
      where li.purchase_id = _pid and li.listing_id is not null order by li.created_at limit 1;
    delete from public.purchase_line_items where purchase_id = _pid;
    if _amount_minor > 0 then
      insert into public.purchase_line_items(org_id,purchase_id,description,category,quantity,unit_price_minor,line_total_minor)
      values (p.org_id,_pid,'Invoice total '||chr(40)||'corrected)',nullif(trim(_category,''),''),1,_amount_minor,_amount_minor);
    end if;
    if v_listing is not null then
      insert into public.purchase_line_items(org_id,purchase_id,listing_id,description,category,quantity,unit_price_minor,line_total_minor)
      select p.org_id,_pid,l.id,'Approved quote: '||l.name,l.category,v_qty,l.unit_price_minor,l.unit_price_minor*v_qty
      from public.listings l where l.id = v_listing;
    end if;
  end if;
  perform public.invalidate_approvals(_pid, 'Request changed: '||array_to_string(v_changed,', '));
  perform public.log_audit(p.org_id,'purchase_edited','purchase',_pid,p.version+1,jsonb_build_object('changed',v_changed,'previous_version',p.version,'reason',trim(_reason)));
  return public.evaluate_purchase(_pid);
end $function$;
ALTER TABLE public.purchases ADD COLUMN IF NOT EXISTS requested_recipient_name text;
COMMENT ON COLUMN public.purchases.requested_recipient_name IS 'Payee name as stated on the invoice; requested_recipient holds the PayPal merchant ID.';

DROP FUNCTION IF EXISTS public.submit_invoice(uuid, uuid, text, bigint, text, text, text, text, text, text, text, text, uuid, integer);

CREATE OR REPLACE FUNCTION public.submit_invoice(_org uuid, _supplier uuid, _invoice_ref text, _amount_minor bigint, _currency text, _recipient text, _contact text, _category text, _description text, _message text, _storage_path text, _file_name text, _listing uuid DEFAULT NULL::uuid, _quantity integer DEFAULT NULL::integer, _recipient_name text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_p uuid; v_title text;
begin
  if not (public.has_org_role(_org,'preparer') or public.has_org_role(_org,'owner')) then raise exception 'Only preparers or owners can submit invoices'; end if;
  if _supplier is not null and not exists (select 1 from public.suppliers where id=_supplier and org_id=_org) then raise exception 'Unknown supplier'; end if;
  if _amount_minor is null or _amount_minor < 0 then raise exception 'Amount must be zero or positive minor units'; end if;
  if _storage_path is not null and split_part(_storage_path,'/',1) <> _org::text then raise exception 'Invalid document path'; end if;
  v_title := 'Invoice ' || coalesce(nullif(trim(_invoice_ref),''),'(no reference)') || coalesce(' — '||nullif(trim(_description),''),'');
  insert into public.purchases(org_id,source,supplier_id,title,invoice_reference,category,total_minor,currency,requested_recipient,requested_recipient_name,requested_contact,requested_by)
  values (_org,'invoice',_supplier,v_title,nullif(trim(_invoice_ref),''),nullif(trim(_category),''),_amount_minor,upper(trim(_currency)),nullif(trim(_recipient),''),nullif(trim(_recipient_name),''),nullif(trim(_contact),''),auth.uid())
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
  perform public.log_audit(_org,'purchase_submitted','purchase',v_p,1,jsonb_build_object('source','invoice','amount_minor',_amount_minor,'currency',_currency,'recipient',_recipient,'recipient_name',_recipient_name,'quote_listing',_listing,'quote_quantity',_quantity));
  perform public.evaluate_purchase(v_p);
  return v_p;
end $function$;
REVOKE ALL ON FUNCTION public.submit_invoice(uuid, uuid, text, bigint, text, text, text, text, text, text, text, text, uuid, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_invoice(uuid, uuid, text, bigint, text, text, text, text, text, text, text, text, uuid, integer, text) TO authenticated;

-- Deliberately fictional TESTONLY merchant IDs can never become payable.
CREATE OR REPLACE FUNCTION public.guard_testonly_merchant()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $$
begin
  if upper(new.paypal_merchant_id) like 'TESTONLY%' and new.enrolment_status in ('enrolled','demo_fixture') then
    raise exception 'TESTONLY merchant IDs are fictional and can never be enrolled for payment';
  end if;
  return new;
end $$;
DROP TRIGGER IF EXISTS trg_guard_testonly_merchant ON public.supplier_versions;
CREATE TRIGGER trg_guard_testonly_merchant BEFORE INSERT OR UPDATE ON public.supplier_versions
FOR EACH ROW EXECUTE FUNCTION public.guard_testonly_merchant();
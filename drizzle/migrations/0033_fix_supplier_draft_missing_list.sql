CREATE OR REPLACE FUNCTION public.save_supplier_draft(_org uuid, _name text, _merchant text, _email text, _channel text, _channel_value text, _evidence text, _is_test boolean)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
declare v_sup uuid; v_sv uuid; v_missing text[] := '{}'::text[];
begin
  if not (public.has_org_role(_org,'owner') or public.has_org_role(_org,'preparer')) then raise exception 'Only owners or preparers can save supplier drafts'; end if;
  if coalesce(trim(_name),'')='' then raise exception 'A supplier name is required to save a draft'; end if;
  if coalesce(trim(_merchant),'')='' then v_missing := array_append(v_missing, 'PayPal merchant ID'); end if;
  if coalesce(trim(_channel_value),'')='' then v_missing := array_append(v_missing, 'trusted contact'); end if;
  if coalesce(trim(_evidence),'')='' then v_missing := array_append(v_missing, 'independent verification evidence'); end if;
  insert into public.suppliers(org_id,name,status,created_by,is_test_supplier) values (_org,trim(_name),'draft',auth.uid(),coalesce(_is_test,false)) returning id into v_sup;
  insert into public.supplier_versions(org_id,supplier_id,version,paypal_merchant_id,recipient_email,trusted_contact_channel,trusted_contact_value,verification_evidence,enrolment_status,status,created_by)
  values (_org,v_sup,1,coalesce(trim(_merchant),''),nullif(trim(_email),''),coalesce(nullif(_channel,''),'phone'),coalesce(trim(_channel_value),''),nullif(trim(_evidence),''),'not_enrolled','draft',auth.uid()) returning id into v_sv;
  update public.suppliers set current_version_id = v_sv where id = v_sup;
  perform public.log_audit(_org,'supplier_draft_saved','supplier',v_sup,1,jsonb_build_object('name',_name,'paypal_merchant_id',nullif(trim(_merchant),''),'missing',to_jsonb(v_missing),'test_supplier',coalesce(_is_test,false)));
  return v_sup;
end $$;
CREATE OR REPLACE FUNCTION public.cancel_purchase(_pid uuid, _reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
 declare p public.purchases%rowtype;
 begin
   select * into p from public.purchases where id = _pid for update;
   if not found then raise exception 'Purchase not found'; end if;
   if not (public.has_org_role(p.org_id,'preparer') or public.has_org_role(p.org_id,'owner') or public.has_org_role(p.org_id,'payer')) then raise exception 'Not permitted'; end if;
   if coalesce(trim(_reason),'') = '' then raise exception 'A reason is required to reject a request'; end if;
   if p.status in ('payment_pending','paid') then raise exception 'A request with a payment in progress or completed cannot be cancelled here'; end if;
   if p.status in ('cancelled','failed') then raise exception 'This request is already % and cannot be rejected again', p.status; end if;
   update public.purchases set status = 'cancelled', updated_at = now() where id = _pid;
   update public.budget_reservations set status='released', released_at = now() where purchase_id = _pid and status='active';
   perform public.log_audit(p.org_id,'purchase_cancelled','purchase',_pid,p.version,jsonb_build_object('reason',_reason));
 end $function$;
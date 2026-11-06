CREATE OR REPLACE FUNCTION public.reject_spending(_pid uuid, _version int, _reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
declare p public.purchases%rowtype;
begin
  select * into p from public.purchases where id = _pid for update;
  if not found then raise exception 'Purchase not found'; end if;
  if not (public.has_org_role(p.org_id,'payer') or public.has_org_role(p.org_id,'owner')) then raise exception 'Only payers or owners can reject spending'; end if;
  if p.requested_by = auth.uid() then raise exception 'The requester cannot decide on their own request'; end if;
  if coalesce(trim(_reason),'') = '' then raise exception 'Enter a reason for rejecting this spending request'; end if;
  if p.version <> _version then raise exception 'This request changed (now version %). Review the current version first.', p.version; end if;
  if p.status <> 'approval_required' then raise exception 'Only requests awaiting spending approval can be rejected here (current status %).', p.status; end if;
  update public.purchases set status = 'cancelled', updated_at = now() where id = _pid;
  update public.budget_reservations set status='released', released_at = now() where purchase_id = _pid and status='active';
  perform public.log_audit(p.org_id,'spending_rejected','purchase',_pid,p.version,
    jsonb_build_object('reason',trim(_reason),'amount_minor',p.total_minor,'currency',p.currency,'recipient',p.requested_recipient));
end $$;
REVOKE ALL ON FUNCTION public.reject_spending(uuid, int, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reject_spending(uuid, int, text) TO authenticated;

revoke execute on function public.week_committed_minor(uuid,uuid) from authenticated;
revoke execute on function public.active_policy_id(uuid) from public, anon, authenticated;
create or replace function public.org_budget_summary(_org uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare pol public.spending_policies%rowtype; v_week timestamptz; v_reserved bigint; v_spent bigint;
begin
  if not public.is_org_member(_org) then raise exception 'Not permitted'; end if;
  select * into pol from public.spending_policies where org_id = _org and is_active order by version desc limit 1;
  if pol.id is null then return null; end if;
  v_week := public.org_week_start(pol.timezone);
  select coalesce(sum(amount_minor) filter (where status='active'),0), coalesce(sum(amount_minor) filter (where status='consumed'),0)
    into v_reserved, v_spent from public.budget_reservations where org_id=_org and period_start = v_week;
  return jsonb_build_object('weekly_limit_minor',pol.weekly_limit_minor,'reserved_minor',v_reserved,'spent_minor',v_spent,
    'available_minor',pol.weekly_limit_minor - v_reserved - v_spent,'currency',pol.currency,'timezone',pol.timezone,'week_start',v_week,'policy_version',pol.version);
end $$;
revoke execute on function public.org_budget_summary(uuid) from public, anon;
grant execute on function public.org_budget_summary(uuid) to authenticated;

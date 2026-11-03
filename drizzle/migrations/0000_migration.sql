
-- ===== Enums =====
create type public.member_role as enum ('owner','preparer','change_approver','payer');
create type public.purchase_source as enum ('invoice','ai_proposal');
create type public.purchase_status as enum ('draft','needs_clarification','blocked','verification_required','approval_required','cleared_for_checkout','payment_pending','paid','failed','cancelled');
create type public.enrolment_status as enum ('not_enrolled','pending','enrolled','demo_fixture');
create type public.change_status as enum ('pending_verification','verified_pending_decision','approved','rejected');
create type public.verification_outcome as enum ('confirmed','denied','unreachable');
create type public.reservation_status as enum ('active','released','consumed');
create type public.finding_severity as enum ('info','warning','block');

-- ===== Profiles =====
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  created_at timestamptz not null default now()
);
grant select, update on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(id, email, display_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'display_name', new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)))
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- ===== Organisations & memberships =====
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid not null,
  created_at timestamptz not null default now()
);
grant select on public.organizations to authenticated;
grant all on public.organizations to service_role;
alter table public.organizations enable row level security;

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null,
  role public.member_role not null,
  created_at timestamptz not null default now(),
  unique (org_id, user_id, role)
);
grant select on public.memberships to authenticated;
grant all on public.memberships to service_role;
alter table public.memberships enable row level security;

create or replace function public.is_org_member(_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.memberships where org_id = _org and user_id = auth.uid())
$$;
create or replace function public.has_org_role(_org uuid, _role public.member_role) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.memberships where org_id = _org and user_id = auth.uid() and role = _role)
$$;

create policy "members read org" on public.organizations for select to authenticated using (public.is_org_member(id));
create policy "members read memberships" on public.memberships for select to authenticated using (public.is_org_member(org_id));
create policy "read own or co-member profiles" on public.profiles for select to authenticated using (
  id = auth.uid() or exists (
    select 1 from public.memberships m1 join public.memberships m2 on m1.org_id = m2.org_id
    where m1.user_id = auth.uid() and m2.user_id = profiles.id)
);
create policy "update own profile" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- ===== Spending policies (versioned) =====
create table public.spending_policies (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  version int not null,
  currency text not null,
  timezone text not null,
  weekly_limit_minor bigint not null check (weekly_limit_minor >= 0),
  order_limit_minor bigint not null check (order_limit_minor >= 0),
  approval_threshold_minor bigint not null check (approval_threshold_minor >= 0),
  allowed_categories text[] not null default '{}',
  allowed_supplier_ids uuid[] not null default '{}',
  is_active boolean not null default true,
  is_demo boolean not null default false,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (org_id, version)
);
grant select on public.spending_policies to authenticated;
grant all on public.spending_policies to service_role;
alter table public.spending_policies enable row level security;
create policy "members read policies" on public.spending_policies for select to authenticated using (public.is_org_member(org_id));

-- ===== Suppliers (versioned) =====
create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  status text not null default 'pending_approval' check (status in ('pending_approval','active','suspended')),
  current_version_id uuid,
  is_demo boolean not null default false,
  created_by uuid,
  created_at timestamptz not null default now()
);
grant select on public.suppliers to authenticated;
grant all on public.suppliers to service_role;
alter table public.suppliers enable row level security;
create policy "members read suppliers" on public.suppliers for select to authenticated using (public.is_org_member(org_id));

create table public.supplier_versions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  version int not null,
  paypal_merchant_id text not null,
  recipient_email text,
  trusted_contact_channel text not null,
  trusted_contact_value text not null,
  verification_evidence text,
  enrolment_status public.enrolment_status not null default 'not_enrolled',
  status text not null default 'active' check (status in ('pending_approval','active','superseded')),
  created_by uuid,
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (supplier_id, version)
);
grant select on public.supplier_versions to authenticated;
grant all on public.supplier_versions to service_role;
alter table public.supplier_versions enable row level security;
create policy "members read supplier versions" on public.supplier_versions for select to authenticated using (public.is_org_member(org_id));

-- ===== Approved listings =====
create table public.listings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  name text not null,
  category text not null,
  unit_price_minor bigint not null check (unit_price_minor > 0),
  currency text not null,
  pack_size int not null default 1,
  max_quantity int not null default 10,
  untrusted_description text,
  is_active boolean not null default true,
  source text,
  created_at timestamptz not null default now()
);
grant select on public.listings to authenticated;
grant all on public.listings to service_role;
alter table public.listings enable row level security;
create policy "members read listings" on public.listings for select to authenticated using (public.is_org_member(org_id));

-- ===== Purchases =====
create table public.purchases (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  source public.purchase_source not null,
  supplier_id uuid references public.suppliers(id),
  supplier_version_id uuid references public.supplier_versions(id),
  policy_version_id uuid references public.spending_policies(id),
  title text not null,
  invoice_reference text,
  category text,
  total_minor bigint not null default 0,
  currency text not null,
  requested_recipient text,
  requested_contact text,
  status public.purchase_status not null default 'draft',
  version int not null default 1,
  digest text,
  requested_by uuid not null,
  is_test_fixture boolean not null default false,
  fixture_label text,
  ai_claims jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select on public.purchases to authenticated;
grant all on public.purchases to service_role;
alter table public.purchases enable row level security;
create policy "members read purchases" on public.purchases for select to authenticated using (public.is_org_member(org_id));

create table public.purchase_line_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  purchase_id uuid not null references public.purchases(id) on delete cascade,
  listing_id uuid references public.listings(id),
  description text not null,
  category text,
  quantity int not null check (quantity > 0),
  unit_price_minor bigint not null,
  line_total_minor bigint not null,
  created_at timestamptz not null default now()
);
grant select on public.purchase_line_items to authenticated;
grant all on public.purchase_line_items to service_role;
alter table public.purchase_line_items enable row level security;
create policy "members read line items" on public.purchase_line_items for select to authenticated using (public.is_org_member(org_id));

create table public.invoice_documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  purchase_id uuid not null references public.purchases(id) on delete cascade,
  storage_path text,
  file_name text,
  source_message text,
  uploaded_by uuid,
  created_at timestamptz not null default now()
);
grant select on public.invoice_documents to authenticated;
grant all on public.invoice_documents to service_role;
alter table public.invoice_documents enable row level security;
create policy "members read invoice docs" on public.invoice_documents for select to authenticated using (public.is_org_member(org_id));

create table public.findings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  purchase_id uuid not null references public.purchases(id) on delete cascade,
  purchase_version int not null,
  code text not null,
  severity public.finding_severity not null,
  message text not null,
  next_action text,
  created_at timestamptz not null default now()
);
grant select on public.findings to authenticated;
grant all on public.findings to service_role;
alter table public.findings enable row level security;
create policy "members read findings" on public.findings for select to authenticated using (public.is_org_member(org_id));

create table public.supplier_change_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  purchase_id uuid references public.purchases(id) on delete set null,
  base_version_id uuid not null references public.supplier_versions(id),
  proposed_recipient text not null,
  proposed_contact text,
  proposed_by uuid not null,
  status public.change_status not null default 'pending_verification',
  decided_by uuid,
  decided_at timestamptz,
  decision_note text,
  resulting_version_id uuid references public.supplier_versions(id),
  created_at timestamptz not null default now()
);
grant select on public.supplier_change_requests to authenticated;
grant all on public.supplier_change_requests to service_role;
alter table public.supplier_change_requests enable row level security;
create policy "members read change requests" on public.supplier_change_requests for select to authenticated using (public.is_org_member(org_id));

create table public.verification_records (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  change_request_id uuid references public.supplier_change_requests(id) on delete cascade,
  supplier_id uuid references public.suppliers(id) on delete cascade,
  channel text not null,
  channel_value text not null,
  person_contacted text not null,
  contacted_at timestamptz not null,
  outcome public.verification_outcome not null,
  evidence text not null,
  reviewer_id uuid not null,
  created_at timestamptz not null default now()
);
grant select on public.verification_records to authenticated;
grant all on public.verification_records to service_role;
alter table public.verification_records enable row level security;
create policy "members read verifications" on public.verification_records for select to authenticated using (public.is_org_member(org_id));

create table public.approvals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  purchase_id uuid not null references public.purchases(id) on delete cascade,
  purchase_version int not null,
  digest text not null,
  amount_minor bigint not null,
  currency text not null,
  recipient text,
  supplier_version_id uuid,
  policy_version_id uuid,
  approver_id uuid not null,
  is_valid boolean not null default true,
  invalidated_reason text,
  invalidated_at timestamptz,
  note text,
  created_at timestamptz not null default now()
);
grant select on public.approvals to authenticated;
grant all on public.approvals to service_role;
alter table public.approvals enable row level security;
create policy "members read approvals" on public.approvals for select to authenticated using (public.is_org_member(org_id));

create table public.budget_reservations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  purchase_id uuid not null references public.purchases(id) on delete cascade,
  purchase_version int not null,
  amount_minor bigint not null,
  currency text not null,
  period_start timestamptz not null,
  status public.reservation_status not null default 'active',
  created_by uuid,
  released_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index one_active_reservation_per_purchase on public.budget_reservations(purchase_id) where status = 'active';
grant select on public.budget_reservations to authenticated;
grant all on public.budget_reservations to service_role;
alter table public.budget_reservations enable row level security;
create policy "members read reservations" on public.budget_reservations for select to authenticated using (public.is_org_member(org_id));

-- ===== Payment records (written only by protected backend code later) =====
create table public.payment_attempts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  purchase_id uuid not null references public.purchases(id) on delete cascade,
  purchase_version int not null,
  idempotency_key text not null unique,
  status text not null default 'created',
  error_detail text,
  created_by uuid,
  created_at timestamptz not null default now()
);
create table public.paypal_orders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  payment_attempt_id uuid not null references public.payment_attempts(id) on delete cascade,
  paypal_order_id text not null unique,
  status text not null,
  payee_merchant_id text,
  amount_minor bigint,
  currency text,
  raw jsonb,
  created_at timestamptz not null default now()
);
create table public.paypal_captures (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  paypal_order_row_id uuid not null references public.paypal_orders(id) on delete cascade,
  paypal_capture_id text not null unique,
  status text not null,
  amount_minor bigint,
  currency text,
  raw jsonb,
  created_at timestamptz not null default now()
);
create table public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations(id) on delete cascade,
  provider text not null,
  event_id text not null,
  event_type text not null,
  verified boolean not null default false,
  payload jsonb,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (provider, event_id)
);
grant select on public.payment_attempts, public.paypal_orders, public.paypal_captures, public.webhook_events to authenticated;
grant all on public.payment_attempts, public.paypal_orders, public.paypal_captures, public.webhook_events to service_role;
alter table public.payment_attempts enable row level security;
alter table public.paypal_orders enable row level security;
alter table public.paypal_captures enable row level security;
alter table public.webhook_events enable row level security;
create policy "owners/payers read attempts" on public.payment_attempts for select to authenticated using (public.has_org_role(org_id,'owner') or public.has_org_role(org_id,'payer'));
create policy "owners/payers read orders" on public.paypal_orders for select to authenticated using (public.has_org_role(org_id,'owner') or public.has_org_role(org_id,'payer'));
create policy "owners/payers read captures" on public.paypal_captures for select to authenticated using (public.has_org_role(org_id,'owner') or public.has_org_role(org_id,'payer'));
create policy "owners read webhooks" on public.webhook_events for select to authenticated using (org_id is not null and public.has_org_role(org_id,'owner'));

-- ===== Audit history (hash-chained) =====
create table public.audit_events (
  id bigserial primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  actor_id uuid,
  actor_kind text not null default 'user',
  action text not null,
  entity_type text not null,
  entity_id uuid,
  entity_version int,
  details jsonb not null default '{}',
  prev_hash text,
  hash text,
  created_at timestamptz not null default now()
);
grant select on public.audit_events to authenticated;
grant all on public.audit_events to service_role;
grant usage on sequence public.audit_events_id_seq to service_role;
alter table public.audit_events enable row level security;
create policy "members read audit" on public.audit_events for select to authenticated using (public.is_org_member(org_id));

create or replace function public.audit_hash_chain() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_prev text;
begin
  select hash into v_prev from public.audit_events where org_id = new.org_id order by id desc limit 1;
  new.prev_hash := v_prev;
  new.hash := md5(coalesce(v_prev,'') || new.org_id::text || coalesce(new.actor_id::text,'') || new.action || new.entity_type || coalesce(new.entity_id::text,'') || new.details::text || new.created_at::text);
  return new;
end $$;
create trigger audit_chain before insert on public.audit_events for each row execute function public.audit_hash_chain();
create or replace function public.prevent_audit_mutation() returns trigger language plpgsql as $$
begin raise exception 'Audit history is append-only'; end $$;
create trigger audit_no_update before update or delete on public.audit_events for each row execute function public.prevent_audit_mutation();

create or replace function public.log_audit(_org uuid, _action text, _etype text, _eid uuid, _ever int, _details jsonb, _actor_kind text default 'user')
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_events(org_id, actor_id, actor_kind, action, entity_type, entity_id, entity_version, details)
  values (_org, auth.uid(), _actor_kind, _action, _etype, _eid, _ever, coalesce(_details,'{}'::jsonb));
end $$;
revoke execute on function public.log_audit(uuid,text,text,uuid,int,jsonb,text) from public, anon, authenticated;

-- Tenant-isolation RLS — AC-1.3 / AC-2.4 / AC-5.7.
-- Every tenant-scoped table: a row is visible only when its tenant_id matches
-- the tenant_id of the requesting auth user (resolved via public.users).

-- Helper: the tenant_id of the current authenticated user.
create or replace function public.current_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select tenant_id from public.users where id = auth.uid();
$$;

-- ── tenants ──────────────────────────────────────────────────────────────────
alter table tenants enable row level security;

create policy tenants_select_own on tenants
  for select using (id = public.current_tenant_id());

create policy tenants_update_own on tenants
  for update using (id = public.current_tenant_id());

-- ── users ────────────────────────────────────────────────────────────────────
alter table users enable row level security;

create policy users_select_same_tenant on users
  for select using (tenant_id = public.current_tenant_id());

create policy users_insert_self on users
  for insert with check (id = auth.uid());

-- ── documents ────────────────────────────────────────────────────────────────
alter table documents enable row level security;

create policy documents_tenant_isolation on documents
  for all
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

-- ── document_chunks ──────────────────────────────────────────────────────────
alter table document_chunks enable row level security;

create policy chunks_tenant_isolation on document_chunks
  for all
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

-- ── queries ──────────────────────────────────────────────────────────────────
alter table queries enable row level security;

create policy queries_tenant_isolation on queries
  for all
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

-- ── subscriptions ────────────────────────────────────────────────────────────
alter table subscriptions enable row level security;

create policy subscriptions_select_own on subscriptions
  for select using (tenant_id = public.current_tenant_id());
-- Writes happen server-side via the service role (Stripe webhook); no client policy.

-- ── invitations ──────────────────────────────────────────────────────────────
alter table invitations enable row level security;

create policy invitations_tenant_isolation on invitations
  for all
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

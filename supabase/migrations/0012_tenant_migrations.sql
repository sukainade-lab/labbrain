-- S10 — KSA data migration (PDPL). Per-tenant move EU (Frankfurt) → KSA
-- (AWS me-central-1). This migration adds the run-log / PDPL-evidence table and
-- the live residency pointer. The actual cross-region transfer runs behind the
-- application's MigrationTarget seam (founder-gated runbook); this schema records
-- *that it happened*, verifiably.

-- ── 1. tenants.data_region — the live residency pointer (AC-10.5) ─────────────
-- The app routes a tenant's data operations to the region named here. Flipped to
-- 'ksa-me-central-1' ONLY after a verified migration's cutover. Default keeps every
-- existing lab on the EU instance (no behaviour change until an explicit cutover).
alter table tenants
  add column data_region text not null default 'eu-frankfurt'
    check (data_region in ('eu-frankfurt', 'ksa-me-central-1'));

-- ── 2. tenant_migrations — run log + PDPL evidence (AC-10.5 / AC-10.6) ────────
-- One row per migration run. Status is a monotonic state machine:
--   pending → exported → imported → verified → cutover   (success path)
--   any → failed                                          (terminal failure)
-- The row at status='cutover' is the auditable "who moved what, when, verified
-- how" evidence: started_by (admin email), verification_hash, row_counts, times.
create table tenant_migrations (
  id                 uuid primary key default uuid_generate_v4(),
  tenant_id          uuid not null references tenants(id) on delete cascade,
  source_region      text not null default 'eu-frankfurt',
  target_region      text not null default 'ksa-me-central-1',
  status             text not null default 'pending'
                       check (status in
                         ('pending', 'exported', 'imported', 'verified', 'cutover', 'failed')),
  row_counts         jsonb,
  verification_hash  text,
  started_by         text not null,
  started_at         timestamptz not null default now(),
  finished_at        timestamptz,
  error              text
);
create index tenant_migrations_tenant_idx on tenant_migrations(tenant_id);

-- At most one in-flight migration per tenant (AC-10.6 — a re-invoked run resumes
-- the existing row instead of starting a parallel one; prevents double-migration).
create unique index tenant_migrations_one_active
  on tenant_migrations(tenant_id)
  where status not in ('cutover', 'failed');

-- ── 3. RLS: tenant isolation (AC-10.6 — never leaks across tenants) ───────────
-- Migrations are founder-operated via the service-role client (bypasses RLS to
-- write). This policy is defense-in-depth + lets a lab read ONLY its own migration
-- record (e.g. "your data is being moved to the KSA region"). Sibling to
-- audit_exports_tenant_isolation (AC-9.6).
alter table tenant_migrations enable row level security;

create policy tenant_migrations_tenant_isolation on tenant_migrations
  for all
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

-- ── 4. Surface residency + latest migration status in the founder overview ────
-- The founder panel's migration control (AC-10.1 reachable entry point) needs each
-- tenant's live data_region and the status of its most-recent run. Extend the
-- founder_tenant_overview RPC (0010) with two columns. Return-type changes require
-- a DROP first (create-or-replace can't alter the OUT signature). EXECUTE stays
-- service_role-only — re-granted below exactly as 0010 set it.
drop function if exists public.founder_tenant_overview();

create function public.founder_tenant_overview()
returns table (
  tenant_id            uuid,
  name                 text,
  plan                 text,
  status               text,
  created_at           timestamptz,
  owner_email          text,
  user_count           bigint,
  doc_count            bigint,
  questions_this_month bigint,
  active_interval      text,
  data_region          text,
  migration_status     text
)
language sql
security definer
set search_path = public
as $$
  select
    t.id,
    t.name,
    t.plan,
    t.status,
    t.created_at,
    (select u.email from users u
       where u.tenant_id = t.id and u.role = 'owner'
       order by u.created_at limit 1),
    (select count(*) from users u where u.tenant_id = t.id),
    (select count(*) from documents d where d.tenant_id = t.id),
    (select count(*) from queries q
       where q.tenant_id = t.id
         and q.created_at >= date_trunc('month', now() at time zone 'utc')),
    (select s.price_interval from subscriptions s
       where s.tenant_id = t.id and s.status = 'active'
       order by s.created_at desc limit 1),
    t.data_region,
    (select m.status from tenant_migrations m
       where m.tenant_id = t.id
       order by m.started_at desc limit 1)
  from tenants t
  order by t.created_at desc;
$$;

revoke all on function public.founder_tenant_overview() from public, anon, authenticated;
grant execute on function public.founder_tenant_overview() to service_role;

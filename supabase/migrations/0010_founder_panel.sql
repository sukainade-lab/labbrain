-- S8 — Founder super-admin panel. Two additive, back-compatible constraint
-- widenings so the founder can pause accounts and activate bank-transfer/invoice
-- payments manually. No data migration: existing rows already satisfy the wider
-- check. Access control is unchanged — these are still service-role-only writes
-- behind the PLATFORM_ADMIN_EMAILS gate (no RLS change).

-- ── 1. tenants.status gains 'paused' (AC-8.4) ────────────────────────────────
-- 'paused' is a founder-initiated access freeze, distinct from 'inactive'
-- (never activated) and 'past_due' (provider lifecycle). The proxy blocks the
-- (app) group for any non-'active' status, so a paused lab's users are locked
-- out until the founder unpauses. The inline check from 0001 is named
-- tenants_status_check; drop and re-add it widened.
alter table tenants drop constraint tenants_status_check;
alter table tenants add constraint tenants_status_check
  check (status in ('inactive', 'active', 'past_due', 'paused'));

-- ── 2. subscriptions.provider gains 'manual' (AC-8.5) ────────────────────────
-- "Mark invoice paid" activates a tenant whose payment arrived by bank transfer
-- or official JOD invoice (the BRD's primary buying behavior) — there is no
-- provider webhook, so the founder records the subscription with provider
-- 'manual'. The check from 0008 is named subscriptions_provider_check.
alter table subscriptions drop constraint subscriptions_provider_check;
alter table subscriptions add constraint subscriptions_provider_check
  check (provider in ('stripe', 'tap', 'manual'));

-- ── 3. Cross-tenant overview RPC (AC-8.2 / AC-8.3) ───────────────────────────
-- ONE round-trip powers both the metric cards AND the tenants table: per-tenant
-- usage is aggregated server-side via correlated subqueries (tenant-indexed),
-- never N+1 from the app and never a full-table pull. security definer so the
-- aggregation runs regardless of RLS, but EXECUTE is granted to service_role
-- ONLY — the same role the founder routes use behind the PLATFORM_ADMIN_EMAILS
-- gate. anon/authenticated cannot call it, so no tenant can read another's data
-- through this function (defense in depth on top of the route gate).
create or replace function public.founder_tenant_overview()
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
  active_interval      text
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
       order by s.created_at desc limit 1)
  from tenants t
  order by t.created_at desc;
$$;

-- Supabase grants EXECUTE on public functions to anon + authenticated by default
-- (default privileges), so revoking from PUBLIC alone is not enough — revoke the
-- role grants explicitly, then grant to service_role only. This is what keeps a
-- tenant user (or anon) from reading cross-tenant data through the function.
revoke all on function public.founder_tenant_overview() from public, anon, authenticated;
grant execute on function public.founder_tenant_overview() to service_role;

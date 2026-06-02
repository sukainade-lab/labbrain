-- S9 — Audit export traceability (AC-9.6).
-- Each successful Q&A-log PDF export is recorded in-residency so a lab can show
-- *who* produced *which* evidence *when*. Written via the user-scoped client, so
-- the same tenant-isolation RLS that guards the exported rows guards the log too.

create table audit_exports (
  id            uuid primary key default uuid_generate_v4(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  user_id       uuid references users(id) on delete set null,
  range_from    date,
  range_to      date,
  row_count     int not null default 0,
  created_at    timestamptz not null default now()
);
create index audit_exports_tenant_idx on audit_exports(tenant_id);

-- ── RLS: tenant isolation (AC-9.6 — never leaks across tenants) ───────────────
alter table audit_exports enable row level security;

create policy audit_exports_tenant_isolation on audit_exports
  for all
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

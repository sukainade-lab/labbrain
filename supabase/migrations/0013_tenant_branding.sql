-- S12 — Multi-tenant branding (lab logo in UI header).
-- AC-12.3: tenants gain a single nullable logo_path (one logo per tenant).
-- AC-12.2: public `branding` Storage bucket + path-namespaced RLS so a tenant can
--          only write/read objects under its own {tenant_id}/ prefix.

-- ── 1. Tenants carry the current logo object key (AC-12.3) ────────────────────
-- Nullable: no logo by default → the header falls back to the lab name/wordmark.
-- A single column (not a table) enforces "at most one logo per tenant" by shape.
alter table tenants add column logo_path text;

-- ── 2. Public `branding` bucket + tenant-path RLS (AC-12.2) ───────────────────
-- Objects live under `{tenant_id}/logo.{ext}`. The bucket is PUBLIC-READ so the
-- server-rendered header can reference a stable public URL with no per-request
-- signed-URL refresh — logos are not sensitive. WRITES stay RLS-gated: an
-- authenticated user can only touch objects whose first path segment is their own
-- tenant_id, so Lab A can never overwrite Lab B's logo. Same isolation contract as
-- the private `documents` bucket (migration 0003), just public-read.
insert into storage.buckets (id, name, public)
values ('branding', 'branding', true)
on conflict (id) do nothing;

create policy branding_storage_tenant_isolation on storage.objects
  for all
  to authenticated
  using (
    bucket_id = 'branding'
    and (storage.foldername(name))[1] = public.current_tenant_id()::text
  )
  with check (
    bucket_id = 'branding'
    and (storage.foldername(name))[1] = public.current_tenant_id()::text
  );

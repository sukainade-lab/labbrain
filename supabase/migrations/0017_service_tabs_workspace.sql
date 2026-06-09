-- S18 — Two-panel document workspace (implements updated BRD S2).
-- Adds the data-model foundation for the workspace redesign:
--   • a tenant-scoped `service_tabs` table (the dynamic "خدمة جديدة" / New Service tabs),
--   • workspace tagging columns on `documents` and `document_chunks`,
--   • a verified no-op backfill that migrates every existing document + chunk into the
--     permanent "خدماتي الحالية" (Existing Services) panel with ZERO data loss (AC-2.8).
--
-- These columns are purely ADDITIVE. S18 does not touch retrieval — match_document_chunks
-- and src/lib/qa/ask.ts are unchanged, so existing Q&A keeps working unaltered (AC-2.5).
-- Panel-scoped retrieval filtering is S19; the denormalized chunk columns added here are
-- the seam S19 will pre-filter on.

-- ── 1. service_tabs — the dynamic New Service tabs (AC-2.1) ────────────────────
-- A first-class, tenant-scoped entity that documents/chunks FK to. The permanent
-- "Existing Services" panel is NOT a row here — it is the implicit
-- (panel_type='existing', service_tab_id IS NULL) partition, always present.
-- Deleting a tab cascades its documents (and, via documents→chunks FK, their chunks).
create table service_tabs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  position int not null default 0,
  created_at timestamptz not null default now()
);

create index service_tabs_tenant_idx on service_tabs (tenant_id, position);

-- Tenant isolation (AC-2.5): a lab can only see/insert/update/delete its own tabs.
-- Mirrors the named per-tenant policies on documents/document_chunks (migration 0002).
alter table service_tabs enable row level security;

create policy tenant_isolation_service_tabs on service_tabs
  for all
  to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

-- ── 2. Workspace tagging on documents (AC-2.4) ────────────────────────────────
-- panel_type: which panel the document lives in. DB check constraint — the only two
--   panel types are fixed product concepts. Existing docs default to 'existing'.
-- service_tab_id: the New Service tab a document belongs to (NULL for Existing Services).
--   on delete cascade → removing a tab removes its documents atomically (AC-2.1).
-- doc_section: free text (NOT a DB check) — the two panels have different section
--   vocabularies (Existing: sops/references/equipment; New: references/
--   available_equipment/additional_info), validated app-side per panel_type in
--   src/lib/validation/workspace.ts so the vocabularies stay flexible.
alter table documents
  add column panel_type text not null default 'existing'
    check (panel_type in ('existing', 'new_service')),
  add column service_tab_id uuid references service_tabs(id) on delete cascade,
  add column doc_section text not null default 'references';

-- ── 3. Denormalized tagging on document_chunks (AC-2.4) ───────────────────────
-- Each chunk carries a copy of its parent document's panel_type/service_tab_id,
-- stamped at ingest. Denormalized on purpose: S19's vector pre-filter can scope by
-- panel/tab without joining back to documents on every retrieval.
alter table document_chunks
  add column panel_type text not null default 'existing'
    check (panel_type in ('existing', 'new_service')),
  add column service_tab_id uuid references service_tabs(id) on delete cascade;

-- ── 4. Backfill — migrate existing data into Existing Services (AC-2.8) ────────
-- Existing rows already satisfy the new defaults (panel_type='existing',
-- service_tab_id=NULL) by construction, so these updates are a verified no-op
-- safety net — they make the retrofit explicit and assert ZERO data loss. The
-- guard block fails the migration loudly if any pre-existing row somehow escaped
-- the Existing Services partition.
update documents
  set panel_type = 'existing'
  where panel_type is distinct from 'existing' and service_tab_id is null;

update document_chunks
  set panel_type = 'existing'
  where panel_type is distinct from 'existing' and service_tab_id is null;

do $$
declare
  stray_docs   bigint;
  stray_chunks bigint;
begin
  -- After backfill, every legacy row (no service_tab_id) MUST be in 'existing'.
  select count(*) into stray_docs
    from documents where service_tab_id is null and panel_type <> 'existing';
  select count(*) into stray_chunks
    from document_chunks where service_tab_id is null and panel_type <> 'existing';

  if stray_docs <> 0 or stray_chunks <> 0 then
    raise exception
      'S18 backfill failed: % documents and % chunks not in Existing Services panel',
      stray_docs, stray_chunks;
  end if;
end $$;

-- ── 5. Re-index keeps workspace tags (AC-2.4 holds across a replace) ───────────
-- The S13 atomic swap (migration 0014) re-inserts a document's chunks on replace
-- using a fixed column list that predates these tags — left as-is it would reset a
-- New Service document's chunks back to the 'existing'/NULL defaults. Stamp the
-- parent document's panel_type/service_tab_id on every re-inserted chunk so the
-- denormalized tags survive a replace, exactly as they were set at first ingest.
-- The p_rows shape is unchanged; tags come from the (already tenant-guarded)
-- documents row, never the caller's payload.
create or replace function public.replace_document_chunks(
  p_document_id uuid,
  p_tenant_id   uuid,
  p_rows        jsonb
) returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_panel text;
  v_tab   uuid;
  v_count int;
begin
  -- Guard: the document must exist and belong to the caller's tenant. Without
  -- this an attacker with execute rights could wipe another tenant's chunks.
  select tenant_id, panel_type, service_tab_id
    into v_owner, v_panel, v_tab
    from documents where id = p_document_id;
  if v_owner is null then
    raise exception 'document % not found', p_document_id;
  end if;
  if v_owner <> p_tenant_id then
    raise exception 'tenant mismatch for document %', p_document_id;
  end if;

  -- Atomic swap: drop the old revision's chunks, insert the new revision's. Both
  -- statements share this function's transaction — retrieval never sees a mix.
  delete from document_chunks where document_id = p_document_id;

  insert into document_chunks
    (tenant_id, document_id, chunk_index, content, page_number, section,
     panel_type, service_tab_id, embedding)
  select
    p_tenant_id,
    p_document_id,
    (r->>'chunk_index')::int,
    r->>'content',
    nullif(r->>'page_number', '')::int,
    r->>'section',
    v_panel,
    v_tab,
    (r->>'embedding')::vector
  from jsonb_array_elements(p_rows) as r;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Re-assert the service-role-only grant (create or replace resets privileges to
-- the PUBLIC execute default; migration 0016 locked this down — keep it locked).
revoke all on function public.replace_document_chunks(uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.replace_document_chunks(uuid, uuid, jsonb) to service_role;

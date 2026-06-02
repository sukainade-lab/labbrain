-- S13 — Document versioning: replace a document + re-index without losing Q&A history.
--
-- Q&A history is already decoupled from documents by construction (migration 0001):
-- `queries` has NO foreign key to `documents`, and `queries.citations` is a frozen
-- jsonb snapshot built at answer time (src/lib/qa/citations.ts). So replacing a
-- document never rewrites a prior citation — "without losing Q&A history" needs no
-- migration. What S13 needs is (1) a version counter on the row and (2) an ATOMIC
-- chunk swap, so retrieval never sees a half-replaced document.

-- ── 1. Version counter + updated_at on documents (AC-13.2) ────────────────────
-- A replace mutates the existing row in place: same id, version++, updated_at set,
-- created_at preserved. The library row and its `?doc=ID` citation deep-link stay
-- stable. Existing rows default to version 1.
alter table documents add column version int not null default 1;
alter table documents add column updated_at timestamptz;

-- ── 2. Atomic chunk swap RPC (AC-13.3 / AC-13.5) ─────────────────────────────
-- The Supabase JS client can't run a multi-statement transaction, so the
-- delete-old + insert-new must live inside one function body to be all-or-nothing.
-- This is the ONLY place a document's chunks change during a replace: either the
-- old set is fully replaced by the new set, or nothing changes (parse/embed failed
-- upstream, RPC never called → prior revision stays retrievable).
--
-- Embeddings travel as the existing `toVectorLiteral` text (e.g. "[0.1,0.2,...]")
-- inside each row object and are cast `::vector` here — mirrors the 0006 RPC
-- precedent (atomic op the JS client can't express) and reuses the formatter the
-- ingest path already produces. p_rows shape (one object per chunk):
--   { chunk_index int, content text, page_number int|null,
--     section text|null, embedding text }
-- tenant_id + document_id are passed as scalars and stamped on every row so a
-- caller can never smuggle a cross-tenant row in via the jsonb payload.
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
  v_count int;
begin
  -- Guard: the document must exist and belong to the caller's tenant. Without
  -- this an attacker with execute rights could wipe another tenant's chunks.
  select tenant_id into v_owner from documents where id = p_document_id;
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
    (tenant_id, document_id, chunk_index, content, page_number, section, embedding)
  select
    p_tenant_id,
    p_document_id,
    (r->>'chunk_index')::int,
    r->>'content',
    nullif(r->>'page_number', '')::int,
    r->>'section',
    (r->>'embedding')::vector
  from jsonb_array_elements(p_rows) as r;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Only the service role (the replace pipeline) calls this. Grant explicitly
-- rather than relying on the PUBLIC execute default (lesson from migration 0004).
revoke all on function public.replace_document_chunks(uuid, uuid, jsonb) from public;
grant execute on function public.replace_document_chunks(uuid, uuid, jsonb) to service_role;

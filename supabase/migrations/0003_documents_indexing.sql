-- S2 — Document Upload & Indexing.
-- AC-2.2: add 'indexing' to the document status pipeline (uploading→parsing→indexing→ready).
-- AC-2.3: chunks carry a section heading.
-- AC-2.1 / AC-2.4: private per-tenant Storage bucket + storage RLS path isolation.
-- AC-2.4: match_document_chunks RPC filters tenant_id BEFORE cosine similarity.

-- ── 1. Status pipeline gains 'indexing' (AC-2.2) ─────────────────────────────
alter table documents drop constraint documents_status_check;
alter table documents add constraint documents_status_check
  check (status in ('pending', 'parsing', 'indexing', 'ready', 'failed'));

-- ── 2. Chunks carry section heading (AC-2.2 / AC-2.3) ─────────────────────────
alter table document_chunks add column section text;

-- ── 3. Private Storage bucket + path-namespaced RLS (AC-2.1 / AC-2.4) ─────────
-- Objects live under `{tenant_id}/{document_id}/{filename}`. An authenticated
-- user can only touch objects whose first path segment is their own tenant_id.
insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

create policy documents_storage_tenant_isolation on storage.objects
  for all
  to authenticated
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = public.current_tenant_id()::text
  )
  with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = public.current_tenant_id()::text
  );

-- ── 4. Tenant-scoped vector search RPC (AC-2.4; consumed by S3) ───────────────
-- security definer so it runs with a stable search_path, but the WHERE clause
-- pins results to the caller's tenant via current_tenant_id() (which itself
-- reads auth.uid()). Tenant filter is applied BEFORE similarity ranking.
create or replace function public.match_document_chunks(
  query_embedding vector(1536),
  match_count int default 5,
  similarity_threshold float default 0.75
)
returns table (
  id uuid,
  document_id uuid,
  content text,
  page_number int,
  section text,
  similarity float
)
language sql
stable
security definer
set search_path = public
as $$
  select
    dc.id,
    dc.document_id,
    dc.content,
    dc.page_number,
    dc.section,
    1 - (dc.embedding <=> query_embedding) as similarity
  from public.document_chunks dc
  where dc.tenant_id = public.current_tenant_id()
    and 1 - (dc.embedding <=> query_embedding) >= similarity_threshold
  order by dc.embedding <=> query_embedding
  limit match_count;
$$;

-- ── 5. Swap the chunk vector index ivfflat → HNSW (AC-2.4 retrieval) ──────────
-- The recorded stack decision (CLAUDE.md / tech-stack-decision.md) specifies an
-- HNSW index; 0001 bootstrapped with ivfflat. HNSW gives better recall/latency
-- for cosine search and needs no `lists` tuning. Replace it here.
drop index if exists chunks_embedding_idx;
create index chunks_embedding_idx on document_chunks
  using hnsw (embedding vector_cosine_ops);

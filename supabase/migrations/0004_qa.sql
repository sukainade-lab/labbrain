-- S3 — Bilingual Q&A with Mandatory Citation.
-- Two changes: align the `queries` table to AC-3.7's contract, and extend
-- match_document_chunks to return the document filename the citation needs (AC-3.4).

-- ── 1. Align `queries` columns to AC-3.7 ─────────────────────────────────────
-- 0001 bootstrapped `question`/`answer`; the BRD names them `question_text`/
-- `answer_text` and adds language + found flags for the audit log. No prod data.
alter table queries rename column question to question_text;
alter table queries rename column answer to answer_text;
alter table queries add column question_lang text;
alter table queries add column found_answer boolean not null default false;

-- ── 2. Citation-aware retrieval RPC (AC-3.2 / AC-3.4) ────────────────────────
-- Return type gains `document_filename` so the answer's citation block can show
-- the source document name in one round-trip. Still filters tenant_id BEFORE
-- cosine (the P0 isolation guarantee) and gates on the similarity threshold.
-- Changing the return signature requires drop+recreate (create-or-replace can't
-- alter OUT columns).
drop function if exists public.match_document_chunks(vector(1536), int, float);

create function public.match_document_chunks(
  query_embedding vector(1536),
  match_count int default 5,
  similarity_threshold float default 0.75
)
returns table (
  id uuid,
  document_id uuid,
  document_filename text,
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
    d.filename as document_filename,
    dc.content,
    dc.page_number,
    dc.section,
    1 - (dc.embedding <=> query_embedding) as similarity
  from public.document_chunks dc
  join public.documents d on d.id = dc.document_id
  where dc.tenant_id = public.current_tenant_id()
    and 1 - (dc.embedding <=> query_embedding) >= similarity_threshold
  order by dc.embedding <=> query_embedding
  limit match_count;
$$;

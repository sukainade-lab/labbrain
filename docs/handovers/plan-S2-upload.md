# Plan — S2: Document Upload & Indexing

**Story:** S2 [@WeekendMVP] [loop: domain, compliance]
**ACs:** AC-2.1…2.6 · **Planned:** 2026-06-01 · **Command:** `/2-eo-dev-plan story-2`
**Locked decisions:** chunker = `js-tiktoken` (exact tokens) · pipeline = inline with DB status checkpoints.

## ACs
- **AC-2.1** Upload PDF/DOCX/XLSX ≤50 MB → Supabase Storage under tenant namespace.
- **AC-2.2** LlamaParse extracts text preserving name / page / section headings; status pipeline uploading→parsing→indexing→ready.
- **AC-2.3** Chunk ≤500 tokens / 50 overlap → `text-embedding-3-small` → `document_chunks` (pgvector). Metadata: document_id, tenant_id, page_number, section.
- **AC-2.4** *(security-critical)* pgvector queries filter by `tenant_id` before similarity. Tenant A cannot retrieve Tenant B chunks.
- **AC-2.5** Doc list (name/date/page count/status/delete). Delete removes Storage file + all chunks.
- **AC-2.6** Doc caps: Starter 50 / Pro 200; over-cap → upgrade message.

## Relevant lessons
- **L1 — Test the HTTP seam.** S2 has `/api/documents` POST + DELETE → mandatory route-handler integration tests for every branch.

## Schema changes — migration `0003_documents_indexing.sql`
1. `documents.status` CHECK add `'indexing'` (AC-2.2 flow).
2. `document_chunks` add `section text` (nullable) — section headings (AC-2.2/2.3).
3. Private Storage bucket `documents` + `storage.objects` RLS: path must start with `current_tenant_id()::text || '/'` (AC-2.1 namespace, AC-2.4 storage isolation).
4. RPC `match_document_chunks(query_embedding vector, match_count int, similarity_threshold float)` — security definer, filters `tenant_id = current_tenant_id()` BEFORE cosine similarity (AC-2.4; consumed by S3).

## Approach (TDD, security-first)
1. Migration `0003` + **live AC-2.4 RLS isolation test first** (mirror S1 AC-1.3): two tenants, embed chunks, assert cross-tenant retrieval returns zero.
2. Pure helpers (no `next/*` imports):
   - `lib/documents/chunk.ts` — js-tiktoken splitter (≤500 tok, 50 overlap), carries page_number + section per chunk.
   - `lib/documents/limits.ts` — `PLAN_DOC_LIMITS={starter:50,pro:200}`, `assertDocAvailable(admin, tenantId)` (mirrors `lib/auth/seats.ts`).
   - `lib/validation/documents.ts` — Zod: mime ∈ {pdf,docx,xlsx}, size ≤50 MB.
3. Seam-isolated integrations (lazy clients; mocked in tests, real in prod):
   - `lib/parsing/llamaparse.ts` — upload→poll→{text, pages[], headings}.
   - `lib/ai/embeddings.ts` — `text-embedding-3-small`, batched.
4. Routes:
   - `POST /api/documents` — validate → store `{tenant_id}/{doc_id}/{filename}` → row `parsing` → parse → `indexing` → chunk+embed+insert → `ready` (or `failed`); cap-check → 402.
   - `DELETE /api/documents/[id]` — remove Storage object + cascade chunks (FK on-delete already cascades; explicit Storage cleanup).
5. UI `(app)/documents` — matches `product-demo.jsx` document-library tab: filename, upload date, page count, status badge, delete; upload control with status states. RTL, IBM Plex Arabic, brand tokens (Navy/Amber/BG), 375px.

## Test plan
- AC-2.4 live RLS isolation (never mocked).
- `chunk.ts` unit: boundary at 500, 50-overlap continuity, heading/page propagation.
- `limits.ts` unit + route 402 over-cap.
- `POST /api/documents`: 201 ready · 400 bad-mime · 413 oversize · 402 over-cap (LlamaParse+embeddings mocked at seam; Storage+DB live).
- `DELETE /api/documents/[id]`: 200 cascades (file+chunks gone) · 404 missing · 403 cross-tenant.

## Risks / unknowns
- **Inline pipeline timeout** on very large/slow files — mitigated by DB status checkpoints; job queue deferred to Phase-2.
- `js-tiktoken` new dependency (pure JS, ~small) — approved.
- `0001` uses ivfflat index; HNSW (CLAUDE.md) deferred — ivfflat fine at MVP scale.
- LlamaParse + OpenAI processing-only (transient) → Frankfurt data residency preserved.

## MENA checks
arabic-rtl-checker · mena-mobile-check (375px).

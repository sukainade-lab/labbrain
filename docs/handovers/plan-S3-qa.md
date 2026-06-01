# Plan — S3: Bilingual Q&A with Mandatory Citation

> `/2-eo-dev-plan story-3` · 2026-06-01 · approved by founder. Next: `/3-eo-code`.

## BRD acceptance criteria
- **AC-3.1** — Question input accepts AR + EN; RTL default, EN switches LTR inline; auto language detection (no toggle).
- **AC-3.2** — On submit: pgvector similarity search filtered to tenant chunks (top-5, cosine ≥ 0.75); retrieved chunks → GPT-4o-mini with strict system prompt.
- **AC-3.3** — System prompt: "Answer only from the provided document excerpts. If the answer is not present, respond with: 'لم أجد إجابة لهذا السؤال في وثائقكم.' Do not generate information not present in the source."
- **AC-3.4** — Every answer carries a citation block: document name, section (if available), page. Badge format `📄 [Document Name] — الصفحة [N]`.
- **AC-3.5** — If no chunk scores ≥ 0.75, return the "not found" message in the user's language. NEVER answer from general AI knowledge.
- **AC-3.6** — Arabic answers RTL + IBM Plex Arabic; English technical terms (ISO 17025, calibration, uncertainty) BiDi-isolated inline.
- **AC-3.7** — Persist each Q&A to `queries`: `question_text`, `question_lang`, `answer_text`, `citations` (jsonb), `found_answer` (bool), `tenant_id`, `user_id`, `created_at`.

## P0 safety contract
Per CLAUDE.md: any code path that lets the model answer ungrounded is a P0 bug. **AC-3.5 is load-bearing** — the LLM must not be *called* when nothing clears the 0.75 gate. The orchestrator gates the LLM behind a non-empty retrieval result, and a test asserts `generateAnswer` is NOT called on the not-found path.

## Lessons in force
- **L1 (active)** — test the HTTP seam. S3 has an API route → route-handler integration tests for found / not-found / 400 / 401, or QA caps at 8.
- **S2 review 🔴** — new `(app)` route must be added to `src/proxy.ts` matcher (currently `["/dashboard/:path*","/documents/:path*","/admin/:path*"]`). Plan adds `/qa/:path*`.

## Reuse (do not rebuild)
- `match_document_chunks` RPC (0003): filters `tenant_id` BEFORE cosine, top-N, threshold param. **Call via the user-scoped cookie client** so `current_tenant_id()` resolves via `auth.uid()` — NEVER the admin client (admin → null tenant → zero rows).
- `embedTexts()` (`lib/ai/embeddings.ts`, lazy OpenAI) — embed the question.
- `queries` table + `queries_tenant_isolation` RLS — already enabled.

## Migration 0004_qa.sql
1. Align `queries` to AC-3.7: rename `question`→`question_text`, `answer`→`answer_text`; add `question_lang text`, `found_answer boolean not null default false`. (No prod data.)
2. `drop`+recreate `match_document_chunks` to also return `document_filename` (join `documents`) for AC-3.4. S2 live test still passes (reads `document_id`/row presence only). `db reset` re-applies clean.

## Components (test-first, bottom-up)
- `lib/qa/lang.ts` — `detectLang(text): "ar"|"en"` (Arabic-block heuristic). Pure → unit.
- `lib/qa/prompt.ts` — strict system prompt (AC-3.3 verbatim + exact sentinel), bilingual `NOT_FOUND` map, chunk→context formatter, `isNotFoundAnswer()`. Pure → unit.
- `lib/ai/answer.ts` — lazy GPT-4o-mini seam (mirror embeddings.ts); `generateAnswer({question, chunks, lang})`. Mocked at module boundary.
- `lib/qa/citations.ts` — build `citations` jsonb from chunks (dedupe doc+page; `{document_id, document_name, section, page_number, similarity}`). Pure → unit.
- `lib/qa/ask.ts` (orchestrator) — detect lang → embed → RPC(top-5, 0.75) → if zero chunks: `found=false`, answer=`NOT_FOUND[lang]`, **skip LLM** (AC-3.5) → else generateAnswer + citations, `found = !isNotFoundAnswer` → insert `queries` (AC-3.7) → return `{answer, citations, found, lang}`.
- `POST /api/qa` — auth (401) · zod question non-empty/max-len (400) · `ask()` · 500 guard.
- `(app)/qa/page.tsx` — RTL textarea `dir="auto"`, "🔍 ابحث في وثائقك", `CitationBadge` (📄 doc — الصفحة N) shown only when `found`, answer container `dir="auto"` + IBM Plex Arabic (AC-3.6), matches `product-demo.jsx`. Add `/qa` to `proxy.ts` matcher + nav link.

## Test plan
- **Live found**: seed tenant+doc+chunk w/ known embedding; mock `embedTexts`→matching vector → RPC retrieves live → assert answer + `queries` row `found_answer=true` + citation filename/page.
- **AC-3.5 (P0)**: mock `embedTexts`→orthogonal vector → RPC `[]` → assert not-found sentinel, `found_answer=false`, **`generateAnswer` NOT called**.
- **Route (L1)**: found-200, not-found-200, 400 empty, 401 unauth (real handler; AI+embeddings mocked, RPC+DB live).
- **Units**: `detectLang` (ar/en/mixed), `isNotFoundAnswer`, citations dedupe/shape.

## Risks
- RPC via user-scoped client only (admin → no rows).
- `found_answer` = false when zero chunks OR sentinel returned.
- No new dependency (openai present; lang = regex) → no bundle lesson.
- One synchronous embed+completion request — fine at MVP scale; no `after()`.

## MENA checks
arabic-rtl-checker + mena-mobile-check — 375px, RTL, BiDi isolation, tap targets ≥44px.

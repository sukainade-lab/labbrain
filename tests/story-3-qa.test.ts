import { describe, it } from "vitest";

// Story 3 — Bilingual source-traced Q&A (zero hallucination).
describe("Story 3 — Q&A retrieval", () => {
  it.skip("@AC-3.1 input accepts AR + EN; RTL default, EN switches LTR inline; auto language detection", () => {});
  it.skip("@AC-3.2 pgvector similarity search top-5, cosine ≥0.75, tenant-filtered; chunks → GPT-4o-mini", () => {});
  it.skip("@AC-3.3 strict system prompt — answer only from excerpts; fallback to 'not found' message", () => {});
  it.skip("@AC-3.4 every answer includes citation block: document name, section, page number", () => {});
  it.skip("@AC-3.5 no chunk ≥0.75 → returns 'not found' in user language; never answers from general knowledge", () => {});
  it.skip("@AC-3.6 Arabic RTL with IBM Plex Arabic; EN technical terms BiDi-isolated inline", () => {});
  it.skip("@AC-3.7 each Q&A saved to queries: question/lang/answer/citations/found_answer/tenant/user/created_at", () => {});
});

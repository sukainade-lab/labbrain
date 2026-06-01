import { describe, it } from "vitest";

// Story 2 — Document upload, parsing & embedding.
describe("Story 2 — Upload & indexing", () => {
  it.skip("@AC-2.1 upload accepts PDF/DOCX/XLSX up to 50MB; stored in tenant namespace bucket", () => {});
  it.skip("@AC-2.2 LlamaParse extracts text preserving name/page/headings; status uploading→parsing→indexing→ready", () => {});
  it.skip("@AC-2.3 text chunked ≤500 tokens / 50 overlap; embedded via text-embedding-3-small into pgvector", () => {});
  it.skip("@AC-2.4 vector search filters by tenant_id — Tenant A cannot retrieve Tenant B chunks", () => {});
  it.skip("@AC-2.5 document list shows name/date/pages/status/delete; delete removes file + chunks", () => {});
  it.skip("@AC-2.6 doc caps: Starter=50, Pro=200; over-cap upload shows upgrade message", () => {});
});

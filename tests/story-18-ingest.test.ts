import { describe, it, expect, vi, beforeEach } from "vitest";
import type { createAdminClient } from "@/lib/supabase/admin";

// S18 — service-layer unit tests for workspace tagging in the ingest pipeline
// (src/lib/documents/ingest.ts). Proves AC-2.4: createDocument stamps the
// panel_type/service_tab_id/doc_section on the documents row, and processDocument
// reads those tags back from the parent document and stamps panel_type +
// service_tab_id onto every chunk row (the denormalized copy S19 pre-filters on).
// The admin client + parse/embed seams are mocked, so this runs anywhere.

const parseDocument = vi.fn();
const chunkBlocks = vi.fn();
const embedTexts = vi.fn();

vi.mock("@/lib/parsing/llamaparse", () => ({
  parseDocument: (...a: unknown[]) => parseDocument(...a)
}));
vi.mock("@/lib/ai/embeddings", () => ({
  embedTexts: (...a: unknown[]) => embedTexts(...a),
  toVectorLiteral: (v: number[]) => `[${v.join(",")}]`
}));
vi.mock("@/lib/documents/chunk", () => ({
  chunkBlocks: (...a: unknown[]) => chunkBlocks(...a)
}));
// createDocument calls assertDocAvailable first — stub it to a no-op (cap logic is
// covered by story-2 tests; here we only care about the tag stamping).
vi.mock("@/lib/documents/limits", () => ({
  assertDocAvailable: vi.fn(async () => {})
}));

import { createDocument, processDocument } from "@/lib/documents/ingest";

type Admin = ReturnType<typeof createAdminClient>;

interface AdminOpts {
  // Tags the (fake) documents row reports back to processDocument's readDocumentTags.
  docTags?: { panel_type: string; service_tab_id: string | null };
}

function makeAdmin(opts: AdminOpts = {}) {
  const calls = {
    insert: [] as { table: string; rows: unknown }[],
    update: [] as { table: string; patch: Record<string, unknown> }[]
  };
  const storageApi = {
    upload: vi.fn(async () => ({ error: null })),
    remove: vi.fn(async () => ({ error: null }))
  };
  const admin = {
    storage: { from: vi.fn(() => storageApi) },
    from: vi.fn((table: string) => ({
      insert: vi.fn(async (rows: unknown) => {
        calls.insert.push({ table, rows });
        return { error: null };
      }),
      update: vi.fn((patch: Record<string, unknown>) => {
        calls.update.push({ table, patch });
        return { eq: vi.fn(async () => ({ error: null })) };
      }),
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(async () => ({
            data: opts.docTags ?? { panel_type: "existing", service_tab_id: null },
            error: null
          }))
        }))
      }))
    }))
  } as unknown as Admin;
  return { admin, calls };
}

function fileBlob() {
  return new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46])], { type: "application/pdf" });
}

beforeEach(() => {
  parseDocument.mockReset();
  chunkBlocks.mockReset();
  embedTexts.mockReset();
});

describe("createDocument — stamps workspace tags on the documents row (AC-2.4)", () => {
  it("@AC-2.4 stamps an explicit new_service tab + section on insert", async () => {
    const { admin, calls } = makeAdmin();
    await createDocument({
      admin,
      tenantId: "t1",
      file: fileBlob(),
      filename: "equip-list.pdf",
      mimeType: "application/pdf",
      panelType: "new_service",
      serviceTabId: "tab-9",
      docSection: "available_equipment"
    });
    const docInsert = calls.insert.find((c) => c.table === "documents");
    expect(docInsert).toBeTruthy();
    expect(docInsert!.rows).toMatchObject({
      tenant_id: "t1",
      status: "parsing",
      panel_type: "new_service",
      service_tab_id: "tab-9",
      doc_section: "available_equipment"
    });
  });

  it("@AC-2.8 defaults an untagged upload into Existing Services (existing/null/references)", async () => {
    const { admin, calls } = makeAdmin();
    await createDocument({
      admin,
      tenantId: "t1",
      file: fileBlob(),
      filename: "legacy.pdf",
      mimeType: "application/pdf"
    });
    const docInsert = calls.insert.find((c) => c.table === "documents");
    expect(docInsert!.rows).toMatchObject({
      panel_type: "existing",
      service_tab_id: null,
      doc_section: "references"
    });
  });
});

describe("processDocument — chunks inherit the parent document's tags (AC-2.4)", () => {
  it("@AC-2.4 stamps panel_type + service_tab_id from the parent doc onto every chunk", async () => {
    const { admin, calls } = makeAdmin({
      docTags: { panel_type: "new_service", service_tab_id: "tab-9" }
    });
    parseDocument.mockResolvedValue({ blocks: ["b"], pageCount: 2 });
    chunkBlocks.mockReturnValue([
      { chunkIndex: 0, content: "a", pageNumber: 1, section: "S1" },
      { chunkIndex: 1, content: "b", pageNumber: 2, section: null }
    ]);
    embedTexts.mockResolvedValue([
      [0.1, 0.2],
      [0.3, 0.4]
    ]);

    const res = await processDocument({
      admin,
      tenantId: "t1",
      documentId: "d1",
      file: fileBlob(),
      filename: "equip.pdf"
    });
    expect(res).toEqual({ status: "ready", pageCount: 2, chunkCount: 2 });

    const chunkInsert = calls.insert.find((c) => c.table === "document_chunks");
    expect(chunkInsert).toBeTruthy();
    const rows = chunkInsert!.rows as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.panel_type === "new_service")).toBe(true);
    expect(rows.every((r) => r.service_tab_id === "tab-9")).toBe(true);
    // Sanity: tenant + content still carried through unchanged.
    expect(rows[0]).toMatchObject({ tenant_id: "t1", document_id: "d1", content: "a" });
  });

  it("@AC-2.8 an Existing Services document stamps existing/null onto its chunks", async () => {
    const { admin, calls } = makeAdmin(); // defaults to existing/null
    parseDocument.mockResolvedValue({ blocks: ["b"], pageCount: 1 });
    chunkBlocks.mockReturnValue([{ chunkIndex: 0, content: "c", pageNumber: 1, section: null }]);
    embedTexts.mockResolvedValue([[0.5, 0.6]]);

    await processDocument({
      admin,
      tenantId: "t1",
      documentId: "d1",
      file: fileBlob(),
      filename: "legacy.pdf"
    });
    const rows = calls.insert.find((c) => c.table === "document_chunks")!.rows as Array<
      Record<string, unknown>
    >;
    expect(rows[0].panel_type).toBe("existing");
    expect(rows[0].service_tab_id).toBeNull();
  });
});

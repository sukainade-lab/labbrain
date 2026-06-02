import { describe, it, expect, vi, beforeEach } from "vitest";
import type { createAdminClient } from "@/lib/supabase/admin";

// S13 — service-layer unit tests for the replace + re-index half of
// src/lib/documents/ingest.ts (the "Service (mocked admin client)" layer promised
// in docs/stories/S13.md). The route-seam tests mock these helpers out entirely
// and the live L2 test exercises the real RPC against Postgres, so without this
// file the core staging + atomic-swap + fail-safe behaviour (AC-13.1/13.2/13.3/
// 13.5/13.6) has no direct coverage. The admin client and the parse/embed seams
// are mocked, so this runs anywhere (no live Supabase, no LlamaParse/OpenAI).

const parseDocument = vi.fn();
const chunkBlocks = vi.fn();
const embedTexts = vi.fn();

vi.mock("@/lib/parsing/llamaparse", () => ({
  parseDocument: (...a: unknown[]) => parseDocument(...a)
}));
vi.mock("@/lib/ai/embeddings", () => ({
  embedTexts: (...a: unknown[]) => embedTexts(...a),
  // Mirror the real serializer so we can assert the exact text handed to the RPC.
  toVectorLiteral: (v: number[]) => `[${v.join(",")}]`
}));
vi.mock("@/lib/documents/chunk", () => ({
  chunkBlocks: (...a: unknown[]) => chunkBlocks(...a)
}));

import { replaceDocument, processReplace, DOCUMENTS_BUCKET } from "@/lib/documents/ingest";

type Admin = ReturnType<typeof createAdminClient>;

interface AdminOpts {
  uploadError?: { message: string } | null;
  swapError?: { message: string } | null;
  currentVersion?: number;
}

function makeAdmin(opts: AdminOpts = {}) {
  const calls = {
    bucket: [] as string[],
    upload: [] as { path: string; opts: unknown }[],
    remove: [] as string[][],
    update: [] as { table: string; patch: Record<string, unknown> }[],
    rpc: [] as { fn: string; args: Record<string, unknown> }[]
  };
  const storageApi = {
    upload: vi.fn(async (path: string, _f: unknown, o: unknown) => {
      calls.upload.push({ path, opts: o });
      return { error: opts.uploadError ?? null };
    }),
    remove: vi.fn(async (paths: string[]) => {
      calls.remove.push(paths);
      return { error: null };
    })
  };
  const admin = {
    storage: {
      from: vi.fn((b: string) => {
        calls.bucket.push(b);
        return storageApi;
      })
    },
    from: vi.fn((table: string) => ({
      update: vi.fn((patch: Record<string, unknown>) => {
        calls.update.push({ table, patch });
        return { eq: vi.fn(async () => ({ error: null })) };
      }),
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(async () => ({
            data: { version: opts.currentVersion ?? 1 },
            error: null
          }))
        }))
      }))
    })),
    rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
      calls.rpc.push({ fn, args });
      return { data: null, error: opts.swapError ?? null };
    })
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

describe("replaceDocument — stage the new revision (AC-13.1/13.6)", () => {
  it("@AC-13.1 @AC-13.6 uploads under {tenant}/{id}/{name} (upsert) and flips to parsing", async () => {
    const { admin, calls } = makeAdmin();
    const res = await replaceDocument({
      admin,
      tenantId: "t1",
      documentId: "d1",
      file: fileBlob(),
      filename: "sop-v2.pdf",
      mimeType: "application/pdf",
      previousPath: "t1/d1/sop-v1.pdf"
    });
    expect(res).toEqual({ documentId: "d1", storagePath: "t1/d1/sop-v2.pdf", status: "parsing" });
    expect(calls.bucket).toContain(DOCUMENTS_BUCKET);
    expect(calls.upload[0].path).toBe("t1/d1/sop-v2.pdf");
    expect(calls.upload[0].opts).toMatchObject({ upsert: true, contentType: "application/pdf" });
    expect(calls.update[0]).toEqual({
      table: "documents",
      patch: { filename: "sop-v2.pdf", storage_path: "t1/d1/sop-v2.pdf", status: "parsing" }
    });
  });

  it("@AC-13.6 removes the old object only when the new filename differs (no orphans)", async () => {
    const { admin, calls } = makeAdmin();
    await replaceDocument({
      admin,
      tenantId: "t1",
      documentId: "d1",
      file: fileBlob(),
      filename: "sop-v2.pdf",
      mimeType: "application/pdf",
      previousPath: "t1/d1/sop-v1.pdf"
    });
    expect(calls.remove).toContainEqual(["t1/d1/sop-v1.pdf"]);
  });

  it("@AC-13.6 same-key replace does NOT remove (upsert overwrites the bytes in place)", async () => {
    const { admin, calls } = makeAdmin();
    await replaceDocument({
      admin,
      tenantId: "t1",
      documentId: "d1",
      file: fileBlob(),
      filename: "sop.pdf",
      mimeType: "application/pdf",
      previousPath: "t1/d1/sop.pdf"
    });
    expect(calls.remove).toHaveLength(0);
  });

  it("@AC-13.1 throws (no row mutation) when the storage upload fails", async () => {
    const { admin, calls } = makeAdmin({ uploadError: { message: "boom" } });
    await expect(
      replaceDocument({
        admin,
        tenantId: "t1",
        documentId: "d1",
        file: fileBlob(),
        filename: "sop.pdf",
        mimeType: "application/pdf",
        previousPath: "t1/d1/sop.pdf"
      })
    ).rejects.toThrow(/storage upload failed/);
    expect(calls.update).toHaveLength(0);
  });
});

describe("processReplace — atomic re-index + version bump (AC-13.2/13.3)", () => {
  it("@AC-13.2 @AC-13.3 calls replace_document_chunks with the new rows, then bumps version → ready", async () => {
    const { admin, calls } = makeAdmin({ currentVersion: 1 });
    parseDocument.mockResolvedValue({ blocks: ["b"], pageCount: 7 });
    chunkBlocks.mockReturnValue([
      { chunkIndex: 0, content: "new clause", pageNumber: 1, section: "S1" }
    ]);
    embedTexts.mockResolvedValue([[0.1, 0.2, 0.3]]);

    const res = await processReplace({
      admin,
      tenantId: "t1",
      documentId: "d1",
      file: fileBlob(),
      filename: "sop-v2.pdf"
    });

    expect(res).toEqual({ status: "ready", pageCount: 7, chunkCount: 1, version: 2 });

    // RPC: the single atomic swap point, called with the new rows + scoping ids.
    expect(calls.rpc).toHaveLength(1);
    expect(calls.rpc[0].fn).toBe("replace_document_chunks");
    expect(calls.rpc[0].args).toEqual({
      p_document_id: "d1",
      p_tenant_id: "t1",
      p_rows: [
        {
          chunk_index: 0,
          content: "new clause",
          page_number: 1,
          section: "S1",
          embedding: "[0.1,0.2,0.3]"
        }
      ]
    });

    // Version bump: 1 → 2, with page_count + updated_at stamped, status ready.
    const ready = calls.update.find((u) => u.patch.status === "ready");
    expect(ready).toBeTruthy();
    expect(ready!.patch.version).toBe(2);
    expect(ready!.patch.page_count).toBe(7);
    expect(ready!.patch.updated_at).toEqual(expect.any(String));
  });

  it("@AC-13.3 swaps an empty chunk set (RPC still called with [])", async () => {
    const { admin, calls } = makeAdmin();
    parseDocument.mockResolvedValue({ blocks: [], pageCount: 0 });
    chunkBlocks.mockReturnValue([]);

    const res = await processReplace({
      admin,
      tenantId: "t1",
      documentId: "d1",
      file: fileBlob(),
      filename: "empty.pdf"
    });
    expect(res.chunkCount).toBe(0);
    expect(embedTexts).not.toHaveBeenCalled();
    expect(calls.rpc[0].args.p_rows).toEqual([]);
  });
});

describe("processReplace — fail-safe (AC-13.5)", () => {
  it("@AC-13.5 a parse failure flips to failed and NEVER calls the swap RPC", async () => {
    const { admin, calls } = makeAdmin();
    parseDocument.mockRejectedValue(new Error("llamaparse 422"));

    await expect(
      processReplace({
        admin,
        tenantId: "t1",
        documentId: "d1",
        file: fileBlob(),
        filename: "broken.pdf"
      })
    ).rejects.toThrow(/llamaparse 422/);

    expect(calls.rpc).toHaveLength(0); // old chunks untouched
    expect(calls.update.some((u) => u.patch.status === "failed")).toBe(true);
    expect(calls.update.some((u) => "version" in u.patch)).toBe(false); // version unchanged
  });

  it("@AC-13.5 an embedding-count mismatch flips to failed without swapping", async () => {
    const { admin, calls } = makeAdmin();
    parseDocument.mockResolvedValue({ blocks: ["b"], pageCount: 2 });
    chunkBlocks.mockReturnValue([
      { chunkIndex: 0, content: "a", pageNumber: 1, section: null },
      { chunkIndex: 1, content: "b", pageNumber: 1, section: null }
    ]);
    embedTexts.mockResolvedValue([[0.1, 0.2]]); // 1 vector for 2 chunks

    await expect(
      processReplace({ admin, tenantId: "t1", documentId: "d1", file: fileBlob(), filename: "x.pdf" })
    ).rejects.toThrow(/embedding count mismatch/);
    expect(calls.rpc).toHaveLength(0);
    expect(calls.update.some((u) => u.patch.status === "failed")).toBe(true);
  });

  it("@AC-13.5 a swap-RPC error flips to failed and does NOT bump version", async () => {
    const { admin, calls } = makeAdmin({ swapError: { message: "deadlock" } });
    parseDocument.mockResolvedValue({ blocks: ["b"], pageCount: 3 });
    chunkBlocks.mockReturnValue([{ chunkIndex: 0, content: "a", pageNumber: 1, section: null }]);
    embedTexts.mockResolvedValue([[0.1, 0.2, 0.3]]);

    await expect(
      processReplace({ admin, tenantId: "t1", documentId: "d1", file: fileBlob(), filename: "x.pdf" })
    ).rejects.toThrow(/chunk swap failed/);
    expect(calls.update.some((u) => u.patch.status === "failed")).toBe(true);
    expect(calls.update.some((u) => "version" in u.patch)).toBe(false);
  });
});

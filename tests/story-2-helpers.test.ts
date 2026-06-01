import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { chunkBlocks, countTokens, MAX_CHUNK_TOKENS } from "@/lib/documents/chunk";
import {
  uploadMetaSchema,
  ACCEPTED_MIME,
  MAX_UPLOAD_BYTES,
  extForMime,
  resolveMime
} from "@/lib/validation/documents";
import {
  PLAN_DOC_LIMITS,
  assertDocAvailable,
  DocLimitError,
  countDocuments
} from "@/lib/documents/limits";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const hasLiveSupabase = Boolean(url && serviceKey);

// ── chunk.ts (pure) ──────────────────────────────────────────────────────────
describe("chunk.ts — token-windowed splitter (AC-2.3)", () => {
  it("a short block yields one chunk equal to the trimmed input", () => {
    const chunks = chunkBlocks([{ text: "  short clause about ISO 17025  ", pageNumber: 3, section: "Scope" }]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe("short clause about ISO 17025");
    expect(chunks[0].pageNumber).toBe(3);
    expect(chunks[0].section).toBe("Scope");
    expect(chunks[0].chunkIndex).toBe(0);
  });

  it("section defaults to null when omitted", () => {
    const chunks = chunkBlocks([{ text: "no heading here", pageNumber: 1 }]);
    expect(chunks[0].section).toBeNull();
  });

  it("every chunk stays within the token budget", () => {
    const big = Array.from({ length: 4000 }, (_, i) => `clause-${i}`).join(" ");
    const chunks = chunkBlocks([{ text: big, pageNumber: 1 }]);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(countTokens(c.content)).toBeLessThanOrEqual(MAX_CHUNK_TOKENS);
    }
  });

  it("consecutive chunks overlap (continuity preserved)", () => {
    const big = Array.from({ length: 4000 }, (_, i) => `term ${i}`).join(" ");
    const noOverlap = chunkBlocks([{ text: big, pageNumber: 1 }], { maxTokens: 100, overlap: 0 });
    const withOverlap = chunkBlocks([{ text: big, pageNumber: 1 }], { maxTokens: 100, overlap: 25 });
    // A 25-token carry-over (stride 75 vs 100) forces strictly more chunks.
    expect(withOverlap.length).toBeGreaterThan(noOverlap.length);
  });

  it("propagates page + section per source block and assigns a global monotonic index", () => {
    const chunks = chunkBlocks([
      { text: "page one body", pageNumber: 1, section: "Intro" },
      { text: "page two body", pageNumber: 2, section: "Method" }
    ]);
    expect(chunks.map((c) => c.chunkIndex)).toEqual([0, 1]);
    expect(chunks[0]).toMatchObject({ pageNumber: 1, section: "Intro" });
    expect(chunks[1]).toMatchObject({ pageNumber: 2, section: "Method" });
  });

  it("skips empty / whitespace-only blocks", () => {
    const chunks = chunkBlocks([
      { text: "   ", pageNumber: 1 },
      { text: "real content", pageNumber: 2 }
    ]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].pageNumber).toBe(2);
  });

  it("rejects an invalid overlap", () => {
    expect(() => chunkBlocks([{ text: "x", pageNumber: 1 }], { maxTokens: 10, overlap: 10 })).toThrow();
  });
});

// ── validation/documents.ts (pure) ───────────────────────────────────────────
describe("validation/documents.ts — upload guard (AC-2.1)", () => {
  it.each(Object.entries(ACCEPTED_MIME))("accepts %s", (_ext, mime) => {
    const r = uploadMetaSchema.safeParse({ filename: "doc.pdf", mimeType: mime, sizeBytes: 1024 });
    expect(r.success).toBe(true);
  });

  it("rejects an unsupported MIME type", () => {
    const r = uploadMetaSchema.safeParse({ filename: "x.txt", mimeType: "text/plain", sizeBytes: 10 });
    expect(r.success).toBe(false);
  });

  it("rejects a file over 50MB", () => {
    const r = uploadMetaSchema.safeParse({
      filename: "big.pdf",
      mimeType: ACCEPTED_MIME.pdf,
      sizeBytes: MAX_UPLOAD_BYTES + 1
    });
    expect(r.success).toBe(false);
  });

  it("rejects an empty file", () => {
    const r = uploadMetaSchema.safeParse({ filename: "empty.pdf", mimeType: ACCEPTED_MIME.pdf, sizeBytes: 0 });
    expect(r.success).toBe(false);
  });

  it("maps MIME back to extension", () => {
    expect(extForMime(ACCEPTED_MIME.docx)).toBe("docx");
    expect(extForMime("application/zip")).toBeNull();
  });

  it("trusts an already-accepted declared MIME", () => {
    expect(resolveMime("report.pdf", ACCEPTED_MIME.pdf)).toBe(ACCEPTED_MIME.pdf);
    expect(resolveMime("sheet.xlsx", ACCEPTED_MIME.xlsx)).toBe(ACCEPTED_MIME.xlsx);
  });

  it("infers the MIME from extension when the browser mislabels DOCX/XLSX", () => {
    // Browsers frequently report "" or octet-stream for Office files (AC-2.1).
    expect(resolveMime("clause.docx", "")).toBe(ACCEPTED_MIME.docx);
    expect(resolveMime("clause.docx", "application/octet-stream")).toBe(ACCEPTED_MIME.docx);
    expect(resolveMime("data.xlsx", null)).toBe(ACCEPTED_MIME.xlsx);
    expect(resolveMime("scan.pdf", undefined)).toBe(ACCEPTED_MIME.pdf);
  });

  it("returns null for an unknown extension with no usable declared type", () => {
    expect(resolveMime("notes.txt", "")).toBeNull();
    expect(resolveMime("archive.zip", "application/octet-stream")).toBeNull();
    expect(resolveMime("noext", "")).toBeNull();
  });
});

// ── limits.ts (live: cap enforcement) ────────────────────────────────────────
describe.skipIf(!hasLiveSupabase)("limits.ts — document caps (AC-2.6)", () => {
  let admin: SupabaseClient;
  let tenantId: string;

  beforeAll(async () => {
    admin = createClient(url!, serviceKey!, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
    const { data, error } = await admin
      .from("tenants")
      .insert({ name: `CapLab-${Date.now()}`, plan: "starter" })
      .select()
      .single();
    if (error) throw error;
    tenantId = data.id;
  });

  afterAll(async () => {
    if (admin && tenantId) await admin.from("tenants").delete().eq("id", tenantId);
  });

  it("exposes the plan caps", () => {
    expect(PLAN_DOC_LIMITS.starter).toBe(50);
    expect(PLAN_DOC_LIMITS.pro).toBe(200);
  });

  it("passes under the cap and throws DocLimitError at the cap", async () => {
    // Under the cap → no throw.
    await expect(assertDocAvailable(admin, tenantId)).resolves.toBeUndefined();

    // Fill to the starter cap (50 rows).
    const rows = Array.from({ length: PLAN_DOC_LIMITS.starter }, (_, i) => ({
      tenant_id: tenantId,
      filename: `f${i}.pdf`,
      storage_path: `${tenantId}/f${i}.pdf`,
      status: "ready"
    }));
    const { error } = await admin.from("documents").insert(rows);
    expect(error).toBeNull();
    expect(await countDocuments(admin, tenantId)).toBe(PLAN_DOC_LIMITS.starter);

    // At the cap → DocLimitError.
    await expect(assertDocAvailable(admin, tenantId)).rejects.toBeInstanceOf(DocLimitError);
  });
});

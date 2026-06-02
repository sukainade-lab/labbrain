import { describe, it, expect, beforeEach, vi } from "vitest";

// S13 — HTTP route-handler integration tests for PUT /api/documents/[id]
// (Lesson L1: test the seam, not just the functions behind it). Every branch
// 401/404/403/400/413/200 is exercised against the real handler. The server +
// admin Supabase clients, the ingest service, and observability/analytics are all
// mocked, so this runs ANYWHERE (no live Supabase, no LlamaParse/OpenAI) — the
// validation layer (uploadMetaSchema/resolveMime/MAX_UPLOAD_BYTES) runs for real.

const h = vi.hoisted(() => ({
  state: {
    user: null as { id: string } | null,
    me: null as { tenant_id: string } | null,
    doc: null as { id: string; tenant_id: string; storage_path: string; version: number } | null
  },
  calls: {
    replace: [] as unknown[],
    process: [] as unknown[],
    track: [] as unknown[]
  },
  afterTasks: [] as Array<() => unknown | Promise<unknown>>
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: h.state.user } }) },
    from: () => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: h.state.me }) }) })
    })
  })
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: h.state.doc }) }) })
    })
  })
}));

vi.mock("@/lib/documents/ingest", () => ({
  deleteDocument: vi.fn(),
  replaceDocument: vi.fn(async (input: unknown) => {
    h.calls.replace.push(input);
    return { documentId: h.state.doc!.id, storagePath: "t/d/new.pdf", status: "parsing" };
  }),
  processReplace: vi.fn(async (input: unknown) => {
    h.calls.process.push(input);
  })
}));

vi.mock("@/lib/analytics/posthog-server", () => ({
  track: vi.fn(async (e: unknown) => {
    h.calls.track.push(e);
  })
}));
vi.mock("@/lib/analytics/events", () => ({
  documentUploaded: (userId: string, props: unknown) => ({ userId, props })
}));
vi.mock("@/lib/observability/sentry", () => ({ setSentryTenant: vi.fn() }));
vi.mock("@/lib/observability/log", () => ({ captureError: vi.fn() }));

vi.mock("next/server", async (importActual) => {
  const actual = await importActual<typeof import("next/server")>();
  return {
    ...actual,
    after: (cb: () => unknown | Promise<unknown>) => {
      h.afterTasks.push(cb);
    }
  };
});

import { PUT as documentPUT } from "@/app/api/documents/[id]/route";
import { replaceDocument, processReplace } from "@/lib/documents/ingest";

const DOC_ID = "11111111-1111-1111-1111-111111111111";

function pdf(bytes: number, name = "sop-v2.pdf", type = "application/pdf") {
  return new File([new Uint8Array(bytes)], name, { type });
}

function callPut(id: string, file: File | null, filename?: string) {
  const form = new FormData();
  if (file) form.append("file", file);
  if (filename) form.append("filename", filename);
  return documentPUT(
    new Request(`http://localhost/api/documents/${id}`, { method: "PUT", body: form }),
    { params: Promise.resolve({ id }) }
  );
}

async function runAfterTasks() {
  for (const task of h.afterTasks.splice(0)) await task();
}

beforeEach(() => {
  h.state.user = null;
  h.state.me = null;
  h.state.doc = null;
  h.calls.replace = [];
  h.calls.process = [];
  h.calls.track = [];
  h.afterTasks = [];
  vi.mocked(replaceDocument).mockClear();
  vi.mocked(processReplace).mockClear();
});

describe("PUT /api/documents/[id] — replace (AC-13.1/13.7)", () => {
  it("@AC-13.7 unauthenticated → 401", async () => {
    const res = await callPut(DOC_ID, pdf(1024));
    expect(res.status).toBe(401);
    expect(vi.mocked(replaceDocument)).not.toHaveBeenCalled();
  });

  it("@AC-13.7 authenticated but no tenant row → 401", async () => {
    h.state.user = { id: "u" };
    h.state.me = null;
    const res = await callPut(DOC_ID, pdf(1024));
    expect(res.status).toBe(401);
  });

  it("@AC-13.7 a non-existent document → 404", async () => {
    h.state.user = { id: "u" };
    h.state.me = { tenant_id: "tA" };
    h.state.doc = null;
    const res = await callPut(DOC_ID, pdf(1024));
    expect(res.status).toBe(404);
  });

  it("@AC-13.7 another tenant's document → 403", async () => {
    h.state.user = { id: "u" };
    h.state.me = { tenant_id: "tA" };
    h.state.doc = { id: DOC_ID, tenant_id: "tB", storage_path: "tB/d/old.pdf", version: 1 };
    const res = await callPut(DOC_ID, pdf(1024));
    expect(res.status).toBe(403);
    expect(vi.mocked(replaceDocument)).not.toHaveBeenCalled();
  });

  it("@AC-13.1 missing file → 400", async () => {
    h.state.user = { id: "u" };
    h.state.me = { tenant_id: "tA" };
    h.state.doc = { id: DOC_ID, tenant_id: "tA", storage_path: "tA/d/old.pdf", version: 1 };
    const res = await callPut(DOC_ID, null);
    expect(res.status).toBe(400);
  });

  it("@AC-13.1 unsupported type → 400", async () => {
    h.state.user = { id: "u" };
    h.state.me = { tenant_id: "tA" };
    h.state.doc = { id: DOC_ID, tenant_id: "tA", storage_path: "tA/d/old.pdf", version: 1 };
    const res = await callPut(DOC_ID, pdf(1024, "notes.txt", "text/plain"));
    expect(res.status).toBe(400);
    expect(vi.mocked(replaceDocument)).not.toHaveBeenCalled();
  });

  it("@AC-13.1 over 50MB → 413", async () => {
    h.state.user = { id: "u" };
    h.state.me = { tenant_id: "tA" };
    h.state.doc = { id: DOC_ID, tenant_id: "tA", storage_path: "tA/d/old.pdf", version: 1 };
    const res = await callPut(DOC_ID, pdf(50 * 1024 * 1024 + 1));
    expect(res.status).toBe(413);
  });

  it("@AC-13.1 @AC-13.2 valid replace → 200 parsing, schedules processReplace, echoes version", async () => {
    h.state.user = { id: "u" };
    h.state.me = { tenant_id: "tA" };
    h.state.doc = { id: DOC_ID, tenant_id: "tA", storage_path: "tA/d/old.pdf", version: 3 };

    const res = await callPut(DOC_ID, pdf(2048));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data).toEqual({ documentId: DOC_ID, status: "parsing", version: 3 });

    // replaceDocument got the loaded doc's previousPath + scoping ids (AC-13.6).
    expect(vi.mocked(replaceDocument)).toHaveBeenCalledTimes(1);
    expect(h.calls.replace[0]).toMatchObject({
      tenantId: "tA",
      documentId: DOC_ID,
      previousPath: "tA/d/old.pdf",
      mimeType: "application/pdf"
    });

    // processReplace runs off the response path (via after()), not inline.
    expect(vi.mocked(processReplace)).not.toHaveBeenCalled();
    await runAfterTasks();
    expect(vi.mocked(processReplace)).toHaveBeenCalledTimes(1);

    // PII-free analytics: mime only, no filename.
    expect(h.calls.track).toHaveLength(1);
  });

  it("@AC-13.1 a DOCX mislabeled octet-stream → 200 (extension fallback)", async () => {
    h.state.user = { id: "u" };
    h.state.me = { tenant_id: "tA" };
    h.state.doc = { id: DOC_ID, tenant_id: "tA", storage_path: "tA/d/old.pdf", version: 1 };
    const res = await callPut(DOC_ID, pdf(2048, "clause.docx", "application/octet-stream"));
    expect(res.status).toBe(200);
  });
});

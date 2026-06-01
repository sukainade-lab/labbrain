import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Story 2 — HTTP route-handler integration tests (Lesson L1: test the seam, not
// just the functions behind it). These POST/DELETE to the actual route handlers.
//
// The cookie-bound server client (@/lib/supabase/server) is mocked to supply the
// authenticated user + tenant. The parse + embed seams are mocked (no LlamaParse
// / OpenAI keys in CI). Storage + DB run LIVE via the real service-role admin
// client, so cap enforcement, the bucket, and cascade deletes are exercised.

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const hasLiveSupabase = Boolean(url && serviceKey);

const h = vi.hoisted(() => ({
  state: {
    user: null as { id: string } | null,
    me: null as { tenant_id: string } | null,
    docs: [] as unknown[]
  },
  // Captured `after()` callbacks — parse/index now run off the response path, so
  // the test drives them explicitly to assert the background completion.
  afterTasks: [] as Array<() => unknown | Promise<unknown>>
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: h.state.user } }) },
    from: (table: string) => {
      if (table === "documents") {
        return { select: () => ({ order: async () => ({ data: h.state.docs, error: null }) }) };
      }
      // users
      return { select: () => ({ eq: () => ({ single: async () => ({ data: h.state.me }) }) }) };
    }
  })
}));

// Capture `after()` callbacks instead of letting Next schedule them (there is no
// request scope in a unit test). Keep NextResponse and everything else real.
vi.mock("next/server", async (importActual) => {
  const actual = await importActual<typeof import("next/server")>();
  return {
    ...actual,
    after: (cb: () => unknown | Promise<unknown>) => {
      h.afterTasks.push(cb);
    }
  };
});

// Seam mocks (vi.fn so individual tests can force a failure): deterministic parse
// output + zero-vector embeddings (dim 1536).
vi.mock("@/lib/parsing/llamaparse", () => ({
  parseDocument: vi.fn(async () => ({
    blocks: [
      { text: "ISO 17025 scope clause on calibration uncertainty.", pageNumber: 1, section: "Scope" },
      { text: "Measurement traceability requirements.", pageNumber: 2, section: "Traceability" }
    ],
    pageCount: 2
  }))
}));
vi.mock("@/lib/ai/embeddings", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/ai/embeddings")>();
  return {
    ...actual,
    embedTexts: vi.fn(async (texts: string[]) => texts.map(() => new Array(1536).fill(0)))
  };
});

import { POST as documentsPOST, GET as documentsGET } from "@/app/api/documents/route";
import { DELETE as documentDELETE } from "@/app/api/documents/[id]/route";
import { parseDocument } from "@/lib/parsing/llamaparse";
import { embedTexts } from "@/lib/ai/embeddings";

// Run (and clear) every captured background `after()` task — i.e. drive the
// document from 'parsing' to its terminal state.
async function runAfterTasks() {
  for (const task of h.afterTasks.splice(0)) await task();
}

function pdfFile(bytes: number, name = "iso.pdf", type = "application/pdf") {
  return new File([new Uint8Array(bytes)], name, { type });
}

function postFile(file: File | null) {
  const form = new FormData();
  if (file) form.append("file", file);
  return documentsPOST(new Request("http://localhost/api/documents", { method: "POST", body: form }));
}

function callDelete(id: string) {
  return documentDELETE(new Request(`http://localhost/api/documents/${id}`, { method: "DELETE" }), {
    params: Promise.resolve({ id })
  });
}

describe.skipIf(!hasLiveSupabase)("Story 2 — document route handlers", () => {
  let admin: SupabaseClient;
  const tenantsToReap: string[] = [];
  const pathsToReap: string[] = [];

  async function makeTenant(name: string, plan: "starter" | "pro" = "starter") {
    const { data, error } = await admin
      .from("tenants")
      .insert({ name: `${name}-${Date.now()}`, plan })
      .select("id")
      .single();
    if (error) throw error;
    tenantsToReap.push(data.id);
    return data.id as string;
  }

  beforeAll(() => {
    admin = createClient(url!, serviceKey!, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
  });

  afterAll(async () => {
    if (pathsToReap.length) await admin.storage.from("documents").remove(pathsToReap);
    for (const id of tenantsToReap) await admin.from("tenants").delete().eq("id", id);
  });

  // ── POST /api/documents ──────────────────────────────────────────────────────

  it("@AC-2.1 POST unauthenticated → 401", async () => {
    h.state.user = null;
    h.state.me = null;
    const res = await postFile(pdfFile(10));
    expect(res.status).toBe(401);
  });

  it("@AC-2.1 POST without a file → 400", async () => {
    const tenantId = await makeTenant("NoFile");
    h.state.user = { id: "u" };
    h.state.me = { tenant_id: tenantId };
    const res = await postFile(null);
    expect(res.status).toBe(400);
  });

  it("@AC-2.1 POST with an unsupported MIME → 400", async () => {
    const tenantId = await makeTenant("BadMime");
    h.state.user = { id: "u" };
    h.state.me = { tenant_id: tenantId };
    const res = await postFile(pdfFile(10, "notes.txt", "text/plain"));
    expect(res.status).toBe(400);
  });

  it("@AC-2.1 POST over 50MB → 413", async () => {
    const tenantId = await makeTenant("TooBig");
    h.state.user = { id: "u" };
    h.state.me = { tenant_id: tenantId };
    const res = await postFile(pdfFile(50 * 1024 * 1024 + 1));
    expect(res.status).toBe(413);
  });

  it("@AC-2.2 @AC-2.3 POST a valid PDF → 201 parsing, then background → ready + chunks", async () => {
    const tenantId = await makeTenant("HappyPath");
    h.state.user = { id: "u" };
    h.state.me = { tenant_id: tenantId };

    // The response returns immediately at 'parsing' (parse/index run off-thread).
    const res = await postFile(pdfFile(2048));
    const data = await res.json();
    expect(res.status).toBe(201);
    expect(data.status).toBe("parsing");

    const { data: pending } = await admin
      .from("documents")
      .select("status, storage_path")
      .eq("id", data.documentId)
      .single();
    expect(pending!.status).toBe("parsing");
    pathsToReap.push(pending!.storage_path);

    // Drive the background pipeline → 'ready' with page_count + chunks persisted.
    await runAfterTasks();

    const { data: doc } = await admin
      .from("documents")
      .select("status, page_count")
      .eq("id", data.documentId)
      .single();
    expect(doc!.status).toBe("ready");
    expect(doc!.page_count).toBe(2);

    const { count } = await admin
      .from("document_chunks")
      .select("id", { count: "exact", head: true })
      .eq("document_id", data.documentId);
    expect(count).toBeGreaterThan(0);
  });

  it("@AC-2.2 a parse failure flips the document to 'failed'", async () => {
    const tenantId = await makeTenant("ParseFail");
    h.state.user = { id: "u" };
    h.state.me = { tenant_id: tenantId };
    vi.mocked(parseDocument).mockRejectedValueOnce(new Error("llamaparse boom"));

    // Upload + row creation still succeed → 201 parsing.
    const res = await postFile(pdfFile(2048));
    const data = await res.json();
    expect(res.status).toBe(201);
    expect(data.status).toBe("parsing");

    await runAfterTasks(); // background pipeline throws → catch flips to 'failed'

    const { data: doc } = await admin
      .from("documents")
      .select("status, storage_path")
      .eq("id", data.documentId)
      .single();
    expect(doc!.status).toBe("failed");
    pathsToReap.push(doc!.storage_path);

    // No partial chunks should be left behind for a failed parse.
    const { count } = await admin
      .from("document_chunks")
      .select("id", { count: "exact", head: true })
      .eq("document_id", data.documentId);
    expect(count).toBe(0);
  });

  it("@AC-2.3 an embedding count mismatch flips the document to 'failed'", async () => {
    const tenantId = await makeTenant("EmbedMismatch");
    h.state.user = { id: "u" };
    h.state.me = { tenant_id: tenantId };
    // Fewer vectors than chunks → processDocument must reject, not corrupt rows.
    vi.mocked(embedTexts).mockResolvedValueOnce([]);

    const res = await postFile(pdfFile(2048));
    const data = await res.json();
    expect(res.status).toBe(201);

    await runAfterTasks();

    const { data: doc } = await admin
      .from("documents")
      .select("status, storage_path")
      .eq("id", data.documentId)
      .single();
    expect(doc!.status).toBe("failed");
    pathsToReap.push(doc!.storage_path);

    const { count } = await admin
      .from("document_chunks")
      .select("id", { count: "exact", head: true })
      .eq("document_id", data.documentId);
    expect(count).toBe(0);
  });

  it("@AC-2.1 POST a DOCX the browser mislabels as octet-stream → 201 (extension fallback)", async () => {
    const tenantId = await makeTenant("OctetDocx");
    h.state.user = { id: "u" };
    h.state.me = { tenant_id: tenantId };

    // Browsers routinely tag DOCX uploads "" or octet-stream; resolveMime must
    // recover the real type from the .docx extension so a valid file isn't
    // wrongly 400'd (AC-2.1).
    const res = await postFile(pdfFile(2048, "clause.docx", "application/octet-stream"));
    const data = await res.json();
    expect(res.status).toBe(201);
    expect(data.status).toBe("parsing");

    await runAfterTasks();

    const { data: doc } = await admin
      .from("documents")
      .select("status, storage_path")
      .eq("id", data.documentId)
      .single();
    expect(doc!.status).toBe("ready");
    pathsToReap.push(doc!.storage_path);
  });

  it("@AC-2.6 POST against a tenant at the doc cap → 402", async () => {
    const tenantId = await makeTenant("AtCap");
    h.state.user = { id: "u" };
    h.state.me = { tenant_id: tenantId };

    // Fill to the starter cap of 50 with bare rows (no storage needed).
    const rows = Array.from({ length: 50 }, (_, i) => ({
      tenant_id: tenantId,
      filename: `f${i}.pdf`,
      storage_path: `${tenantId}/f${i}.pdf`,
      status: "ready"
    }));
    await admin.from("documents").insert(rows);

    const res = await postFile(pdfFile(1024));
    const data = await res.json();
    expect(res.status).toBe(402);
    expect(data.code).toBe("doc_limit");
  });

  // ── GET /api/documents ───────────────────────────────────────────────────────

  it("@AC-2.5 GET unauthenticated → 401", async () => {
    h.state.user = null;
    const res = await documentsGET();
    expect(res.status).toBe(401);
  });

  it("@AC-2.5 @AC-2.6 GET authenticated → 200 with the list + plan/cap context", async () => {
    const tenantId = await makeTenant("GetList", "starter");
    h.state.user = { id: "u" };
    h.state.me = { tenant_id: tenantId };
    h.state.docs = [{ id: "d1", filename: "a.pdf", status: "ready", page_count: 3 }];
    const res = await documentsGET();
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.documents).toHaveLength(1);
    expect(data.plan).toBe("starter");
    expect(data.limit).toBe(50);
  });

  // ── DELETE /api/documents/[id] ────────────────────────────────────────────────

  it("@AC-2.5 DELETE unauthenticated → 401", async () => {
    h.state.user = null;
    h.state.me = null;
    const res = await callDelete("00000000-0000-0000-0000-000000000000");
    expect(res.status).toBe(401);
  });

  it("@AC-2.5 DELETE a non-existent id → 404", async () => {
    const tenantId = await makeTenant("DelMissing");
    h.state.user = { id: "u" };
    h.state.me = { tenant_id: tenantId };
    const res = await callDelete("11111111-1111-1111-1111-111111111111");
    expect(res.status).toBe(404);
  });

  it("@AC-2.5 DELETE another tenant's document → 403", async () => {
    const tenantA = await makeTenant("DelOwner");
    const tenantB = await makeTenant("DelOther");
    const { data: bDoc } = await admin
      .from("documents")
      .insert({ tenant_id: tenantB, filename: "b.pdf", storage_path: `${tenantB}/b.pdf`, status: "ready" })
      .select("id")
      .single();

    h.state.user = { id: "u" };
    h.state.me = { tenant_id: tenantA };
    const res = await callDelete(bDoc!.id);
    expect(res.status).toBe(403);
  });

  it("@AC-2.5 DELETE own document → 200, row + chunks gone", async () => {
    const tenantId = await makeTenant("DelHappy");
    h.state.user = { id: "u" };
    h.state.me = { tenant_id: tenantId };

    // Create via the real upload pipeline so storage + chunks exist.
    const created = await (await postFile(pdfFile(2048))).json();
    expect(created.status).toBe("parsing");
    await runAfterTasks(); // drive to 'ready' so chunks are present to cascade

    const res = await callDelete(created.documentId);
    expect(res.status).toBe(200);

    const { data: gone } = await admin
      .from("documents")
      .select("id")
      .eq("id", created.documentId)
      .maybeSingle();
    expect(gone).toBeNull();

    const { count } = await admin
      .from("document_chunks")
      .select("id", { count: "exact", head: true })
      .eq("document_id", created.documentId);
    expect(count).toBe(0);
  });
});

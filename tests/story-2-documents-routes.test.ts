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
  }
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

// Seam mocks: deterministic parse output + zero-vector embeddings (dim 1536).
vi.mock("@/lib/parsing/llamaparse", () => ({
  parseDocument: async () => ({
    blocks: [
      { text: "ISO 17025 scope clause on calibration uncertainty.", pageNumber: 1, section: "Scope" },
      { text: "Measurement traceability requirements.", pageNumber: 2, section: "Traceability" }
    ],
    pageCount: 2
  })
}));
vi.mock("@/lib/ai/embeddings", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/ai/embeddings")>();
  return {
    ...actual,
    embedTexts: async (texts: string[]) => texts.map(() => new Array(1536).fill(0))
  };
});

import { POST as documentsPOST, GET as documentsGET } from "@/app/api/documents/route";
import { DELETE as documentDELETE } from "@/app/api/documents/[id]/route";

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

  it("@AC-2.2 @AC-2.3 POST a valid PDF → 201 ready, chunks + page_count persisted", async () => {
    const tenantId = await makeTenant("HappyPath");
    h.state.user = { id: "u" };
    h.state.me = { tenant_id: tenantId };

    const res = await postFile(pdfFile(2048));
    const data = await res.json();
    expect(res.status).toBe(201);
    expect(data.status).toBe("ready");
    expect(data.pageCount).toBe(2);
    expect(data.chunkCount).toBeGreaterThan(0);

    const { data: doc } = await admin
      .from("documents")
      .select("status, page_count, storage_path")
      .eq("id", data.documentId)
      .single();
    expect(doc!.status).toBe("ready");
    expect(doc!.page_count).toBe(2);
    pathsToReap.push(doc!.storage_path);

    const { count } = await admin
      .from("document_chunks")
      .select("id", { count: "exact", head: true })
      .eq("document_id", data.documentId);
    expect(count).toBe(data.chunkCount);
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

  it("@AC-2.5 GET authenticated → 200 with the document list", async () => {
    h.state.user = { id: "u" };
    h.state.docs = [{ id: "d1", filename: "a.pdf", status: "ready", page_count: 3 }];
    const res = await documentsGET();
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.documents).toHaveLength(1);
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
    expect(created.status).toBe("ready");

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

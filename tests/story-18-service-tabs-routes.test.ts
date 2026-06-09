import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// S18 — HTTP route-handler integration tests (Lesson L1: test the seam per branch).
// /api/service-tabs GET/POST/DELETE + the extended /api/documents POST tagging path.
//
// The cookie-bound server client (@/lib/supabase/server) is mocked to supply the
// authenticated user + tenant; parse/embed seams are mocked. Storage + DB run LIVE
// via the real service-role admin client, so the FK cascade + tab ownership guard
// are exercised against real Postgres.

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const hasLiveSupabase = Boolean(url && serviceKey);

const h = vi.hoisted(() => ({
  state: {
    user: null as { id: string } | null,
    me: null as { tenant_id: string } | null
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

vi.mock("next/server", async (importActual) => {
  const actual = await importActual<typeof import("next/server")>();
  return {
    ...actual,
    after: (cb: () => unknown | Promise<unknown>) => {
      h.afterTasks.push(cb);
    }
  };
});

vi.mock("@/lib/parsing/llamaparse", () => ({
  parseDocument: vi.fn(async () => ({
    blocks: [{ text: "clause", pageNumber: 1, section: "Scope" }],
    pageCount: 1
  }))
}));
vi.mock("@/lib/ai/embeddings", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/ai/embeddings")>();
  return {
    ...actual,
    embedTexts: vi.fn(async (texts: string[]) => texts.map(() => new Array(1536).fill(0)))
  };
});

import {
  GET as tabsGET,
  POST as tabsPOST,
  DELETE as tabsDELETE
} from "@/app/api/service-tabs/route";
import { POST as documentsPOST } from "@/app/api/documents/route";

async function runAfterTasks() {
  for (const task of h.afterTasks.splice(0)) await task();
}

function jsonReq(method: string, body: unknown) {
  return new Request("http://localhost/api/service-tabs", {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "content-type": "application/json" }
  });
}

function postDoc(fields: Record<string, string>) {
  const form = new FormData();
  form.append("file", new File([new Uint8Array(2048)], "doc.pdf", { type: "application/pdf" }));
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  return documentsPOST(
    new Request("http://localhost/api/documents", { method: "POST", body: form })
  );
}

describe.skipIf(!hasLiveSupabase)("Story 18 — service-tabs + documents tagging routes", () => {
  let admin: SupabaseClient;
  const tenantsToReap: string[] = [];
  const pathsToReap: string[] = [];

  async function makeTenant(name: string) {
    const { data, error } = await admin
      .from("tenants")
      .insert({ name: `${name}-${Date.now()}-${Math.random().toString(36).slice(2)}` })
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

  // ── GET /api/service-tabs ──────────────────────────────────────────────────────

  it("@AC-2.9 GET unauthenticated → 401", async () => {
    h.state.user = null;
    h.state.me = null;
    const res = await tabsGET();
    expect(res.status).toBe(401);
  });

  it("@AC-2.1 GET authenticated → 200 with only the tenant's tabs", async () => {
    const tenantId = await makeTenant("TabsGet");
    await admin.from("service_tabs").insert({ tenant_id: tenantId, name: "خدمة أولى", position: 0 });
    h.state.user = { id: "u" };
    h.state.me = { tenant_id: tenantId };
    const res = await tabsGET();
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.tabs).toHaveLength(1);
    expect(data.tabs[0].name).toBe("خدمة أولى");
  });

  // ── POST /api/service-tabs ─────────────────────────────────────────────────────

  it("@AC-2.9 POST unauthenticated → 401", async () => {
    h.state.user = null;
    h.state.me = null;
    const res = await tabsPOST(jsonReq("POST", { name: "x" }));
    expect(res.status).toBe(401);
  });

  it("@AC-2.1 POST with an empty name → 400", async () => {
    const tenantId = await makeTenant("TabsBadName");
    h.state.user = { id: "u" };
    h.state.me = { tenant_id: tenantId };
    const res = await tabsPOST(jsonReq("POST", { name: "   " }));
    expect(res.status).toBe(400);
  });

  it("@AC-2.1 POST a valid name → 201 and the row exists for that tenant", async () => {
    const tenantId = await makeTenant("TabsCreate");
    h.state.user = { id: "u" };
    h.state.me = { tenant_id: tenantId };
    const res = await tabsPOST(jsonReq("POST", { name: "خدمة جديدة New" }));
    const data = await res.json();
    expect(res.status).toBe(201);
    expect(data.tab.name).toBe("خدمة جديدة New");

    const { data: rows } = await admin
      .from("service_tabs")
      .select("id, tenant_id")
      .eq("tenant_id", tenantId);
    expect(rows).toHaveLength(1);
    expect(rows![0].id).toBe(data.tab.id);
  });

  // ── DELETE /api/service-tabs ───────────────────────────────────────────────────

  it("@AC-2.9 DELETE unauthenticated → 401", async () => {
    h.state.user = null;
    h.state.me = null;
    const res = await tabsDELETE(jsonReq("DELETE", { id: "11111111-1111-1111-1111-111111111111" }));
    expect(res.status).toBe(401);
  });

  it("@AC-2.1 DELETE a non-existent / foreign tab → 404", async () => {
    const tenantId = await makeTenant("TabsDelMissing");
    h.state.user = { id: "u" };
    h.state.me = { tenant_id: tenantId };
    const res = await tabsDELETE(jsonReq("DELETE", { id: "11111111-1111-1111-1111-111111111111" }));
    expect(res.status).toBe(404);
  });

  it("@AC-2.1 DELETE another tenant's tab → 404 (not removed)", async () => {
    const tenantA = await makeTenant("TabsDelA");
    const tenantB = await makeTenant("TabsDelB");
    const { data: bTab } = await admin
      .from("service_tabs")
      .insert({ tenant_id: tenantB, name: "B tab", position: 0 })
      .select("id")
      .single();

    h.state.user = { id: "u" };
    h.state.me = { tenant_id: tenantA };
    const res = await tabsDELETE(jsonReq("DELETE", { id: bTab!.id }));
    expect(res.status).toBe(404);

    const { data: still } = await admin.from("service_tabs").select("id").eq("id", bTab!.id);
    expect(still).toHaveLength(1); // untouched
  });

  it("@AC-2.1 DELETE own tab → 200 and cascades its documents + chunks", async () => {
    const tenantId = await makeTenant("TabsDelHappy");
    const { data: tab } = await admin
      .from("service_tabs")
      .insert({ tenant_id: tenantId, name: "Cascade tab", position: 0 })
      .select("id")
      .single();
    const { data: doc } = await admin
      .from("documents")
      .insert({
        tenant_id: tenantId,
        filename: "d.pdf",
        storage_path: `${tenantId}/${tab!.id}/d.pdf`,
        status: "ready",
        panel_type: "new_service",
        service_tab_id: tab!.id,
        doc_section: "references"
      })
      .select("id")
      .single();
    await admin.from("document_chunks").insert({
      tenant_id: tenantId,
      document_id: doc!.id,
      chunk_index: 0,
      content: "c",
      page_number: 1,
      section: null,
      panel_type: "new_service",
      service_tab_id: tab!.id,
      embedding: `[${new Array(1536).fill(0).join(",")}]`
    });

    h.state.user = { id: "u" };
    h.state.me = { tenant_id: tenantId };
    const res = await tabsDELETE(jsonReq("DELETE", { id: tab!.id }));
    expect(res.status).toBe(200);

    const { data: docs } = await admin.from("documents").select("id").eq("id", doc!.id);
    expect(docs).toHaveLength(0);
    const { count } = await admin
      .from("document_chunks")
      .select("id", { count: "exact", head: true })
      .eq("document_id", doc!.id);
    expect(count).toBe(0);
  });

  // ── Extended POST /api/documents (workspace tagging) ───────────────────────────

  it("@AC-2.4 POST new_service WITHOUT a service_tab_id → 400", async () => {
    const tenantId = await makeTenant("DocNoTab");
    h.state.user = { id: "u" };
    h.state.me = { tenant_id: tenantId };
    const res = await postDoc({ panel_type: "new_service", doc_section: "references" });
    expect(res.status).toBe(400);
  });

  it("@AC-2.4 POST new_service with a FOREIGN service_tab_id → 400", async () => {
    const tenantA = await makeTenant("DocOwner");
    const tenantB = await makeTenant("DocForeign");
    const { data: bTab } = await admin
      .from("service_tabs")
      .insert({ tenant_id: tenantB, name: "B tab", position: 0 })
      .select("id")
      .single();

    h.state.user = { id: "u" };
    h.state.me = { tenant_id: tenantA };
    const res = await postDoc({
      panel_type: "new_service",
      service_tab_id: bTab!.id,
      doc_section: "references"
    });
    expect(res.status).toBe(400);
  });

  it("@AC-2.4 POST new_service with an OWNED tab → 201, doc + chunks tagged", async () => {
    const tenantId = await makeTenant("DocTagged");
    const { data: tab } = await admin
      .from("service_tabs")
      .insert({ tenant_id: tenantId, name: "Owned tab", position: 0 })
      .select("id")
      .single();

    h.state.user = { id: "u" };
    h.state.me = { tenant_id: tenantId };
    const res = await postDoc({
      panel_type: "new_service",
      service_tab_id: tab!.id,
      doc_section: "available_equipment"
    });
    const data = await res.json();
    expect(res.status).toBe(201);

    const { data: doc } = await admin
      .from("documents")
      .select("panel_type, service_tab_id, doc_section, storage_path")
      .eq("id", data.documentId)
      .single();
    expect(doc!.panel_type).toBe("new_service");
    expect(doc!.service_tab_id).toBe(tab!.id);
    expect(doc!.doc_section).toBe("available_equipment");
    pathsToReap.push(doc!.storage_path);

    // Drive the background pipeline → chunks inherit the tab tag.
    await runAfterTasks();
    const { data: chunks } = await admin
      .from("document_chunks")
      .select("panel_type, service_tab_id")
      .eq("document_id", data.documentId);
    expect(chunks!.length).toBeGreaterThan(0);
    expect(chunks!.every((c) => c.panel_type === "new_service" && c.service_tab_id === tab!.id)).toBe(
      true
    );
  });

  it("@AC-2.8 POST with NO workspace fields → 201 into Existing Services (defaults)", async () => {
    const tenantId = await makeTenant("DocDefault");
    h.state.user = { id: "u" };
    h.state.me = { tenant_id: tenantId };
    const res = await postDoc({});
    const data = await res.json();
    expect(res.status).toBe(201);

    const { data: doc } = await admin
      .from("documents")
      .select("panel_type, service_tab_id, doc_section, storage_path")
      .eq("id", data.documentId)
      .single();
    expect(doc!.panel_type).toBe("existing");
    expect(doc!.service_tab_id).toBeNull();
    expect(doc!.doc_section).toBe("references");
    pathsToReap.push(doc!.storage_path);
    await runAfterTasks();
  });
});

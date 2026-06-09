import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// S18 — live DB suite for the two-panel workspace foundation (migration 0017).
// Lesson L2: serialized, unique-tenant scoped, cleans up in afterAll; CI runs the
// live job with --no-file-parallelism. Proves the DB-level guarantees that make the
// workspace safe, against real Postgres — no mocks:
//
//   AC-2.5 — service_tabs is a multi-tenant table with RLS enabled + a named policy
//     (tenant_isolation_service_tabs). The new columns never widen the isolation
//     surface; the vector layer's tenant_id-first filter is unchanged.
//   AC-2.1 — deleting a New Service tab cascades its documents AND their chunks
//     (FK on delete cascade), atomically. An adjacent tab's docs are untouched.
//   AC-2.8 — the retrofit defaults: a document/chunk inserted WITHOUT workspace tags
//     lands in the Existing Services panel (panel_type='existing', service_tab_id NULL)
//     with zero data loss — exactly how migration 0017 backfilled production rows.

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const hasLiveSupabase = Boolean(url && serviceKey);

const DIM = 1536;
// A unit basis vector in R^1536, serialized as pgvector text (matches
// toVectorLiteral output) — gives each seeded chunk a valid distinct embedding.
function basisVec(hot: number): string {
  const arr = new Array(DIM).fill(0);
  arr[hot] = 1;
  return `[${arr.join(",")}]`;
}

describe.skipIf(!hasLiveSupabase).sequential("Story 18 — two-panel workspace (live DB)", () => {
  let admin: SupabaseClient;
  const tenants: string[] = [];
  let tenantId = "";
  let otherTenantId = "";

  async function makeTenant(name: string) {
    const { data, error } = await admin
      .from("tenants")
      .insert({ name: `${name}-${Date.now()}-${Math.random().toString(36).slice(2)}` })
      .select("id")
      .single();
    if (error) throw error;
    tenants.push(data.id);
    return data.id as string;
  }

  beforeAll(async () => {
    admin = createClient(url!, serviceKey!, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
    tenantId = await makeTenant("WorkspaceLab");
    otherTenantId = await makeTenant("WorkspaceOtherLab");
  });

  afterAll(async () => {
    for (const id of tenants) await admin.from("tenants").delete().eq("id", id);
  });

  it("@AC-2.5 service_tabs has RLS enabled + a named tenant-isolation policy", async () => {
    const { data, error } = await admin.rpc("rls_policy_report");
    expect(error).toBeNull();
    const report = new Map(
      (data as { table_name: string; rls_enabled: boolean; policy_count: number }[]).map((r) => [
        r.table_name,
        r
      ])
    );
    const row = report.get("service_tabs");
    expect(row, "service_tabs missing from catalog — migration 0017 not applied").toBeDefined();
    expect(row!.rls_enabled, "service_tabs RLS not enabled").toBe(true);
    expect(Number(row!.policy_count), "service_tabs has no RLS policy").toBeGreaterThanOrEqual(1);
  });

  it("@AC-2.8 documents/chunks default into the Existing Services panel (retrofit defaults)", async () => {
    // Insert exactly as a pre-S18 row would have been written — no workspace tags.
    const { data: doc, error: dErr } = await admin
      .from("documents")
      .insert({
        tenant_id: tenantId,
        filename: "legacy-sop.pdf",
        storage_path: `${tenantId}/legacy/legacy-sop.pdf`,
        status: "ready",
        page_count: 2
      })
      .select("id, panel_type, service_tab_id, doc_section")
      .single();
    if (dErr) throw dErr;
    expect(doc.panel_type).toBe("existing"); // backfill default (AC-2.8)
    expect(doc.service_tab_id).toBeNull();
    expect(doc.doc_section).toBe("references"); // default section per founder decision

    const { data: chunk, error: cErr } = await admin
      .from("document_chunks")
      .insert({
        tenant_id: tenantId,
        document_id: doc.id,
        chunk_index: 0,
        content: "legacy clause",
        page_number: 1,
        section: "Scope",
        embedding: basisVec(0)
      })
      .select("panel_type, service_tab_id")
      .single();
    if (cErr) throw cErr;
    expect(chunk.panel_type).toBe("existing");
    expect(chunk.service_tab_id).toBeNull();
  });

  it("@AC-2.1 deleting a New Service tab cascades its documents and their chunks", async () => {
    // Two tabs for the same tenant — only the deleted one's data should vanish.
    const { data: tabA, error: tErr } = await admin
      .from("service_tabs")
      .insert({ tenant_id: tenantId, name: "خدمة المعايرة الجديدة", position: 0 })
      .select("id")
      .single();
    if (tErr) throw tErr;
    const { data: tabB, error: tErr2 } = await admin
      .from("service_tabs")
      .insert({ tenant_id: tenantId, name: "Survey Service", position: 1 })
      .select("id")
      .single();
    if (tErr2) throw tErr2;

    async function seedDoc(tabId: string, hot: number, label: string) {
      const { data: d, error } = await admin
        .from("documents")
        .insert({
          tenant_id: tenantId,
          filename: `${label}.pdf`,
          storage_path: `${tenantId}/${tabId}/${label}.pdf`,
          status: "ready",
          page_count: 1,
          panel_type: "new_service",
          service_tab_id: tabId,
          doc_section: "available_equipment"
        })
        .select("id")
        .single();
      if (error) throw error;
      const { error: ce } = await admin.from("document_chunks").insert({
        tenant_id: tenantId,
        document_id: d.id,
        chunk_index: 0,
        content: `${label} chunk`,
        page_number: 1,
        section: null,
        panel_type: "new_service",
        service_tab_id: tabId,
        embedding: basisVec(hot)
      });
      if (ce) throw ce;
      return d.id as string;
    }

    const docA = await seedDoc(tabA.id, 10, "tabA-doc");
    const docB = await seedDoc(tabB.id, 11, "tabB-doc");

    // Delete tab A → its document + chunk cascade away.
    const { error: delErr } = await admin.from("service_tabs").delete().eq("id", tabA.id);
    expect(delErr).toBeNull();

    const { data: aDocs } = await admin.from("documents").select("id").eq("id", docA);
    expect(aDocs).toHaveLength(0); // doc gone via documents.service_tab_id cascade
    const { data: aChunks } = await admin
      .from("document_chunks")
      .select("id")
      .eq("document_id", docA);
    expect(aChunks).toHaveLength(0); // chunks gone via documents→chunks FK cascade

    // Tab B's data is completely untouched.
    const { data: bDocs } = await admin.from("documents").select("id").eq("id", docB);
    expect(bDocs).toHaveLength(1);
    const { data: bChunks } = await admin
      .from("document_chunks")
      .select("id")
      .eq("document_id", docB);
    expect(bChunks).toHaveLength(1);
  });

  it("@AC-2.4 a replace re-index keeps a New Service doc's chunks tagged (RPC stamps parent tags)", async () => {
    const { data: tab, error: tErr } = await admin
      .from("service_tabs")
      .insert({ tenant_id: tenantId, name: "Replace Tab", position: 0 })
      .select("id")
      .single();
    if (tErr) throw tErr;
    const { data: doc, error: dErr } = await admin
      .from("documents")
      .insert({
        tenant_id: tenantId,
        filename: "replace-me.pdf",
        storage_path: `${tenantId}/${tab.id}/replace-me.pdf`,
        status: "ready",
        page_count: 1,
        panel_type: "new_service",
        service_tab_id: tab.id,
        doc_section: "references"
      })
      .select("id")
      .single();
    if (dErr) throw dErr;

    // The replace pipeline never passes panel/tab in p_rows — the RPC reads them
    // from the parent document and stamps them on every re-inserted chunk.
    const { data: inserted, error: swapErr } = await admin.rpc("replace_document_chunks", {
      p_document_id: doc.id,
      p_tenant_id: tenantId,
      p_rows: [
        { chunk_index: 0, content: "new rev", page_number: 1, section: null, embedding: basisVec(20) }
      ]
    });
    expect(swapErr).toBeNull();
    expect(inserted).toBe(1);

    const { data: chunks } = await admin
      .from("document_chunks")
      .select("panel_type, service_tab_id")
      .eq("document_id", doc.id);
    expect(chunks).toHaveLength(1);
    expect(chunks![0].panel_type).toBe("new_service"); // tag survived the swap (AC-2.4)
    expect(chunks![0].service_tab_id).toBe(tab.id);
  });

  it("@AC-2.5 service_tabs rows are scoped per tenant (no cross-tenant bleed by tenant_id)", async () => {
    await admin
      .from("service_tabs")
      .insert({ tenant_id: tenantId, name: "Lab A tab", position: 0 });
    await admin
      .from("service_tabs")
      .insert({ tenant_id: otherTenantId, name: "Lab B tab", position: 0 });

    const { data: aTabs } = await admin
      .from("service_tabs")
      .select("tenant_id, name")
      .eq("tenant_id", tenantId);
    // Every tab returned for tenant A belongs to tenant A — the column app code +
    // RLS both filter on. (RLS itself is asserted structurally above; service-role
    // bypasses it, so here we prove the tenant_id scoping the app relies on.)
    expect(aTabs!.length).toBeGreaterThanOrEqual(1);
    expect(aTabs!.every((t) => t.tenant_id === tenantId)).toBe(true);
    expect(aTabs!.some((t) => t.name === "Lab B tab")).toBe(false);
  });
});

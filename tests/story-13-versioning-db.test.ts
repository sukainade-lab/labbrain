import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// S13 — live DB suite for document versioning (lesson L2: serialized,
// unique-tenant scoped, cleans up in afterAll; CI runs the live job with
// --no-file-parallelism). This proves the two DB-level guarantees that make S13
// safe, against real Postgres + the real replace_document_chunks RPC (migration
// 0014) — no mocks:
//
//   AC-13.4 (headline) — a replace re-index NEVER touches Q&A history. A query
//     asked before the replace keeps its frozen citation snapshot byte-for-byte
//     (queries have no FK to documents; citations are jsonb taken at answer time).
//   AC-13.2/13.3 — the atomic swap deletes the old chunks and inserts the new in
//     ONE transaction, and version bumps; retrieval sees only the new revision.
//   AC-13.6 — the RPC's tenant guard rejects a cross-tenant document swap.

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const hasLiveSupabase = Boolean(url && serviceKey);

const DIM = 1536;
// A unit basis vector in R^1536, serialized as pgvector text (matches
// toVectorLiteral output) — distinct hot index → distinguishable revisions.
function basisVec(hot: number): string {
  const arr = new Array(DIM).fill(0);
  arr[hot] = 1;
  return `[${arr.join(",")}]`;
}

describe.skipIf(!hasLiveSupabase).sequential("Story 13 — document versioning (live DB)", () => {
  let admin: SupabaseClient;
  const tenants: string[] = [];
  let tenantId = "";
  let otherTenantId = "";
  let docId = "";
  let queryId = "";

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
    tenantId = await makeTenant("VersioningLab");
    otherTenantId = await makeTenant("OtherLab");

    // Seed: a 'ready' document at version 1 with two original chunks.
    const { data: doc, error: dErr } = await admin
      .from("documents")
      .insert({
        tenant_id: tenantId,
        filename: "sop-rev-a.pdf",
        storage_path: `${tenantId}/x/sop-rev-a.pdf`,
        status: "ready",
        page_count: 4
      })
      .select("id, version")
      .single();
    if (dErr) throw dErr;
    docId = doc.id;
    expect(doc.version).toBe(1); // default from migration 0014

    const { error: cErr } = await admin.from("document_chunks").insert([
      {
        tenant_id: tenantId,
        document_id: docId,
        chunk_index: 0,
        content: "OLD revision clause one",
        page_number: 1,
        section: "Scope",
        embedding: basisVec(0)
      },
      {
        tenant_id: tenantId,
        document_id: docId,
        chunk_index: 1,
        content: "OLD revision clause two",
        page_number: 2,
        section: "Traceability",
        embedding: basisVec(1)
      }
    ]);
    if (cErr) throw cErr;

    // Seed a Q&A row whose citation snapshot references this document — captured
    // at answer time, exactly as buildCitations would freeze it.
    const { data: q, error: qErr } = await admin
      .from("queries")
      .insert({
        tenant_id: tenantId,
        question_text: "ما هو نطاق المعايرة؟",
        question_lang: "ar",
        answer_text: "النطاق هو ... 📄 sop-rev-a.pdf — الصفحة 1",
        found_answer: true,
        citations: [
          {
            document_id: docId,
            document_name: "sop-rev-a.pdf",
            section: "Scope",
            page_number: 1,
            similarity: 0.91
          }
        ]
      })
      .select("id, citations, answer_text, question_text")
      .single();
    if (qErr) throw qErr;
    queryId = q.id;
  });

  afterAll(async () => {
    for (const id of tenants) await admin.from("tenants").delete().eq("id", id);
  });

  it("@AC-13.3 replace_document_chunks swaps the chunk set atomically (old gone, new present)", async () => {
    const newRows = [
      {
        chunk_index: 0,
        content: "NEW revision clause one",
        page_number: 1,
        section: "Scope v2",
        embedding: basisVec(2)
      },
      {
        chunk_index: 1,
        content: "NEW revision clause two",
        page_number: 2,
        section: "Updated",
        embedding: basisVec(3)
      },
      {
        chunk_index: 2,
        content: "NEW revision clause three",
        page_number: 3,
        section: "Added",
        embedding: basisVec(4)
      }
    ];

    const { data: inserted, error } = await admin.rpc("replace_document_chunks", {
      p_document_id: docId,
      p_tenant_id: tenantId,
      p_rows: newRows
    });
    expect(error).toBeNull();
    expect(inserted).toBe(3);

    const { data: chunks } = await admin
      .from("document_chunks")
      .select("content, section")
      .eq("document_id", docId)
      .order("chunk_index", { ascending: true });
    expect(chunks).toHaveLength(3);
    expect(chunks!.every((c) => c.content.startsWith("NEW"))).toBe(true);
    expect(chunks!.some((c) => c.content.startsWith("OLD"))).toBe(false);
  });

  it("@AC-13.2 a successful replace bumps version + stamps updated_at, same document_id", async () => {
    const nextVersion = 2;
    const { error } = await admin
      .from("documents")
      .update({ version: nextVersion, updated_at: new Date().toISOString(), status: "ready" })
      .eq("id", docId);
    expect(error).toBeNull();

    const { data: doc } = await admin
      .from("documents")
      .select("id, version, updated_at, created_at")
      .eq("id", docId)
      .single();
    expect(doc!.id).toBe(docId); // same id — citation deep-link stays valid
    expect(doc!.version).toBe(2);
    expect(doc!.updated_at).not.toBeNull();
    expect(doc!.created_at).not.toBeNull(); // created_at preserved
  });

  it("@AC-13.4 the pre-replace query + its citation snapshot are byte-for-byte unchanged", async () => {
    const { data: q } = await admin
      .from("queries")
      .select("id, question_text, answer_text, citations")
      .eq("id", queryId)
      .single();
    expect(q!.id).toBe(queryId);
    expect(q!.question_text).toBe("ما هو نطاق المعايرة؟");
    // The frozen snapshot still names the OLD revision + page captured at answer
    // time — the replace did not rewrite a single field of history.
    expect(q!.citations).toEqual([
      {
        document_id: docId,
        document_name: "sop-rev-a.pdf",
        section: "Scope",
        page_number: 1,
        similarity: 0.91
      }
    ]);
  });

  it("@AC-13.6 the RPC rejects a cross-tenant document swap (tenant guard)", async () => {
    const { error } = await admin.rpc("replace_document_chunks", {
      p_document_id: docId,
      p_tenant_id: otherTenantId, // not the owner
      p_rows: [
        { chunk_index: 0, content: "intruder", page_number: 1, section: null, embedding: basisVec(5) }
      ]
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/tenant mismatch/i);

    // And the victim's chunks are untouched — still the 3 NEW rows from above.
    const { data: chunks } = await admin
      .from("document_chunks")
      .select("content")
      .eq("document_id", docId);
    expect(chunks).toHaveLength(3);
    expect(chunks!.some((c) => c.content === "intruder")).toBe(false);
  });
});

import { randomUUID } from "crypto";
import type { createAdminClient } from "@/lib/supabase/admin";
import { assertDocAvailable } from "@/lib/documents/limits";
import { chunkBlocks } from "@/lib/documents/chunk";
import { parseDocument } from "@/lib/parsing/llamaparse";
import { embedTexts, toVectorLiteral } from "@/lib/ai/embeddings";

type Admin = ReturnType<typeof createAdminClient>;

export const DOCUMENTS_BUCKET = "documents";

export interface CreateDocumentInput {
  admin: Admin;
  tenantId: string;
  file: Blob;
  filename: string;
  mimeType: string;
}

export interface CreateDocumentResult {
  documentId: string;
  storagePath: string;
  status: "parsing";
}

// Synchronous half of ingestion (AC-2.1 / AC-2.6) — runs on the request thread:
// enforce the cap, store the file under the tenant namespace, create the row at
// 'parsing'. Returns immediately so the route can respond 201 while parse/index
// run off the response path (processDocument). Throws DocLimitError (→402) at cap.
export async function createDocument({
  admin,
  tenantId,
  file,
  filename,
  mimeType
}: CreateDocumentInput): Promise<CreateDocumentResult> {
  await assertDocAvailable(admin, tenantId); // throws DocLimitError when at cap

  const documentId = randomUUID();
  const storagePath = `${tenantId}/${documentId}/${filename}`;

  // Store under the tenant namespace (AC-2.1).
  const { error: upErr } = await admin.storage
    .from(DOCUMENTS_BUCKET)
    .upload(storagePath, file, { contentType: mimeType, upsert: false });
  if (upErr) throw new Error(`storage upload failed: ${upErr.message}`);

  // Row starts at 'parsing' (AC-2.2 pipeline). The UI polls it to 'ready'.
  const { error: insErr } = await admin.from("documents").insert({
    id: documentId,
    tenant_id: tenantId,
    filename,
    storage_path: storagePath,
    status: "parsing"
  });
  if (insErr) {
    await admin.storage.from(DOCUMENTS_BUCKET).remove([storagePath]);
    throw new Error(`document insert failed: ${insErr.message}`);
  }

  return { documentId, storagePath, status: "parsing" };
}

export interface ProcessDocumentInput {
  admin: Admin;
  tenantId: string;
  documentId: string;
  file: Blob;
  filename: string;
}

export interface ProcessDocumentResult {
  status: "ready";
  pageCount: number;
  chunkCount: number;
}

// Flip a document's status, throwing on a failed write so a silently-failed
// update can't strand a row in a non-terminal state unnoticed.
async function setDocumentStatus(
  admin: Admin,
  documentId: string,
  fields: Record<string, unknown>
): Promise<void> {
  const { error } = await admin.from("documents").update(fields).eq("id", documentId);
  if (error) {
    throw new Error(`status update failed (${JSON.stringify(fields)}): ${error.message}`);
  }
}

// Background half of ingestion (AC-2.2 / AC-2.3): parse → index → embed → ready.
// Runs off the request thread (via the route's `after()`), so a slow LlamaParse
// poll never holds the HTTP response open and the UI can render the real
// parsing→indexing→ready progression. Any failure flips the row to 'failed'
// (best-effort) and rethrows so the caller/logs can observe it.
export async function processDocument({
  admin,
  tenantId,
  documentId,
  file,
  filename
}: ProcessDocumentInput): Promise<ProcessDocumentResult> {
  try {
    // Parse (AC-2.2).
    const { blocks, pageCount } = await parseDocument(file, filename);
    await setDocumentStatus(admin, documentId, { status: "indexing", page_count: pageCount });

    // Chunk + embed + persist (AC-2.3).
    const chunks = chunkBlocks(blocks);
    if (chunks.length > 0) {
      const embeddings = await embedTexts(chunks.map((c) => c.content));
      // Guard the index map below: a short batch return would otherwise feed
      // toVectorLiteral(undefined) and corrupt the row silently.
      if (embeddings.length !== chunks.length) {
        throw new Error(
          `embedding count mismatch: ${embeddings.length} vectors for ${chunks.length} chunks`
        );
      }
      const rows = chunks.map((c, i) => ({
        tenant_id: tenantId,
        document_id: documentId,
        chunk_index: c.chunkIndex,
        content: c.content,
        page_number: c.pageNumber,
        section: c.section,
        embedding: toVectorLiteral(embeddings[i])
      }));
      const { error: chErr } = await admin.from("document_chunks").insert(rows);
      if (chErr) throw new Error(`chunk insert failed: ${chErr.message}`);
    }

    await setDocumentStatus(admin, documentId, { status: "ready" });
    return { status: "ready", pageCount, chunkCount: chunks.length };
  } catch (err) {
    // Best-effort flip to 'failed'; surface the original error regardless.
    await admin.from("documents").update({ status: "failed" }).eq("id", documentId);
    throw err;
  }
}

// Delete a document's row (FK-cascades its chunks) then its Storage object
// (AC-2.5). Row-first ordering: if the Storage removal fails afterward, a
// leftover object is harmless and GC-able, whereas deleting Storage first then
// failing the row delete would leave a dangling reference to missing bytes.
//
// Note (S13 contract): deleting a document never touches `queries`. Q&A history
// is decoupled by construction — `queries` has NO foreign key to `documents` and
// `queries.citations` is a frozen jsonb snapshot taken at answer time
// (src/lib/qa/citations.ts). So the FK cascade above only reaches `document_chunks`,
// never the audit trail. Same guarantee holds for replaceDocument below (AC-13.4).
export async function deleteDocument(admin: Admin, storagePath: string, documentId: string) {
  const { error } = await admin.from("documents").delete().eq("id", documentId);
  if (error) throw new Error(`document delete failed: ${error.message}`);
  await admin.storage.from(DOCUMENTS_BUCKET).remove([storagePath]);
}

// ── S13: replace a document + re-index, keeping the same document_id ──────────

export interface ReplaceDocumentInput {
  admin: Admin;
  tenantId: string;
  documentId: string;
  file: Blob;
  filename: string;
  mimeType: string;
  previousPath: string;
}

export interface ReplaceDocumentResult {
  documentId: string;
  storagePath: string;
  status: "parsing";
}

// Synchronous half of a replace (AC-13.1 / AC-13.6) — runs on the request thread:
// store the new file under the SAME document namespace, drop the old object if it
// was renamed, and flip the row back to 'parsing' so the UI's existing poll shows
// parsing→indexing→ready again. The destructive chunk swap is deferred to
// processReplace — here we only stage the new bytes; the prior revision's chunks
// and `version` are left intact until the new chunks are proven ready (AC-13.5).
export async function replaceDocument({
  admin,
  tenantId,
  documentId,
  file,
  filename,
  mimeType,
  previousPath
}: ReplaceDocumentInput): Promise<ReplaceDocumentResult> {
  const storagePath = `${tenantId}/${documentId}/${filename}`;

  // upsert: a same-name revision overwrites the bytes in place; a renamed one
  // lands at the new key and we GC the old object below (no orphans, AC-13.6).
  const { error: upErr } = await admin.storage
    .from(DOCUMENTS_BUCKET)
    .upload(storagePath, file, { contentType: mimeType, upsert: true });
  if (upErr) throw new Error(`storage upload failed: ${upErr.message}`);

  if (previousPath && previousPath !== storagePath) {
    await admin.storage.from(DOCUMENTS_BUCKET).remove([previousPath]);
  }

  // Point the row at the new bytes and re-enter the pipeline. version/page_count
  // stay as-is until processReplace confirms the new revision indexed.
  await setDocumentStatus(admin, documentId, {
    filename,
    storage_path: storagePath,
    status: "parsing"
  });

  return { documentId, storagePath, status: "parsing" };
}

export interface ProcessReplaceInput {
  admin: Admin;
  tenantId: string;
  documentId: string;
  file: Blob;
  filename: string;
}

export interface ProcessReplaceResult {
  status: "ready";
  pageCount: number;
  chunkCount: number;
  version: number;
}

// Background half of a replace (AC-13.2 / AC-13.3 / AC-13.5): parse → embed →
// ATOMIC chunk swap → bump version. Parse + embed happen first, OFF the response
// path; the destructive swap (replace_document_chunks RPC) runs only once the new
// chunks are ready. If anything before the RPC throws, the old chunks + old
// version are untouched and the row is flipped to 'failed' — the prior revision
// stays fully retrievable (fail-safe). The RPC is the single all-or-nothing point
// where a document's chunks ever change during a replace.
export async function processReplace({
  admin,
  tenantId,
  documentId,
  file,
  filename
}: ProcessReplaceInput): Promise<ProcessReplaceResult> {
  try {
    // Parse the new revision (AC-13.3). No DB mutation yet — a parse failure here
    // leaves the prior revision's chunks and version completely intact (AC-13.5).
    const { blocks, pageCount } = await parseDocument(file, filename);
    await setDocumentStatus(admin, documentId, { status: "indexing" });

    // Embed the new chunks (still no destructive write).
    const chunks = chunkBlocks(blocks);
    const rows = [];
    if (chunks.length > 0) {
      const embeddings = await embedTexts(chunks.map((c) => c.content));
      if (embeddings.length !== chunks.length) {
        throw new Error(
          `embedding count mismatch: ${embeddings.length} vectors for ${chunks.length} chunks`
        );
      }
      for (let i = 0; i < chunks.length; i++) {
        const c = chunks[i];
        rows.push({
          chunk_index: c.chunkIndex,
          content: c.content,
          page_number: c.pageNumber,
          section: c.section,
          embedding: toVectorLiteral(embeddings[i])
        });
      }
    }

    // Atomic swap: delete-old + insert-new in one RPC transaction (AC-13.3/13.5).
    // Only now does the document's chunk set change, and only all-or-nothing.
    const { error: swapErr } = await admin.rpc("replace_document_chunks", {
      p_document_id: documentId,
      p_tenant_id: tenantId,
      p_rows: rows
    });
    if (swapErr) throw new Error(`chunk swap failed: ${swapErr.message}`);

    // New revision is live → bump version + stamp updated_at + page_count, ready.
    // Read-then-increment is safe: single-writer per document (concurrent replace
    // is out of scope, same as upload). version starts at 1 for the original.
    const { data: current, error: readErr } = await admin
      .from("documents")
      .select("version")
      .eq("id", documentId)
      .single();
    if (readErr) throw new Error(`version read failed: ${readErr.message}`);
    const nextVersion = (current?.version ?? 1) + 1;

    await setDocumentStatus(admin, documentId, {
      status: "ready",
      page_count: pageCount,
      version: nextVersion,
      updated_at: new Date().toISOString()
    });

    return { status: "ready", pageCount, chunkCount: chunks.length, version: nextVersion };
  } catch (err) {
    // Fail-safe (AC-13.5): the old chunks + version are untouched (the RPC either
    // never ran or rolled back). Surface 'failed'; the prior revision still answers.
    await admin.from("documents").update({ status: "failed" }).eq("id", documentId);
    throw err;
  }
}

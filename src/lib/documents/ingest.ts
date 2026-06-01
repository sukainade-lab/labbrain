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
export async function deleteDocument(admin: Admin, storagePath: string, documentId: string) {
  const { error } = await admin.from("documents").delete().eq("id", documentId);
  if (error) throw new Error(`document delete failed: ${error.message}`);
  await admin.storage.from(DOCUMENTS_BUCKET).remove([storagePath]);
}

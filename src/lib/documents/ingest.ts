import { randomUUID } from "crypto";
import type { createAdminClient } from "@/lib/supabase/admin";
import { assertDocAvailable } from "@/lib/documents/limits";
import { chunkBlocks } from "@/lib/documents/chunk";
import { parseDocument } from "@/lib/parsing/llamaparse";
import { embedTexts, toVectorLiteral } from "@/lib/ai/embeddings";

type Admin = ReturnType<typeof createAdminClient>;

export const DOCUMENTS_BUCKET = "documents";

export interface IngestInput {
  admin: Admin;
  tenantId: string;
  file: Blob;
  filename: string;
  mimeType: string;
}

export interface IngestResult {
  documentId: string;
  status: "ready";
  pageCount: number;
  chunkCount: number;
}

// Full inline pipeline with DB status checkpoints (AC-2.1…2.3). Cap is checked
// first (AC-2.6 → DocLimitError → 402 at the route). After the row exists, any
// failure flips status to 'failed' so the UI can surface it (AC-2.2).
export async function ingestDocument({
  admin,
  tenantId,
  file,
  filename,
  mimeType
}: IngestInput): Promise<IngestResult> {
  await assertDocAvailable(admin, tenantId); // throws DocLimitError when at cap

  const documentId = randomUUID();
  const storagePath = `${tenantId}/${documentId}/${filename}`;

  // Store under the tenant namespace (AC-2.1).
  const { error: upErr } = await admin.storage
    .from(DOCUMENTS_BUCKET)
    .upload(storagePath, file, { contentType: mimeType, upsert: false });
  if (upErr) throw new Error(`storage upload failed: ${upErr.message}`);

  // Row starts at 'parsing' (AC-2.2 pipeline).
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

  try {
    // Parse (AC-2.2).
    const { blocks, pageCount } = await parseDocument(file, filename);
    await admin
      .from("documents")
      .update({ status: "indexing", page_count: pageCount })
      .eq("id", documentId);

    // Chunk + embed + persist (AC-2.3).
    const chunks = chunkBlocks(blocks);
    if (chunks.length > 0) {
      const embeddings = await embedTexts(chunks.map((c) => c.content));
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

    await admin.from("documents").update({ status: "ready" }).eq("id", documentId);

    return { documentId, status: "ready", pageCount, chunkCount: chunks.length };
  } catch (err) {
    await admin.from("documents").update({ status: "failed" }).eq("id", documentId);
    throw err;
  }
}

// Delete a document's Storage object + cascade its chunks (AC-2.5). The FK on
// document_chunks cascades on row delete; Storage needs an explicit removal.
export async function deleteDocument(admin: Admin, storagePath: string, documentId: string) {
  await admin.storage.from(DOCUMENTS_BUCKET).remove([storagePath]);
  const { error } = await admin.from("documents").delete().eq("id", documentId);
  if (error) throw new Error(`document delete failed: ${error.message}`);
}

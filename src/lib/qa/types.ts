// A row returned by the match_document_chunks RPC (migration 0004). The RPC has
// already filtered to the caller's tenant and to chunks scoring ≥ threshold.
export interface RetrievedChunk {
  id: string;
  document_id: string;
  document_filename: string;
  content: string;
  page_number: number | null;
  section: string | null;
  similarity: number;
}

// Single source of truth for inference model identity + the pgvector contract.
// Kept dependency-free (no SDK import) so the pure inference-mode resolver can read
// EMBEDDING_DIM without pulling the OpenAI client into its import graph.

// AC-3.2 — cloud answer model. temperature 0 keeps answers tightly bound to excerpts.
export const ANSWER_MODEL = "gpt-4o-mini";

// AC-2.3 — cloud embedding model + its vector dimension. EMBEDDING_DIM is the
// pgvector column width (`document_chunks.embedding vector(1536)`); any air-gap
// embedding model MUST match it (AC-11.6) or vectors corrupt silently.
export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIM = 1536;

// Cloud LlamaParse base (processing-only / transient — see CLAUDE.md residency).
export const LLAMAPARSE_CLOUD_BASE = "https://api.cloud.llamaindex.ai/api/v1";

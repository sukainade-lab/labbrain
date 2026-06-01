import { getEncoding, type Tiktoken } from "js-tiktoken";

// text-embedding-3-small tokenizes with cl100k_base. Using the exact encoder (not
// a word/char heuristic) keeps every chunk truthfully ≤500 tokens (AC-2.3).
let _enc: Tiktoken | null = null;
function enc(): Tiktoken {
  if (!_enc) _enc = getEncoding("cl100k_base");
  return _enc;
}

export const MAX_CHUNK_TOKENS = 500;
export const CHUNK_OVERLAP_TOKENS = 50;

// A unit of parsed source text scoped to one page + heading. The parser emits
// these; we never blend two pages into one chunk so a citation always points to
// exactly one page (the product's citation contract — see CLAUDE.md).
export interface SourceBlock {
  text: string;
  pageNumber: number;
  section?: string | null;
}

export interface Chunk {
  content: string;
  pageNumber: number;
  section: string | null;
  chunkIndex: number;
}

export interface ChunkOptions {
  maxTokens?: number;
  overlap?: number;
}

// Token-windowed splitter. Within each block, slide a `maxTokens` window with
// `overlap` tokens of carry-over so context isn't severed at boundaries. Page
// number + section ride along on every emitted chunk; chunkIndex is global and
// monotonic across the whole document.
export function chunkBlocks(blocks: SourceBlock[], opts: ChunkOptions = {}): Chunk[] {
  const maxTokens = opts.maxTokens ?? MAX_CHUNK_TOKENS;
  const overlap = opts.overlap ?? CHUNK_OVERLAP_TOKENS;
  if (maxTokens <= 0) throw new Error("maxTokens must be positive");
  if (overlap < 0 || overlap >= maxTokens) {
    throw new Error("overlap must be in [0, maxTokens)");
  }

  const encoder = enc();
  const stride = maxTokens - overlap;
  const out: Chunk[] = [];
  let chunkIndex = 0;

  for (const block of blocks) {
    const text = block.text?.trim();
    if (!text) continue;

    const tokens = encoder.encode(text);
    if (tokens.length === 0) continue;

    for (let start = 0; start < tokens.length; start += stride) {
      const window = tokens.slice(start, start + maxTokens);
      const content = encoder.decode(window).trim();
      if (content) {
        out.push({
          content,
          pageNumber: block.pageNumber,
          section: block.section ?? null,
          chunkIndex: chunkIndex++
        });
      }
      if (start + maxTokens >= tokens.length) break;
    }
  }

  return out;
}

// Exact token count for a string (used by tests + embedding batch sizing).
export function countTokens(text: string): number {
  return enc().encode(text).length;
}

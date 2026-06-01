import type { SourceBlock } from "@/lib/documents/chunk";

// LlamaParse cloud API. Processing-only (transient) — no persistent data leaves
// Frankfurt (see CLAUDE.md data residency). Mocked at this module boundary in
// tests; real HTTP in production.

const DEFAULT_BASE = "https://api.cloud.llamaindex.ai/api/v1";
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 120_000;

export interface ParseResult {
  blocks: SourceBlock[];
  pageCount: number;
}

interface ParsedPage {
  page?: number;
  text?: string;
  md?: string;
  items?: { type?: string; value?: string }[];
}

function requireKey(): string {
  const key = process.env.LLAMAPARSE_API_KEY;
  if (!key) throw new Error("LLAMAPARSE_API_KEY is not set — cannot parse documents");
  return key;
}

function baseUrl(): string {
  return process.env.LLAMAPARSE_BASE_URL ?? DEFAULT_BASE;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// One source block per page: page text carrying the page's first heading as its
// section. One-block-per-page keeps every citation pinned to exactly one page
// (the product's citation contract); the chunker windows within the block.
function pagesToBlocks(pages: ParsedPage[]): SourceBlock[] {
  const blocks: SourceBlock[] = [];
  pages.forEach((p, idx) => {
    const text = (p.md ?? p.text ?? "").trim();
    if (!text) return;
    const heading = p.items?.find((it) => it.type === "heading" && it.value)?.value ?? null;
    blocks.push({ text, pageNumber: p.page ?? idx + 1, section: heading });
  });
  return blocks;
}

// Upload a file → poll the job → return page-scoped blocks + page count (AC-2.2).
export async function parseDocument(
  file: Blob,
  filename: string,
  opts: { fetchImpl?: typeof fetch; pollIntervalMs?: number; pollTimeoutMs?: number } = {}
): Promise<ParseResult> {
  const key = requireKey();
  const base = baseUrl();
  const doFetch = opts.fetchImpl ?? fetch;
  const interval = opts.pollIntervalMs ?? POLL_INTERVAL_MS;
  const timeout = opts.pollTimeoutMs ?? POLL_TIMEOUT_MS;
  const auth = { Authorization: `Bearer ${key}` };

  // 1. Upload.
  const form = new FormData();
  form.append("file", file, filename);
  const upRes = await doFetch(`${base}/parsing/upload`, { method: "POST", headers: auth, body: form });
  if (!upRes.ok) throw new Error(`LlamaParse upload failed: ${upRes.status}`);
  const { id } = (await upRes.json()) as { id: string };
  if (!id) throw new Error("LlamaParse upload returned no job id");

  // 2. Poll until SUCCESS / ERROR / timeout.
  const deadline = Date.now() + timeout;
  for (;;) {
    const jobRes = await doFetch(`${base}/parsing/job/${id}`, { headers: auth });
    if (!jobRes.ok) throw new Error(`LlamaParse job poll failed: ${jobRes.status}`);
    const { status } = (await jobRes.json()) as { status: string };
    if (status === "SUCCESS") break;
    if (status === "ERROR" || status === "FAILED") throw new Error("LlamaParse job failed");
    if (Date.now() > deadline) throw new Error("LlamaParse job timed out");
    await sleep(interval);
  }

  // 3. Fetch the structured result.
  const resultRes = await doFetch(`${base}/parsing/job/${id}/result/json`, { headers: auth });
  if (!resultRes.ok) throw new Error(`LlamaParse result fetch failed: ${resultRes.status}`);
  const result = (await resultRes.json()) as { pages?: ParsedPage[] };
  const pages = result.pages ?? [];

  return { blocks: pagesToBlocks(pages), pageCount: pages.length };
}

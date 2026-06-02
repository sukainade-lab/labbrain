import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { OpenAiBackend } from "@/lib/ai/inference-mode";

// Story 11 — seam behaviour under air-gap mode (AC-11.2/11.3/11.4/11.5). These prove
// the *observable* guarantee: with INFERENCE_MODE=airgap, the embed/answer/parse
// seams talk to the configured LOCAL host and never a cloud host — and a
// misconfigured air-gap deployment throws before any request is issued (fail-closed).

// Capture the backend each seam resolves, and hand back a fake OpenAI client so no
// real network call is attempted.
const created: OpenAiBackend[] = [];
const embeddingsCreate = vi.fn();
const chatCreate = vi.fn();

vi.mock("@/lib/ai/openai-client", () => ({
  getOpenAiClient: (backend: OpenAiBackend) => {
    created.push(backend);
    return {
      embeddings: { create: embeddingsCreate },
      chat: { completions: { create: chatCreate } }
    };
  }
}));

import { embedTexts } from "@/lib/ai/embeddings";
import { generateAnswer } from "@/lib/ai/answer";
import { parseDocument } from "@/lib/parsing/llamaparse";

const AIRGAP_KEYS = [
  "INFERENCE_MODE",
  "OLLAMA_BASE_URL",
  "AIRGAP_EMBEDDING_MODEL",
  "AIRGAP_EMBEDDING_DIM",
  "AIRGAP_ANSWER_MODEL",
  "LLAMAPARSE_BASE_URL",
  "OPENAI_API_KEY",
  "LLAMAPARSE_API_KEY"
];

function setAirgap(over: Record<string, string | undefined> = {}) {
  const env: Record<string, string | undefined> = {
    INFERENCE_MODE: "airgap",
    OLLAMA_BASE_URL: "http://localhost:11434/v1",
    AIRGAP_EMBEDDING_MODEL: "local-embed-1536",
    AIRGAP_EMBEDDING_DIM: "1536",
    AIRGAP_ANSWER_MODEL: "local-llama",
    LLAMAPARSE_BASE_URL: "http://localhost:8080/api/v1",
    LLAMAPARSE_API_KEY: "local-key",
    ...over
  };
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

beforeEach(() => {
  created.length = 0;
  embeddingsCreate.mockReset();
  chatCreate.mockReset();
  for (const k of AIRGAP_KEYS) delete process.env[k];
});

afterEach(() => {
  for (const k of AIRGAP_KEYS) delete process.env[k];
});

describe("embedTexts under air-gap (AC-11.2)", () => {
  it("@AC-11.2 targets the local Ollama base + local model, never api.openai.com", async () => {
    setAirgap();
    embeddingsCreate.mockResolvedValue({
      data: [
        { index: 1, embedding: [0.2] },
        { index: 0, embedding: [0.1] }
      ]
    });

    const out = await embedTexts(["a", "b"]);

    expect(created).toHaveLength(1);
    expect(created[0].baseURL).toBe("http://localhost:11434/v1");
    expect(created[0].baseURL).not.toContain("openai.com");
    expect(embeddingsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: "local-embed-1536" })
    );
    // order preserved across the API's out-of-order `index` (contract unchanged)
    expect(out).toEqual([[0.1], [0.2]]);
  });

  it("@AC-11.2 @AC-11.5 FAIL-CLOSED: missing OLLAMA_BASE_URL throws before any client is built", async () => {
    setAirgap({ OLLAMA_BASE_URL: undefined });
    await expect(embedTexts(["a"])).rejects.toThrow(/OLLAMA_BASE_URL/);
    expect(created).toHaveLength(0);
    expect(embeddingsCreate).not.toHaveBeenCalled();
  });
});

describe("generateAnswer under air-gap (AC-11.3)", () => {
  it("@AC-11.3 targets the local base + model, with the grounding contract unchanged", async () => {
    setAirgap();
    chatCreate.mockResolvedValue({ choices: [{ message: { content: " الجواب " } }] });

    const answer = await generateAnswer({
      question: "ما هي السياسة؟",
      chunks: [
        {
          documentName: "SOP-12",
          pageNumber: 3,
          content: "النص",
          similarity: 0.9
        } as never
      ],
      lang: "ar"
    });

    expect(answer).toBe("الجواب"); // trimmed
    expect(created[0].baseURL).toBe("http://localhost:11434/v1");
    const call = chatCreate.mock.calls[0][0];
    expect(call.model).toBe("local-llama");
    expect(call.temperature).toBe(0); // deterministic grounding, unchanged
    expect(call.messages[0].role).toBe("system"); // system prompt still present
  });

  it("@AC-11.3 @AC-11.5 FAIL-CLOSED: missing AIRGAP_ANSWER_MODEL throws, no cloud call", async () => {
    setAirgap({ AIRGAP_ANSWER_MODEL: undefined });
    await expect(
      generateAnswer({ question: "q", chunks: [{} as never], lang: "en" })
    ).rejects.toThrow(/AIRGAP_ANSWER_MODEL/);
    expect(chatCreate).not.toHaveBeenCalled();
  });
});

describe("parseDocument under air-gap (AC-11.4)", () => {
  it("@AC-11.4 uploads + polls the self-hosted base, never the cloud LlamaParse host", async () => {
    setAirgap();
    const urls: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      urls.push(url);
      if (url.endsWith("/parsing/upload")) {
        return { ok: true, json: async () => ({ id: "job-1" }) } as Response;
      }
      if (url.endsWith("/result/json")) {
        return {
          ok: true,
          json: async () => ({ pages: [{ page: 1, md: "hello" }] })
        } as Response;
      }
      // job status poll
      return { ok: true, json: async () => ({ status: "SUCCESS" }) } as Response;
    });

    const res = await parseDocument(new Blob(["x"]), "f.pdf", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      pollIntervalMs: 0
    });

    expect(res.pageCount).toBe(1);
    expect(urls.length).toBeGreaterThan(0);
    for (const u of urls) {
      expect(u.startsWith("http://localhost:8080/api/v1")).toBe(true);
      expect(u).not.toContain("api.cloud.llamaindex.ai");
    }
  });

  it("@AC-11.4 @AC-11.5 FAIL-CLOSED: airgap missing LLAMAPARSE_BASE_URL throws before any fetch", async () => {
    setAirgap({ LLAMAPARSE_BASE_URL: undefined });
    const fetchImpl = vi.fn();
    await expect(
      parseDocument(new Blob(["x"]), "f.pdf", {
        fetchImpl: fetchImpl as unknown as typeof fetch
      })
    ).rejects.toThrow(/LLAMAPARSE_BASE_URL/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("cloud mode is unchanged (AC-11.1)", () => {
  it("@AC-11.1 embed resolves the OpenAI default base (undefined) with the cloud key", async () => {
    process.env.OPENAI_API_KEY = "sk-cloud";
    embeddingsCreate.mockResolvedValue({ data: [{ index: 0, embedding: [0.5] }] });
    await embedTexts(["a"]);
    expect(created[0].baseURL).toBeUndefined();
    delete process.env.OPENAI_API_KEY;
  });
});

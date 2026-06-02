import { describe, it, expect, afterEach } from "vitest";
import {
  getInferenceMode,
  isAirgap,
  assertAirgapConfig,
  resolveOpenAiBackend,
  resolveParseBackend,
  describeInferenceMode,
  InferenceConfigError,
  LLAMAPARSE_CLOUD_BASE
} from "@/lib/ai/inference-mode";
import { EMBEDDING_DIM, EMBEDDING_MODEL, ANSWER_MODEL } from "@/lib/ai/constants";

// Story 11 — Air-gap mode (AC-11.1/11.5/11.6). The resolver is the SINGLE source of
// truth for which inference backend each seam (parse / embed / answer) uses. The
// compliance guarantee is that an `airgap` deployment can NEVER silently route a
// classified document to a cloud endpoint — a misconfiguration must throw, never
// fall back. These are pure tests over an injected env; no network, no SDK.

const AIRGAP_KEYS = [
  "INFERENCE_MODE",
  "OLLAMA_BASE_URL",
  "AIRGAP_EMBEDDING_MODEL",
  "AIRGAP_EMBEDDING_DIM",
  "AIRGAP_ANSWER_MODEL",
  "LLAMAPARSE_BASE_URL"
];

// A complete, valid air-gap env (1536-dim local embedding model).
function airgapEnv(over: Record<string, string | undefined> = {}){
  return {
    INFERENCE_MODE: "airgap",
    OLLAMA_BASE_URL: "http://localhost:11434/v1",
    AIRGAP_EMBEDDING_MODEL: "local-embed-1536",
    AIRGAP_EMBEDDING_DIM: String(EMBEDDING_DIM),
    AIRGAP_ANSWER_MODEL: "local-llama",
    LLAMAPARSE_BASE_URL: "http://localhost:8080/api/v1",
    ...over
  };
}

afterEach(() => {
  for (const k of AIRGAP_KEYS) delete process.env[k];
});

describe("getInferenceMode @AC-11.1", () => {
  it("defaults to cloud when unset or empty", () => {
    expect(getInferenceMode({})).toBe("cloud");
    expect(getInferenceMode({ INFERENCE_MODE: "" })).toBe("cloud");
    expect(getInferenceMode({ INFERENCE_MODE: "  " })).toBe("cloud");
  });

  it("recognizes cloud and airgap case-insensitively", () => {
    expect(getInferenceMode({ INFERENCE_MODE: "cloud" })).toBe("cloud");
    expect(getInferenceMode({ INFERENCE_MODE: "airgap" })).toBe("airgap");
    expect(getInferenceMode({ INFERENCE_MODE: "AIRGAP" })).toBe("airgap");
  });

  it("throws on an unknown mode — never silently defaults a typo to cloud", () => {
    expect(() => getInferenceMode({ INFERENCE_MODE: "air-gap" })).toThrow(
      InferenceConfigError
    );
    expect(() => getInferenceMode({ INFERENCE_MODE: "local" })).toThrow();
  });

  it("isAirgap mirrors the mode", () => {
    expect(isAirgap({})).toBe(false);
    expect(isAirgap(airgapEnv())).toBe(true);
  });
});

describe("resolveOpenAiBackend — cloud @AC-11.1", () => {
  it("embed → OpenAI default base + cloud model + OPENAI_API_KEY", () => {
    const b = resolveOpenAiBackend("embed", { OPENAI_API_KEY: "sk-test" });
    expect(b.baseURL).toBeUndefined(); // SDK default = api.openai.com
    expect(b.model).toBe(EMBEDDING_MODEL);
    expect(b.apiKey).toBe("sk-test");
  });

  it("answer → OpenAI default base + cloud answer model", () => {
    const b = resolveOpenAiBackend("answer", { OPENAI_API_KEY: "sk-test" });
    expect(b.baseURL).toBeUndefined();
    expect(b.model).toBe(ANSWER_MODEL);
  });

  it("throws if OPENAI_API_KEY is missing in cloud mode", () => {
    expect(() => resolveOpenAiBackend("embed", {})).toThrow(InferenceConfigError);
  });
});

describe("resolveOpenAiBackend — airgap @AC-11.2 @AC-11.3 @AC-11.5", () => {
  it("embed → Ollama local base + local embed model, never api.openai.com", () => {
    const b = resolveOpenAiBackend("embed", airgapEnv());
    expect(b.baseURL).toBe("http://localhost:11434/v1");
    expect(b.baseURL).not.toContain("openai.com");
    expect(b.model).toBe("local-embed-1536");
    expect(b.apiKey).toBeTruthy(); // SDK requires a non-empty key; Ollama ignores it
  });

  it("answer → Ollama local base + local answer model", () => {
    const b = resolveOpenAiBackend("answer", airgapEnv());
    expect(b.baseURL).toBe("http://localhost:11434/v1");
    expect(b.model).toBe("local-llama");
  });

  it("FAIL-CLOSED: missing OLLAMA_BASE_URL throws, never falls back to cloud", () => {
    expect(() => resolveOpenAiBackend("embed", airgapEnv({ OLLAMA_BASE_URL: undefined }))).toThrow(
      /OLLAMA_BASE_URL/
    );
  });

  it("FAIL-CLOSED: missing AIRGAP_ANSWER_MODEL throws", () => {
    expect(() =>
      resolveOpenAiBackend("answer", airgapEnv({ AIRGAP_ANSWER_MODEL: undefined }))
    ).toThrow(/AIRGAP_ANSWER_MODEL/);
  });
});

describe("resolveParseBackend @AC-11.4", () => {
  it("cloud → LlamaParse cloud base by default", () => {
    expect(resolveParseBackend({}).baseURL).toBe(LLAMAPARSE_CLOUD_BASE);
  });

  it("cloud → honors an explicit LLAMAPARSE_BASE_URL override", () => {
    const b = resolveParseBackend({ LLAMAPARSE_BASE_URL: "https://eu.example/api/v1" });
    expect(b.baseURL).toBe("https://eu.example/api/v1");
  });

  it("airgap → self-hosted base, never the cloud default", () => {
    const b = resolveParseBackend(airgapEnv());
    expect(b.baseURL).toBe("http://localhost:8080/api/v1");
    expect(b.baseURL).not.toBe(LLAMAPARSE_CLOUD_BASE);
  });

  it("FAIL-CLOSED: airgap missing LLAMAPARSE_BASE_URL throws", () => {
    expect(() => resolveParseBackend(airgapEnv({ LLAMAPARSE_BASE_URL: undefined }))).toThrow(
      /LLAMAPARSE_BASE_URL/
    );
  });
});

describe("assertAirgapConfig — embedding-dimension safety @AC-11.5 @AC-11.6", () => {
  it("passes a complete, dimension-matched air-gap config", () => {
    expect(() => assertAirgapConfig(airgapEnv())).not.toThrow();
  });

  it("rejects a dimension that mismatches the pgvector column", () => {
    expect(() => assertAirgapConfig(airgapEnv({ AIRGAP_EMBEDDING_DIM: "768" }))).toThrow(
      new RegExp(String(EMBEDDING_DIM))
    );
  });

  it("rejects a non-numeric dimension", () => {
    expect(() => assertAirgapConfig(airgapEnv({ AIRGAP_EMBEDDING_DIM: "large" }))).toThrow(
      InferenceConfigError
    );
  });

  it("names every missing required var", () => {
    for (const key of [
      "OLLAMA_BASE_URL",
      "AIRGAP_EMBEDDING_MODEL",
      "AIRGAP_EMBEDDING_DIM",
      "AIRGAP_ANSWER_MODEL",
      "LLAMAPARSE_BASE_URL"
    ]) {
      expect(() => assertAirgapConfig(airgapEnv({ [key]: undefined }))).toThrow(new RegExp(key));
    }
  });
});

describe("constants are the single source of truth (drift guard) @AC-11.6", () => {
  it("the pgvector column dimension is 1536", () => {
    expect(EMBEDDING_DIM).toBe(1536);
  });
});

// AC-11.8 — the operator-visible indicator is fed by a DISPLAY-SAFE descriptor.
// Unlike the resolvers (which fail closed by throwing), this helper must NEVER
// throw: a misconfigured panel still has to render something honest rather than
// crash the founder page. It reports what is configured; the resolvers remain the
// enforcement boundary at request time.
describe("describeInferenceMode @AC-11.8", () => {
  it("cloud → labels the cloud backend + real model names + cloud parse host", () => {
    const v = describeInferenceMode({ OPENAI_API_KEY: "sk-x" });
    expect(v.mode).toBe("cloud");
    expect(v.local).toBe(false);
    expect(v.embedModel).toBe(EMBEDDING_MODEL);
    expect(v.answerModel).toBe(ANSWER_MODEL);
    // host of the LlamaParse cloud base, not the full URL
    expect(v.parseHost).toBe("api.cloud.llamaindex.ai");
  });

  it("cloud → reflects an explicit LLAMAPARSE_BASE_URL override as a host", () => {
    const v = describeInferenceMode({
      LLAMAPARSE_BASE_URL: "https://eu.example.com/api/v1"
    });
    expect(v.parseHost).toBe("eu.example.com");
  });

  it("airgap → labels the local backend + local models + local parse host", () => {
    const v = describeInferenceMode(airgapEnv());
    expect(v.mode).toBe("airgap");
    expect(v.local).toBe(true);
    expect(v.embedModel).toBe("local-embed-1536");
    expect(v.answerModel).toBe("local-llama");
    expect(v.parseHost).toBe("localhost"); // from http://localhost:8080/api/v1
  });

  it("NEVER throws on an invalid mode — returns an 'invalid' descriptor", () => {
    let v!: ReturnType<typeof describeInferenceMode>;
    expect(() => {
      v = describeInferenceMode({ INFERENCE_MODE: "air-gap" });
    }).not.toThrow();
    expect(v.mode).toBe("invalid");
  });

  it("NEVER throws when airgap vars are missing — shows placeholders, not a crash", () => {
    let v!: ReturnType<typeof describeInferenceMode>;
    expect(() => {
      v = describeInferenceMode({ INFERENCE_MODE: "airgap" });
    }).not.toThrow();
    expect(v.mode).toBe("airgap");
    expect(v.local).toBe(true);
    // unconfigured model/host degrade to a visible placeholder, never empty
    expect(v.embedModel).toBe("—");
    expect(v.answerModel).toBe("—");
    expect(v.parseHost).toBe("—");
  });

  it("falls back to the raw value when a base URL is unparseable", () => {
    const v = describeInferenceMode(
      airgapEnv({ LLAMAPARSE_BASE_URL: "not a url" })
    );
    expect(v.parseHost).toBe("not a url");
  });
});

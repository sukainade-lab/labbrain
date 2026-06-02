import { ANSWER_MODEL, EMBEDDING_DIM, EMBEDDING_MODEL, LLAMAPARSE_CLOUD_BASE } from "./constants";

// S11 — Air-gap mode. The SINGLE source of truth for which inference backend each
// seam (parse / embed / answer) uses. `INFERENCE_MODE` is a deploy-time switch:
//   cloud  (default) — OpenAI + cloud LlamaParse (existing behaviour, unchanged)
//   airgap           — local Ollama (OpenAI-compatible) + self-hosted LlamaParse;
//                      NO request ever leaves the host.
//
// Compliance guarantee: an air-gap deployment must FAIL CLOSED. If any required
// local var is missing/invalid the resolver THROWS — it is impossible to silently
// route a classified document to a cloud endpoint as a "fallback".

export { LLAMAPARSE_CLOUD_BASE };

// The resolvers only ever read string env vars, so they accept any string dict —
// `process.env` satisfies this, and tests can pass a plain literal without casting
// to the (Next-augmented, NODE_ENV-required) NodeJS.ProcessEnv type.
export type InferenceEnv = Record<string, string | undefined>;

export type InferenceMode = "cloud" | "airgap";
export type OpenAiSeam = "embed" | "answer";

export interface OpenAiBackend {
  /** undefined = the OpenAI SDK default base (api.openai.com). Set = local Ollama. */
  baseURL: string | undefined;
  model: string;
  apiKey: string;
}

export interface ParseBackend {
  baseURL: string;
}

// Distinct error type so callers/tests can assert config failure (vs a network error).
export class InferenceConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InferenceConfigError";
  }
}

export function getInferenceMode(env: InferenceEnv = process.env): InferenceMode {
  const raw = (env.INFERENCE_MODE ?? "").trim().toLowerCase();
  if (raw === "" || raw === "cloud") return "cloud";
  if (raw === "airgap") return "airgap";
  throw new InferenceConfigError(
    `INFERENCE_MODE="${env.INFERENCE_MODE}" is invalid — expected "cloud" or "airgap".`
  );
}

export function isAirgap(env: InferenceEnv = process.env): boolean {
  return getInferenceMode(env) === "airgap";
}

function required(env: InferenceEnv, key: string): string {
  const v = (env[key] ?? "").trim();
  if (!v) {
    throw new InferenceConfigError(`${key} is required when INFERENCE_MODE=airgap.`);
  }
  return v;
}

// AC-11.5/11.6 — validate the whole air-gap contract up front: every local var
// present AND the embedding model's declared dimension equals the pgvector column.
export function assertAirgapConfig(env: InferenceEnv = process.env): void {
  required(env, "OLLAMA_BASE_URL");
  required(env, "AIRGAP_EMBEDDING_MODEL");
  const dimRaw = required(env, "AIRGAP_EMBEDDING_DIM");
  const dim = Number(dimRaw);
  if (!Number.isInteger(dim) || dim !== EMBEDDING_DIM) {
    throw new InferenceConfigError(
      `AIRGAP_EMBEDDING_DIM=${dimRaw} must equal the pgvector column dimension (${EMBEDDING_DIM}). ` +
        `Pick a local embedding model that produces ${EMBEDDING_DIM}-dimensional vectors.`
    );
  }
  required(env, "AIRGAP_ANSWER_MODEL");
  required(env, "LLAMAPARSE_BASE_URL");
}

// AC-11.1/11.2/11.3 — resolve the embed/answer backend. Cloud → OpenAI default base.
// Airgap → Ollama's OpenAI-compatible base (so the existing `openai` SDK is reused
// verbatim with only a baseURL swap). Ollama ignores auth but the SDK requires a
// non-empty apiKey, so a sentinel is supplied.
export function resolveOpenAiBackend(
  seam: OpenAiSeam,
  env: InferenceEnv = process.env
): OpenAiBackend {
  if (getInferenceMode(env) === "cloud") {
    const apiKey = (env.OPENAI_API_KEY ?? "").trim();
    if (!apiKey) {
      throw new InferenceConfigError(`OPENAI_API_KEY is not set — cannot ${seam}.`);
    }
    return {
      baseURL: undefined,
      model: seam === "embed" ? EMBEDDING_MODEL : ANSWER_MODEL,
      apiKey
    };
  }

  assertAirgapConfig(env);
  return {
    baseURL: required(env, "OLLAMA_BASE_URL"),
    model: required(env, seam === "embed" ? "AIRGAP_EMBEDDING_MODEL" : "AIRGAP_ANSWER_MODEL"),
    apiKey: "ollama"
  };
}

// AC-11.4 — resolve the document-parse base. Cloud → LlamaParse cloud (or an explicit
// override). Airgap → the required self-hosted base, never the cloud default.
export function resolveParseBackend(env: InferenceEnv = process.env): ParseBackend {
  if (getInferenceMode(env) === "cloud") {
    return { baseURL: (env.LLAMAPARSE_BASE_URL ?? "").trim() || LLAMAPARSE_CLOUD_BASE };
  }
  assertAirgapConfig(env);
  return { baseURL: required(env, "LLAMAPARSE_BASE_URL") };
}

const PLACEHOLDER = "—";

// Extract just the host for compact display; degrade to the raw string (never empty)
// if it isn't a parseable URL, so the operator sees *something* truthful.
function hostOf(url: string): string {
  const v = url.trim();
  if (!v) return PLACEHOLDER;
  try {
    return new URL(v).hostname;
  } catch {
    return v;
  }
}

// AC-11.8 — a DISPLAY-SAFE view of the current inference backend for the operator
// indicator (admin/founder). Unlike the resolvers, this NEVER throws: a
// misconfigured deployment must still render an honest panel rather than crash the
// page. It reports what is *configured* — the resolvers stay the enforcement
// boundary that fails closed at request time.
export interface InferenceModeView {
  mode: InferenceMode | "invalid";
  local: boolean;
  embedModel: string;
  answerModel: string;
  parseHost: string;
}

export function describeInferenceMode(
  env: InferenceEnv = process.env
): InferenceModeView {
  let mode: InferenceMode | "invalid";
  try {
    mode = getInferenceMode(env);
  } catch {
    mode = "invalid";
  }

  if (mode === "airgap") {
    return {
      mode,
      local: true,
      embedModel: (env.AIRGAP_EMBEDDING_MODEL ?? "").trim() || PLACEHOLDER,
      answerModel: (env.AIRGAP_ANSWER_MODEL ?? "").trim() || PLACEHOLDER,
      parseHost: hostOf(env.LLAMAPARSE_BASE_URL ?? "")
    };
  }

  if (mode === "invalid") {
    return {
      mode,
      local: false,
      embedModel: PLACEHOLDER,
      answerModel: PLACEHOLDER,
      parseHost: PLACEHOLDER
    };
  }

  // cloud
  return {
    mode,
    local: false,
    embedModel: EMBEDDING_MODEL,
    answerModel: ANSWER_MODEL,
    parseHost: hostOf((env.LLAMAPARSE_BASE_URL ?? "").trim() || LLAMAPARSE_CLOUD_BASE)
  };
}

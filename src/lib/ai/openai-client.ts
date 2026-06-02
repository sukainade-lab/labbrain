import OpenAI from "openai";
import type { OpenAiBackend } from "./inference-mode";

// Build (and memoize) an OpenAI-compatible client for a resolved backend. In cloud
// mode `baseURL` is undefined → the SDK talks to api.openai.com; in air-gap mode it
// points at the local Ollama OpenAI-compatible endpoint. Memoized per (baseURL,key)
// so a process that only ever runs one mode reuses a single client, while tests that
// flip modes still get a correctly-targeted client.
//
// Constructing lazily (here, not at module load) preserves the original property that
// a missing key never crashes `next build` — the throw happens in the resolver when
// an inference call is actually made.

const cache = new Map<string, OpenAI>();

export function getOpenAiClient(backend: OpenAiBackend): OpenAI {
  const key = `${backend.baseURL ?? "default"}|${backend.apiKey}`;
  let client = cache.get(key);
  if (!client) {
    client = new OpenAI({ apiKey: backend.apiKey, baseURL: backend.baseURL });
    cache.set(key, client);
  }
  return client;
}

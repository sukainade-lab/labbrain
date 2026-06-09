import { describe, it, expect, beforeEach, vi } from "vitest";

// S17 AC-17.2 / AC-17.5 — cross-lingual translation of the question for retrieval.
// The OpenAI/Ollama answer seam is mocked: we verify the orchestration contract
// (target language, temperature 0, token-preservation instruction, fail-open), not
// the model's wording.

const create = vi.fn();
vi.mock("@/lib/ai/openai-client", () => ({
  getOpenAiClient: () => ({ chat: { completions: { create } } })
}));
vi.mock("@/lib/ai/inference-mode", () => ({
  resolveOpenAiBackend: vi.fn(() => ({ model: "gpt-4o-mini", apiKey: "test", baseURL: undefined }))
}));

import { translateQuery } from "@/lib/qa/translate";
import { resolveOpenAiBackend } from "@/lib/ai/inference-mode";

function reply(content: string) {
  return { choices: [{ message: { content } }] };
}

describe("S17 translateQuery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("@AC-17.2 translates an Arabic question to English at temperature 0", async () => {
    create.mockResolvedValueOnce(reply("what is impartiality?"));
    const out = await translateQuery("ما هي الحيادية؟", "ar");

    expect(out).toBe("what is impartiality?");
    expect(create).toHaveBeenCalledTimes(1);
    const arg = create.mock.calls[0][0];
    expect(arg.temperature).toBe(0);
    const system = arg.messages.find((m: { role: string }) => m.role === "system").content;
    expect(system).toMatch(/English/);
  });

  it("@AC-17.2 translates an English question to Arabic", async () => {
    create.mockResolvedValueOnce(reply("ما هي الحيادية؟"));
    const out = await translateQuery("what is impartiality?", "en");

    expect(out).toBe("ما هي الحيادية؟");
    const system = create.mock.calls[0][0].messages.find(
      (m: { role: string }) => m.role === "system"
    ).content;
    expect(system).toMatch(/Arabic/);
  });

  it("@AC-17.2 instructs preservation of ISO numbers, units, and JISM", async () => {
    create.mockResolvedValueOnce(reply("ما هو ISO 17025؟"));
    await translateQuery("what is ISO 17025?", "en");
    const system = create.mock.calls[0][0].messages.find(
      (m: { role: string }) => m.role === "system"
    ).content;
    expect(system).toMatch(/JISM/);
    expect(system.toLowerCase()).toMatch(/clause|number/);
  });

  it("@AC-17.2 trims surrounding whitespace from the model output", async () => {
    create.mockResolvedValueOnce(reply("  what is calibration?  \n"));
    expect(await translateQuery("ما هي المعايرة؟", "ar")).toBe("what is calibration?");
  });

  it("@AC-17.5 fail-open: returns null when the model throws", async () => {
    create.mockRejectedValueOnce(new Error("network down"));
    expect(await translateQuery("ما هي الحيادية؟", "ar")).toBeNull();
  });

  it("@AC-17.5 fail-open: returns null on empty output", async () => {
    create.mockResolvedValueOnce(reply("   "));
    expect(await translateQuery("ما هي الحيادية؟", "ar")).toBeNull();
  });

  it("@AC-17.5 fail-open: returns null when translation equals the original (case/space-insensitive)", async () => {
    create.mockResolvedValueOnce(reply("  What Is ISO 17025?  "));
    expect(await translateQuery("what is ISO 17025?", "en")).toBeNull();
  });

  it("@AC-17.5 fail-open: returns null when the backend is misconfigured (resolver throws)", async () => {
    vi.mocked(resolveOpenAiBackend).mockImplementationOnce(() => {
      throw new Error("OPENAI_API_KEY is not set");
    });
    expect(await translateQuery("ما هي الحيادية؟", "ar")).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });
});

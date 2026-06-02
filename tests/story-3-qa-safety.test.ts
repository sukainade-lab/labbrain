import { describe, it, expect } from "vitest";
import {
  isNotFoundAnswer,
  buildSystemPrompt,
  NOT_FOUND_AR,
  NOT_FOUND_EN
} from "@/lib/qa/prompt";

// Story 3 — P0 safety contract (pre-launch adversarial pass). A hallucinated ISO
// clause read to a JISM auditor is a non-conformity finding, so the refusal path
// is the product's hardest contract. These cases pin the failure modes where a
// model REFUSAL would otherwise be mislabelled found_answer=true and get a
// citation block stapled to "I couldn't find an answer" in the AC-3.7 audit log.

describe("Story 3 — refusal detection is language-consistent (@AC-3.3 / @AC-3.5)", () => {
  it("catches an English refusal sentinel (the cross-language bug)", () => {
    // The old prompt told the model to refuse in Arabic even on English answers;
    // at temp 0 the model often refused in English instead, and the old detector
    // only matched the Arabic string → an English refusal was logged as found.
    expect(isNotFoundAnswer(NOT_FOUND_EN)).toBe(true);
  });

  it("catches the Arabic refusal sentinel", () => {
    expect(isNotFoundAnswer(NOT_FOUND_AR)).toBe(true);
  });

  it("catches an English refusal with a leading hedge", () => {
    expect(
      isNotFoundAnswer("Unfortunately, I couldn't find an answer to this question in your documents.")
    ).toBe(true);
  });

  it("catches an English refusal with a trailing nudge", () => {
    expect(
      isNotFoundAnswer("I couldn't find an answer to this question in your documents. Please upload the SOP.")
    ).toBe(true);
  });

  it("catches an English refusal that dropped the trailing period", () => {
    expect(
      isNotFoundAnswer("I couldn't find an answer to this question in your documents")
    ).toBe(true);
  });

  it("catches an English refusal written with a typographic apostrophe", () => {
    // GPT-4o-mini frequently emits a curly ’ in "couldn’t".
    expect(
      isNotFoundAnswer("I couldn’t find an answer to this question in your documents.")
    ).toBe(true);
  });

  it("catches an Arabic refusal with surrounding whitespace and no period", () => {
    expect(isNotFoundAnswer("  لم أجد إجابة لهذا السؤال في وثائقكم  ")).toBe(true);
  });
});

describe("Story 3 — empty / degenerate answers are never 'found' (@AC-3.5)", () => {
  it("treats an empty string as not-found", () => {
    // generateAnswer returns "" when the model yields no content; that must never
    // be logged found_answer=true with citations attached.
    expect(isNotFoundAnswer("")).toBe(true);
  });

  it("treats a whitespace-only answer as not-found", () => {
    expect(isNotFoundAnswer("   \n\t  ")).toBe(true);
  });
});

describe("Story 3 — real grounded answers stay 'found' (no false refusals)", () => {
  it("an Arabic grounded answer is found", () => {
    expect(isNotFoundAnswer("وفقاً للإجراء، فترة المعايرة 12 شهراً.")).toBe(false);
  });

  it("an English grounded answer is found", () => {
    expect(isNotFoundAnswer("Per SOP-04, the calibration interval is 12 months.")).toBe(false);
  });
});

describe("Story 3 — the system prompt refuses in the answer's language (@AC-3.3)", () => {
  it("instructs an Arabic refusal for an Arabic answer", () => {
    const p = buildSystemPrompt("ar");
    expect(p).toContain(NOT_FOUND_AR);
    expect(p).not.toContain(NOT_FOUND_EN);
  });

  it("instructs an English refusal for an English answer", () => {
    const p = buildSystemPrompt("en");
    expect(p).toContain(NOT_FOUND_EN);
    expect(p).not.toContain(NOT_FOUND_AR);
  });
});

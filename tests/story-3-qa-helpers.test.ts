import { describe, it, expect } from "vitest";
import { detectLang } from "@/lib/qa/lang";
import { isNotFoundAnswer, formatContext, NOT_FOUND_AR } from "@/lib/qa/prompt";
import { buildCitations } from "@/lib/qa/citations";
import type { RetrievedChunk } from "@/lib/qa/types";

// Story 3 — pure helpers (no DB / no network). The retrieval + persistence path
// is exercised live in tests/story-3-qa.test.ts; the HTTP seam in
// tests/story-3-qa-routes.test.ts (Lesson L1).

function chunk(over: Partial<RetrievedChunk> = {}): RetrievedChunk {
  return {
    id: "c1",
    document_id: "d1",
    document_filename: "SOP.pdf",
    content: "some clause text",
    page_number: 7,
    section: "5.3",
    similarity: 0.91,
    ...over
  };
}

describe("Story 3 — language detection (@AC-3.1)", () => {
  it("detects Arabic from Arabic-script text", () => {
    expect(detectLang("ما هو إجراء المعايرة؟")).toBe("ar");
  });

  it("detects English from Latin text", () => {
    expect(detectLang("What is the calibration interval?")).toBe("en");
  });

  it("treats mixed AR+EN (any Arabic present) as Arabic", () => {
    expect(detectLang("ما هو الـ calibration interval لـ class E2؟")).toBe("ar");
  });

  it("defaults bare technical English to English", () => {
    expect(detectLang("ISO 17025 clause 7.6")).toBe("en");
  });
});

describe("Story 3 — not-found detection (@AC-3.3 / @AC-3.5)", () => {
  it("recognises the exact Arabic refusal sentinel", () => {
    expect(isNotFoundAnswer(NOT_FOUND_AR)).toBe(true);
  });

  it("recognises the sentinel embedded with surrounding whitespace", () => {
    expect(isNotFoundAnswer(`  ${NOT_FOUND_AR}  `)).toBe(true);
  });

  it("treats a real grounded answer as found", () => {
    expect(isNotFoundAnswer("وفقاً للإجراء، الفترة 12 شهراً.")).toBe(false);
  });
});

describe("Story 3 — citations (@AC-3.4)", () => {
  it("carries document name, section, page from a chunk", () => {
    const cites = buildCitations([chunk()]);
    expect(cites).toHaveLength(1);
    expect(cites[0]).toMatchObject({
      document_id: "d1",
      document_name: "SOP.pdf",
      section: "5.3",
      page_number: 7
    });
  });

  it("dedupes two chunks from the same document + page into one citation", () => {
    const cites = buildCitations([
      chunk({ id: "a" }),
      chunk({ id: "b", content: "second chunk same page" })
    ]);
    expect(cites).toHaveLength(1);
  });

  it("keeps distinct pages as separate citations, in order", () => {
    const cites = buildCitations([
      chunk({ id: "a", page_number: 7, similarity: 0.95 }),
      chunk({ id: "b", page_number: 11, similarity: 0.8, document_filename: "Calib.pdf", document_id: "d2" })
    ]);
    expect(cites.map((c) => c.page_number)).toEqual([7, 11]);
  });
});

describe("Story 3 — context formatting (@AC-3.2)", () => {
  it("numbers excerpts and includes filename + page for grounding", () => {
    const ctx = formatContext([chunk({ document_filename: "Unc.pdf", page_number: 18, section: "7.6.2" })]);
    expect(ctx).toContain("[1]");
    expect(ctx).toContain("Unc.pdf");
    expect(ctx).toContain("18");
    expect(ctx).toContain("some clause text");
  });
});

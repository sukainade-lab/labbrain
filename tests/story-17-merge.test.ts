import { describe, it, expect } from "vitest";
import { mergeRetrieved } from "@/lib/qa/merge";
import type { RetrievedChunk } from "@/lib/qa/types";

// S17 AC-17.3 — union two retrieval result sets, dedupe by id keeping the max
// similarity, sort by similarity desc, truncate to the limit. Pure, no I/O.

function chunk(id: string, similarity: number): RetrievedChunk {
  return {
    id,
    document_id: `doc-${id}`,
    document_filename: `${id}.pdf`,
    content: `content ${id}`,
    page_number: 1,
    section: null,
    similarity
  };
}

describe("S17 mergeRetrieved (pure)", () => {
  it("@AC-17.3 returns [] when all sets are empty", () => {
    expect(mergeRetrieved([], 5)).toEqual([]);
    expect(mergeRetrieved([[], []], 5)).toEqual([]);
  });

  it("@AC-17.3 a single set passes through, sorted desc and capped", () => {
    const out = mergeRetrieved([[chunk("a", 0.4), chunk("b", 0.9), chunk("c", 0.6)]], 2);
    expect(out.map((c) => c.id)).toEqual(["b", "c"]);
  });

  it("@AC-17.3 dedupes by id, keeping the higher similarity", () => {
    const out = mergeRetrieved(
      [
        [chunk("a", 0.42), chunk("b", 0.5)],
        [chunk("a", 0.71), chunk("c", 0.6)]
      ],
      5
    );
    expect(out.map((c) => c.id)).toEqual(["a", "c", "b"]);
    expect(out.find((c) => c.id === "a")!.similarity).toBe(0.71);
  });

  it("@AC-17.3 unions disjoint sets, sorts desc, truncates to limit", () => {
    const out = mergeRetrieved(
      [
        [chunk("a", 0.3), chunk("b", 0.8)],
        [chunk("c", 0.5), chunk("d", 0.95), chunk("e", 0.1)]
      ],
      3
    );
    expect(out.map((c) => c.id)).toEqual(["d", "b", "c"]);
    expect(out).toHaveLength(3);
  });

  it("@AC-17.3 keeps the kept chunk's own fields (not just the score)", () => {
    // When the same id appears twice with different bodies, the higher-similarity
    // occurrence wins wholesale (its content/page travel with its score).
    const lo = { ...chunk("a", 0.3), content: "low", page_number: 1 };
    const hi = { ...chunk("a", 0.9), content: "high", page_number: 9 };
    const out = mergeRetrieved([[lo], [hi]], 5);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ content: "high", page_number: 9, similarity: 0.9 });
  });

  it("@AC-17.3 does not mutate the input arrays", () => {
    const a = [chunk("a", 0.3)];
    const b = [chunk("b", 0.8)];
    mergeRetrieved([a, b], 5);
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
  });
});

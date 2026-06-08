import { describe, it, expect } from "vitest";
import { SIMILARITY_THRESHOLD, MATCH_COUNT } from "@/lib/qa/ask";

// Story 3 — retrieval-gate calibration (production-incident regression).
//
// Root cause of the "weak results" incident (2026-06-06): the cosine gate was set
// to 0.75. For the embedding model in use (text-embedding-3-small), a SHORT user
// question compared against a LONG document passage produces cosine scores that
// cluster in ~0.30–0.55 even for a genuine, on-topic match. 0.75 is at the very
// top of that achievable range, so the gate refused content that WAS in the lab's
// own document.
//
// Production evidence (live `queries` table, tenant with the ISO/IEC 17025 PDF
// indexed, 64 healthy 1536-dim chunks):
//   - 17 questions asked, exactly 1 cleared the gate → 5.9% found-rate.
//   - The single success ("what is flow meter") scored 0.7559 — it BARELY cleared
//     0.75, and only because it was a near-lexical match in a "Flow measurement"
//     section.
//   - Questions answerable straight from the standard ("what is impartiality?",
//     "what is the management system requirement?", "what is calibration?") all
//     scored below 0.75 and were refused.
//
// The zero-hallucination guarantee does NOT depend on this gate being high: the
// real precision guard is the LLM grounding contract (answer ONLY from excerpts +
// `isNotFoundAnswer` canonicalisation in prompt.ts). The similarity gate is only a
// coarse pre-filter to avoid feeding wholly-irrelevant chunks to the model. So the
// gate is calibrated for RECALL; the model still refuses anything not supported by
// the retrieved text.
//
// This test pins the calibrated band so a future edit cannot silently re-introduce
// the starvation bug (or swing the gate so low it stops pre-filtering at all).
describe("Story 3 — retrieval gate is calibrated for text-embedding-3-small (@AC-3.2 @AC-3.5)", () => {
  it("similarity threshold is in the recall-calibrated band, not the starvation value", () => {
    // Upper bound 0.5: above this, short-question→long-passage matches get starved
    // (this is exactly what 0.75 did). Lower bound 0.2: below this the gate stops
    // pre-filtering and leans entirely on the LLM grounding guard.
    expect(SIMILARITY_THRESHOLD).toBeGreaterThanOrEqual(0.2);
    expect(SIMILARITY_THRESHOLD).toBeLessThanOrEqual(0.5);
  });

  it("retrieves the BRD-specified top-5 chunks", () => {
    // AC-3.2 — top-5 retrieval. Pinned so the gate fix doesn't drift the count.
    expect(MATCH_COUNT).toBe(5);
  });
});

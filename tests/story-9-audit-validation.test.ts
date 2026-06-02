import { describe, it, expect } from "vitest";
import { parseAuditRange, rangeLabel, type AuditRange } from "@/lib/validation/audit";

// Story 9 — pure range validation (no DB / no network). The HTTP seam is
// exercised in tests/story-9-audit-routes.test.ts (Lesson L1); the live query
// in tests/story-9-audit.test.ts (Lesson L2).

describe("Story 9 — audit range parsing (@AC-9.3)", () => {
  it("omitting both params → full history (null range, ok)", () => {
    const r = parseAuditRange({});
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.range.from).toBeNull();
      expect(r.range.to).toBeNull();
    }
  });

  it("treats empty-string params as omitted", () => {
    const r = parseAuditRange({ from: "", to: "" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.range.from).toBeNull();
      expect(r.range.to).toBeNull();
    }
  });

  it("accepts a valid inclusive YYYY-MM-DD range", () => {
    const r = parseAuditRange({ from: "2026-01-01", to: "2026-03-31" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.range.from).toBe("2026-01-01");
      expect(r.range.to).toBe("2026-03-31");
    }
  });

  it("accepts an equal from/to (single-day, inclusive)", () => {
    const r = parseAuditRange({ from: "2026-02-15", to: "2026-02-15" });
    expect(r.ok).toBe(true);
  });

  it("accepts a from-only (open-ended) range", () => {
    const r = parseAuditRange({ from: "2026-01-01" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.range.from).toBe("2026-01-01");
      expect(r.range.to).toBeNull();
    }
  });

  it("accepts a to-only (open-ended) range", () => {
    const r = parseAuditRange({ to: "2026-06-30" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.range.from).toBeNull();
      expect(r.range.to).toBe("2026-06-30");
    }
  });

  it("rejects a reversed range (from > to) → 400 message", () => {
    const r = parseAuditRange({ from: "2026-03-31", to: "2026-01-01" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/نطاق|تاريخ|range/i);
  });

  it("rejects a malformed date (not YYYY-MM-DD)", () => {
    const r = parseAuditRange({ from: "31/03/2026" });
    expect(r.ok).toBe(false);
  });

  it("rejects a syntactically-valid but impossible calendar date", () => {
    const r = parseAuditRange({ from: "2026-02-30" });
    expect(r.ok).toBe(false);
  });

  it("rejects a non-date garbage string", () => {
    const r = parseAuditRange({ to: "yesterday" });
    expect(r.ok).toBe(false);
  });
});

describe("Story 9 — range header label (@AC-9.3 / @AC-9.4)", () => {
  it("labels a null range as full history (bilingual)", () => {
    const label = rangeLabel({ from: null, to: null });
    expect(label).toContain("كامل السجل");
  });

  it("labels a closed range with both bounds", () => {
    const range: AuditRange = { from: "2026-01-01", to: "2026-03-31" };
    const label = rangeLabel(range);
    expect(label).toContain("2026-01-01");
    expect(label).toContain("2026-03-31");
  });

  it("labels a from-only range as 'since'", () => {
    const label = rangeLabel({ from: "2026-01-01", to: null });
    expect(label).toContain("2026-01-01");
  });

  it("labels a to-only range as 'until'", () => {
    const label = rangeLabel({ from: null, to: "2026-06-30" });
    expect(label).toContain("2026-06-30");
  });
});

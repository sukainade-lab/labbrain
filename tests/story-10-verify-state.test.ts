import { describe, it, expect } from "vitest";
import { compareParity, type ParityInput } from "@/lib/migration/verify";
import {
  MIGRATION_STATES,
  nextState,
  canTransition,
  isTerminal,
  type MigrationStatus
} from "@/lib/migration/state";

// S10 — pure tests for the parity comparator (AC-10.4) and the cutover
// state-machine reducer (AC-10.6). No DB / no network.

describe("S10 parity comparator (AC-10.4)", () => {
  const base: ParityInput = {
    source: { checksum: "h1", rowCounts: { tenants: 1, users: 2, queries: 5 } },
    target: { checksum: "h1", rowCounts: { tenants: 1, users: 2, queries: 5 } }
  };

  it("@AC-10.4 identical checksum + counts → match, no diff", () => {
    const r = compareParity(base);
    expect(r.match).toBe(true);
    expect(r.diff).toEqual([]);
  });

  it("@AC-10.4 row-count mismatch → not a match, diff names the table", () => {
    const r = compareParity({
      ...base,
      target: { checksum: "h1", rowCounts: { tenants: 1, users: 2, queries: 4 } }
    });
    expect(r.match).toBe(false);
    expect(r.diff.join(" ")).toContain("queries");
    expect(r.diff.join(" ")).toContain("5");
    expect(r.diff.join(" ")).toContain("4");
  });

  it("@AC-10.4 missing table on target → counted as mismatch", () => {
    const r = compareParity({
      source: { checksum: "h1", rowCounts: { tenants: 1, users: 2 } },
      target: { checksum: "h1", rowCounts: { tenants: 1 } }
    });
    expect(r.match).toBe(false);
    expect(r.diff.join(" ")).toContain("users");
  });

  it("@AC-10.4 checksum mismatch with equal counts → still not a match", () => {
    const r = compareParity({
      source: { checksum: "h1", rowCounts: { tenants: 1 } },
      target: { checksum: "h2", rowCounts: { tenants: 1 } }
    });
    expect(r.match).toBe(false);
    expect(r.diff.join(" ").toLowerCase()).toContain("checksum");
  });
});

describe("S10 migration state machine (AC-10.6)", () => {
  it("@AC-10.6 happy path advances pending→exported→imported→verified→cutover", () => {
    const path: MigrationStatus[] = [
      "pending",
      "exported",
      "imported",
      "verified",
      "cutover"
    ];
    for (let i = 0; i < path.length - 1; i++) {
      expect(nextState(path[i])).toBe(path[i + 1]);
      expect(canTransition(path[i], path[i + 1])).toBe(true);
    }
  });

  it("@AC-10.6 transitions are monotonic — cannot go backwards or skip", () => {
    expect(canTransition("imported", "exported")).toBe(false); // backwards
    expect(canTransition("pending", "verified")).toBe(false); // skip
    expect(canTransition("verified", "cutover")).toBe(true); // forward by one
  });

  it("@AC-10.6 any non-terminal state can fail", () => {
    for (const s of ["pending", "exported", "imported", "verified"] as MigrationStatus[]) {
      expect(canTransition(s, "failed")).toBe(true);
    }
  });

  it("@AC-10.6 cutover and failed are terminal — no further transitions, no double-cutover", () => {
    expect(isTerminal("cutover")).toBe(true);
    expect(isTerminal("failed")).toBe(true);
    expect(canTransition("cutover", "cutover")).toBe(false);
    expect(canTransition("cutover", "failed")).toBe(false);
    expect(nextState("cutover")).toBeNull();
    expect(nextState("failed")).toBeNull();
  });

  it("@AC-10.6 declares all six statuses", () => {
    expect(MIGRATION_STATES).toEqual([
      "pending",
      "exported",
      "imported",
      "verified",
      "cutover",
      "failed"
    ]);
  });
});

import { describe, it, expect } from "vitest";
import { regionLabel, migrationControl } from "@/lib/migration/view";

// S10 — pure presentation logic for the founder-panel migration control. This is
// the L4 reachable-path decision table: given a tenant's current data_region and
// latest migration status, what does the founder SEE and which single action can
// they take? Kept pure so the "verify before cutover" + "no double-cutover" rules
// are checkable without rendering React (the panel is a thin shell over this).

describe("regionLabel", () => {
  it("maps the two known regions to bilingual labels", () => {
    expect(regionLabel("eu-frankfurt")).toContain("فرانكفورت");
    expect(regionLabel("ksa-me-central-1")).toContain("me-central-1");
  });
  it("falls back to the raw code for an unknown region", () => {
    expect(regionLabel("mars-1")).toBe("mars-1");
  });
});

describe("migrationControl", () => {
  it("@AC-10.1 no run yet (EU, null) → offer migrate", () => {
    const v = migrationControl("eu-frankfurt", null);
    expect(v.kind).toBe("migrate");
    expect(v.cta).toEqual({ action: "migrate", label: expect.any(String) });
  });

  it("@AC-10.4 verified → offer cutover (verify gates cutover)", () => {
    const v = migrationControl("eu-frankfurt", "verified");
    expect(v.kind).toBe("cutover");
    expect(v.cta?.action).toBe("cutover");
  });

  it("@AC-10.4 verify_failed (status failed) → re-offer migrate, no cutover", () => {
    const v = migrationControl("eu-frankfurt", "failed");
    expect(v.kind).toBe("migrate");
    expect(v.cta?.action).toBe("migrate");
  });

  it("@AC-10.6 cutover → done, NO further action (no double-cutover)", () => {
    const v = migrationControl("ksa-me-central-1", "cutover");
    expect(v.kind).toBe("done");
    expect(v.cta).toBeNull();
  });

  it("@AC-10.6 already in KSA region masks any stale status → done", () => {
    const v = migrationControl("ksa-me-central-1", "verified");
    expect(v.kind).toBe("done");
    expect(v.cta).toBeNull();
  });

  it("@AC-10.6 mid-run states (pending/exported/imported) → running, no CTA", () => {
    for (const s of ["pending", "exported", "imported"] as const) {
      const v = migrationControl("eu-frankfurt", s);
      expect(v.kind).toBe("running");
      expect(v.cta).toBeNull();
    }
  });

  it("every view carries an Arabic status label + pill classes", () => {
    for (const s of [null, "verified", "failed", "cutover", "pending"] as const) {
      const v = migrationControl("eu-frankfurt", s);
      expect(v.statusLabel.length).toBeGreaterThan(0);
      expect(v.statusClass.length).toBeGreaterThan(0);
    }
  });
});

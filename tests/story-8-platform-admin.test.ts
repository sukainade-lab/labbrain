import { describe, it, expect } from "vitest";
import { parsePlatformAdmins, isPlatformAdmin } from "@/lib/auth/platform-admin";

// S8 — AC-8.1: the founder gate. There is NO super-admin role in the data model
// (users.role is tenant-scoped: owner/admin/member). Platform access is granted
// by a server-side env allowlist (PLATFORM_ADMIN_EMAILS) so no tenant user can
// self-escalate via a DB column. These pure-logic tests pin the matching rules;
// the route-level enforcement is covered by the seam suite (story-8-founder-routes).

describe("parsePlatformAdmins", () => {
  it("@AC-8.1 empty/undefined → no admins", () => {
    expect(parsePlatformAdmins(undefined)).toEqual([]);
    expect(parsePlatformAdmins("")).toEqual([]);
    expect(parsePlatformAdmins("   ")).toEqual([]);
  });

  it("@AC-8.1 splits, trims, lowercases, drops blanks", () => {
    expect(parsePlatformAdmins(" Founder@Lab.com , ops@lab.com ,, ")).toEqual([
      "founder@lab.com",
      "ops@lab.com"
    ]);
  });
});

describe("isPlatformAdmin", () => {
  const allow = "founder@lab.com,ops@lab.com";

  it("@AC-8.1 email on the allowlist → true (case-insensitive)", () => {
    expect(isPlatformAdmin("founder@lab.com", allow)).toBe(true);
    expect(isPlatformAdmin("Founder@Lab.com", allow)).toBe(true);
    expect(isPlatformAdmin("  ops@lab.com  ", allow)).toBe(true);
  });

  it("@AC-8.1 tenant user NOT on the allowlist → false (no self-escalation)", () => {
    expect(isPlatformAdmin("member@somelab.com", allow)).toBe(false);
  });

  it("@AC-8.1 null/empty email → false (fail closed)", () => {
    expect(isPlatformAdmin(null, allow)).toBe(false);
    expect(isPlatformAdmin(undefined, allow)).toBe(false);
    expect(isPlatformAdmin("", allow)).toBe(false);
  });

  it("@AC-8.1 unset allowlist → nobody is admin (fail closed)", () => {
    expect(isPlatformAdmin("founder@lab.com", undefined)).toBe(false);
    expect(isPlatformAdmin("founder@lab.com", "")).toBe(false);
  });
});

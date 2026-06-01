import { describe, it } from "vitest";

// Story 1 — Authentication, tenancy & team management.
// Stubs only; implementation lands in S1. Remove .skip as each AC is built.
describe("Story 1 — Auth & tenancy", () => {
  it.skip("@AC-1.1 signup accepts lab name, admin name, work email, password; triggers email verification", () => {});
  it.skip("@AC-1.2 verification link expires in 24h; clicking activates account and redirects to onboarding", () => {});
  it.skip("@AC-1.3 RLS isolates tenants — Lab A token cannot read Lab B documents/chunks/queries/users", () => {});
  it.skip("@AC-1.4 admin invites by email; invited user signs up via token and joins same tenant", () => {});
  it.skip("@AC-1.5 login, confirm, forgot, logout flows return correct errors for invalid input", () => {});
  it.skip("@AC-1.6 seat limits enforced: Starter=5, Pro=20; over-limit invite shows upgrade prompt", () => {});
});

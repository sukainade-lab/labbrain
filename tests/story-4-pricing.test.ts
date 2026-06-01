import { describe, it } from "vitest";

// Story 4 — Pricing, Stripe Checkout & account activation (founder override: Stripe).
describe("Story 4 — Pricing & Stripe activation", () => {
  it.skip("@AC-4.1 pricing page: Starter 35 JOD / Pro 70 JOD, annual -25%, currency JOD", () => {});
  it.skip("@AC-4.2 Subscribe creates Stripe Checkout session (mode subscription) + Request Invoice fallback emails founder", () => {});
  it.skip("@AC-4.3 signature-verified webhook: checkout.session.completed→active+subscriptions row+email; deleted/failed→inactive/past_due", () => {});
  it.skip("@AC-4.4 welcome email on account creation: lab name, admin name, 3 onboarding steps, demo link", () => {});
  it.skip("@AC-4.5 dashboard usage counters: documents X/limit, active users X/limit, questions this month", () => {});
});

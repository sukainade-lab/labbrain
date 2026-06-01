import { describe, it, expect } from "vitest";
import {
  PRICING_PLANS,
  getPlan,
  intervalTotal,
  monthlyEquivalent,
  ANNUAL_DISCOUNT
} from "@/lib/pricing/plans";

// Story 4 — Pricing, Stripe Checkout & account activation (founder override: Stripe).
describe("Story 4 — Pricing & Stripe activation", () => {
  describe("@AC-4.1 pricing plans", () => {
    it("Starter is 35 JOD/mo with 5 users / 50 docs", () => {
      const s = getPlan("starter");
      expect(s.monthly).toBe(35);
      expect(s.seatLimit).toBe(5);
      expect(s.docLimit).toBe(50);
    });

    it("Pro is 70 JOD/mo with 20 users / 200 docs", () => {
      const p = getPlan("pro");
      expect(p.monthly).toBe(70);
      expect(p.seatLimit).toBe(20);
      expect(p.docLimit).toBe(200);
    });

    it("annual billing is 25% off the 12-month total", () => {
      expect(ANNUAL_DISCOUNT).toBe(0.25);
      expect(intervalTotal(getPlan("starter"), "year")).toBe(315); // 35*12*0.75
      expect(intervalTotal(getPlan("pro"), "year")).toBe(630); // 70*12*0.75
    });

    it("annual monthly-equivalent is the discounted per-month price", () => {
      expect(monthlyEquivalent(getPlan("starter"), "year")).toBe(26.25);
      expect(monthlyEquivalent(getPlan("pro"), "year")).toBe(52.5);
      expect(monthlyEquivalent(getPlan("starter"), "month")).toBe(35);
    });

    it("features advertise the correct caps (no stale 100-doc / unlimited copy)", () => {
      const all = PRICING_PLANS.flatMap((p) => p.featuresAr).join(" ");
      expect(all).not.toMatch(/100 وثيقة/);
      expect(all).not.toMatch(/غير محدود/);
      expect(all).toMatch(/50 وثيقة/);
      expect(all).toMatch(/200 وثيقة/);
    });

    it("unknown plan id throws", () => {
      // @ts-expect-error — exercising the runtime guard
      expect(() => getPlan("enterprise")).toThrow();
    });
  });

  // @AC-4.2 covered in tests/story-4-checkout-routes.test.ts (route seam, Lesson L1).
  // @AC-4.3 covered in tests/story-4-webhook-routes.test.ts (signature gate + dispatch, L1)
  //         and tests/story-4-webhook.test.ts (live DB activation + idempotency).
  // @AC-4.4 covered in tests/story-4-welcome-email.test.ts (content) + wired into provisionSignup.
  // @AC-4.5 covered in tests/story-4-dashboard.test.ts (live counts + pure month window)
  //         and tests/story-4-dashboard-routes.test.ts (route seam, L1).
});

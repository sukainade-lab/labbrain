import { describe, it, expect } from "vitest";
import {
  parseResume,
  onboardingNext,
  resumeCheckoutHref,
  checkoutCtaState
} from "@/lib/payment/resume";

// Story 4 — AC-4.2 "resume the purchase" plumbing. The /5-eo-score residual was
// that a logged-out plan pick was dropped at signup (the choice didn't survive the
// round-trip) and the CTA binding wasn't render-tested. This pins the pure logic
// that now carries the choice signup → onboarding → pricing and drives the button.

describe("@AC-4.2 parseResume (allow-list)", () => {
  it("accepts a valid plan + interval", () => {
    expect(parseResume({ plan: "pro", interval: "year" })).toEqual({
      plan: "pro",
      interval: "year"
    });
    expect(parseResume({ plan: "starter", interval: "month" })).toEqual({
      plan: "starter",
      interval: "month"
    });
  });

  it("rejects an off-list plan (no echo of arbitrary input into a redirect)", () => {
    expect(parseResume({ plan: "enterprise", interval: "year" })).toBeNull();
    expect(parseResume({ plan: "../evil", interval: "month" })).toBeNull();
  });

  it("rejects an off-list interval", () => {
    expect(parseResume({ plan: "pro", interval: "weekly" })).toBeNull();
  });

  it("returns null when either value is missing", () => {
    expect(parseResume({ plan: "pro" })).toBeNull();
    expect(parseResume({ interval: "year" })).toBeNull();
    expect(parseResume({})).toBeNull();
    expect(parseResume({ plan: null, interval: null })).toBeNull();
  });
});

describe("@AC-4.2 onboardingNext (post-confirmation destination)", () => {
  it("plain /onboarding when there is no resume", () => {
    expect(onboardingNext(null)).toBe("/onboarding");
  });

  it("carries the choice when resuming", () => {
    expect(onboardingNext({ plan: "pro", interval: "year" })).toBe(
      "/onboarding?plan=pro&interval=year"
    );
  });

  it("stays a same-origin relative path (safeNext-compatible)", () => {
    const next = onboardingNext({ plan: "starter", interval: "month" });
    expect(next.startsWith("/")).toBe(true);
    expect(next.startsWith("//")).toBe(false);
  });
});

describe("@AC-4.2 resumeCheckoutHref", () => {
  it("routes back to pricing with the choice intact", () => {
    expect(resumeCheckoutHref({ plan: "pro", interval: "month" })).toBe(
      "/pricing?plan=pro&interval=month"
    );
  });
});

describe("@AC-4.2 checkoutCtaState (the render binding, unit-tested without a DOM)", () => {
  it("the pending card shows the spinner label, busy + disabled", () => {
    expect(
      checkoutCtaState({ planId: "pro", pendingPlan: "pro", resumePlan: null })
    ).toEqual({ label: "جارٍ التحويل…", busy: true, disabled: true });
  });

  it("a sibling card is disabled (but not busy) while another is pending", () => {
    expect(
      checkoutCtaState({ planId: "starter", pendingPlan: "pro", resumePlan: null })
    ).toEqual({ label: "ابدأ الآن", busy: false, disabled: true });
  });

  it("the resumed plan reads 'complete subscription'", () => {
    expect(
      checkoutCtaState({ planId: "pro", pendingPlan: null, resumePlan: "pro" })
    ).toEqual({ label: "أكمل الاشتراك", busy: false, disabled: false });
  });

  it("a non-resumed plan reads 'start now' when nothing is pending", () => {
    expect(
      checkoutCtaState({ planId: "starter", pendingPlan: null, resumePlan: "pro" })
    ).toEqual({ label: "ابدأ الآن", busy: false, disabled: false });
  });
});

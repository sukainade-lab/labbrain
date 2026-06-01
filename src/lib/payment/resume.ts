import { PRICING_PLANS, type Interval, type PlanId } from "@/lib/pricing/plans";

// AC-4.2 — "resume the purchase" plumbing. A visitor who picks a plan while
// logged out is sent to /signup carrying that choice; this module keeps the
// choice alive across the whole round-trip (signup → confirmation email →
// onboarding → pricing) so they don't have to re-pick after creating an account.
// All logic here is pure so the pricing CTA binding is unit-testable without a DOM
// (the /5-eo-score residual: the onClick wiring was not render-tested).

export interface Resume {
  plan: PlanId;
  interval: Interval;
}

const PLAN_IDS = new Set<string>(PRICING_PLANS.map((p) => p.id));
const INTERVALS = new Set<string>(["month", "year"]);

// Strict allow-list parse of carried checkout params. Returns null unless BOTH
// values are present AND on the allow-list — these flow into a redirect URL, so
// anything off-list is dropped rather than echoed back (open-redirect / injection
// defense, the same posture as safeNext).
export function parseResume(raw: {
  plan?: string | null;
  interval?: string | null;
}): Resume | null {
  const plan = raw.plan ?? "";
  const interval = raw.interval ?? "";
  if (!PLAN_IDS.has(plan) || !INTERVALS.has(interval)) return null;
  return { plan: plan as PlanId, interval: interval as Interval };
}

// Post-confirmation destination carried in the signup email link's `next` param.
// Resume present → land on onboarding remembering the choice; else the plain path.
// (safeNext in the confirm route re-validates this as a same-origin relative path.)
export function onboardingNext(resume: Resume | null): string {
  if (!resume) return "/onboarding";
  return `/onboarding?plan=${resume.plan}&interval=${resume.interval}`;
}

// Onboarding "complete subscription" CTA target — back to pricing, choice intact.
export function resumeCheckoutHref(resume: Resume): string {
  return `/pricing?plan=${resume.plan}&interval=${resume.interval}`;
}

// Pricing CTA button state for one plan card. Pure so the render binding is
// unit-tested directly: pending self → spinner+busy+disabled; any pending →
// disabled; the resumed plan reads "complete subscription" instead of "start".
export interface CtaState {
  label: string;
  busy: boolean;
  disabled: boolean;
}

export function checkoutCtaState(opts: {
  planId: PlanId;
  pendingPlan: string | null;
  resumePlan: PlanId | null;
}): CtaState {
  if (opts.pendingPlan === opts.planId) {
    return { label: "جارٍ التحويل…", busy: true, disabled: true };
  }
  const label = opts.resumePlan === opts.planId ? "أكمل الاشتراك" : "ابدأ الآن";
  return { label, busy: false, disabled: opts.pendingPlan !== null };
}

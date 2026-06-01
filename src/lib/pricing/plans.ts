import { PLAN_SEAT_LIMITS } from "@/lib/validation/auth";
import { PLAN_DOC_LIMITS } from "@/lib/documents/limits";

// AC-4.1 — pricing source of truth. Seat/doc caps reference the single-source
// constants (lib/validation/auth, lib/documents/limits) so the marketing copy
// can never drift from what the app actually enforces.

export type PlanId = "starter" | "pro";
export type Interval = "month" | "year";

export interface PricingPlan {
  id: PlanId;
  nameAr: string;
  /** JOD per month when billed monthly. */
  monthly: number;
  seatLimit: number;
  docLimit: number;
  featuresAr: string[];
  highlight?: boolean;
}

// Annual plans bill once a year at 25% off the 12-month total (AC-4.1).
export const ANNUAL_DISCOUNT = 0.25;

export const PRICING_PLANS: readonly PricingPlan[] = [
  {
    id: "starter",
    nameAr: "المبتدئ",
    monthly: 35,
    seatLimit: PLAN_SEAT_LIMITS.starter,
    docLimit: PLAN_DOC_LIMITS.starter,
    featuresAr: [
      `حتى ${PLAN_DOC_LIMITS.starter} وثيقة`,
      `حتى ${PLAN_SEAT_LIMITS.starter} مستخدمين`,
      "بحث ذكي بالعربي والإنجليزي",
      "اقتباس المصدر مع كل إجابة"
    ]
  },
  {
    id: "pro",
    nameAr: "الاحترافي",
    monthly: 70,
    seatLimit: PLAN_SEAT_LIMITS.pro,
    docLimit: PLAN_DOC_LIMITS.pro,
    highlight: true,
    featuresAr: [
      `حتى ${PLAN_DOC_LIMITS.pro} وثيقة`,
      `حتى ${PLAN_SEAT_LIMITS.pro} مستخدم`,
      "بحث ذكي بالعربي والإنجليزي",
      "اقتباس المصدر مع كل إجابة",
      "دعم بأولوية"
    ]
  }
];

// JOD has 3 decimal fils but pricing tiers land on clean 2-decimal figures
// (e.g. 26.25). Round to 2 to avoid float dust like 26.249999.
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Total amount billed for one interval: month → monthly; year → 12×monthly −25%. */
export function intervalTotal(plan: PricingPlan, interval: Interval): number {
  return interval === "month"
    ? plan.monthly
    : round2(plan.monthly * 12 * (1 - ANNUAL_DISCOUNT));
}

/** Per-month figure shown on the card; annual shows the discounted equivalent. */
export function monthlyEquivalent(plan: PricingPlan, interval: Interval): number {
  return interval === "month"
    ? plan.monthly
    : round2(plan.monthly * (1 - ANNUAL_DISCOUNT));
}

export function getPlan(id: PlanId): PricingPlan {
  const plan = PRICING_PLANS.find((p) => p.id === id);
  if (!plan) throw new Error(`unknown plan: ${id}`);
  return plan;
}

"use client";

import Link from "next/link";
import { useState } from "react";
import {
  PRICING_PLANS,
  intervalTotal,
  monthlyEquivalent,
  ANNUAL_DISCOUNT,
  type Interval
} from "@/lib/pricing/plans";
import { startCheckout } from "@/lib/payment/checkout-client";
import { parseResume, checkoutCtaState, type Resume } from "@/lib/payment/resume";
import { DEFAULT_CURRENCY } from "@/lib/pricing/currency";

// AC-4.1 — pricing page: Starter 35 / Pro 70 JOD, monthly⇄annual toggle (annual −25%).
// Plan/cap data comes from lib/pricing/plans (single source of truth).
// AC-4.2 — the CTA starts a real Stripe Checkout via /api/checkout (authenticated
// tenants → Stripe; visitors → /signup carrying the chosen plan). A resumed pick
// (?plan=&interval= from the post-signup round-trip) pre-selects the interval and
// flags the chosen card so the purchase picks up exactly where it left off.
const DISCOUNT_PCT = Math.round(ANNUAL_DISCOUNT * 100);

function Jod() {
  // English currency code stays LTR-isolated inside the Arabic line.
  return <bdi>JOD</bdi>;
}

// Read the carried plan choice once, client-side, via a lazy initializer so the
// page stays statically rendered (no useSearchParams → no Suspense boundary).
function readResume(): Resume | null {
  if (typeof window === "undefined") return null;
  const sp = new URLSearchParams(window.location.search);
  return parseResume({ plan: sp.get("plan"), interval: sp.get("interval") });
}

export default function PricingPage() {
  const [resume] = useState<Resume | null>(readResume);
  const [interval, setInterval] = useState<Interval>(resume?.interval ?? "month");
  const [pendingPlan, setPendingPlan] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onChoosePlan(planId: string) {
    setError(null);
    setPendingPlan(planId);
    await startCheckout(
      planId,
      interval,
      {
        redirect: (url) => {
          window.location.href = url;
        },
        onError: (msg) => {
          setError(msg);
          setPendingPlan(null);
        }
      },
      // JOD is the live default → the server router sends this to Tap (AC-6.1/6.6).
      DEFAULT_CURRENCY
    );
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-20">
      <h1 className="text-center text-3xl font-bold text-navy">الأسعار</h1>
      <p className="mt-3 text-center text-muted">
        ادفع بالدينار الأردني. ألغِ في أي وقت.
      </p>

      {/* Billing-interval toggle */}
      <div
        className="mt-8 flex items-center justify-center gap-1 rounded-full border border-line bg-card p-1 mx-auto w-fit shadow-soft"
        role="group"
        aria-label="دورة الفوترة"
      >
        <button
          type="button"
          onClick={() => setInterval("month")}
          aria-pressed={interval === "month"}
          className={`min-h-[44px] rounded-full px-5 text-sm font-medium transition ${
            interval === "month"
              ? "bg-brand-amber text-white shadow-soft"
              : "text-muted hover:text-navy"
          }`}
        >
          شهري
        </button>
        <button
          type="button"
          onClick={() => setInterval("year")}
          aria-pressed={interval === "year"}
          className={`min-h-[44px] rounded-full px-5 text-sm font-medium transition ${
            interval === "year"
              ? "bg-brand-amber text-white shadow-soft"
              : "text-muted hover:text-navy"
          }`}
        >
          سنوي
          <span className="ms-2 rounded-full bg-success-soft px-2 py-0.5 text-xs font-medium text-success-strong">
            وفّر {DISCOUNT_PCT}%
          </span>
        </button>
      </div>

      <div className="mt-12 grid gap-6 sm:grid-cols-2">
        {PRICING_PLANS.map((plan) => {
          const perMonth = monthlyEquivalent(plan, interval);
          const yearTotal = intervalTotal(plan, "year");
          const cta = checkoutCtaState({
            planId: plan.id,
            pendingPlan,
            resumePlan: resume?.plan ?? null
          });
          const resumed = resume?.plan === plan.id;
          return (
            <div
              key={plan.id}
              className={`rounded-card border bg-card p-8 shadow-soft transition-all hover:shadow-lift ${
                resumed
                  ? "border-brand-amber ring-2 ring-brand-amber/40"
                  : plan.highlight
                    ? "border-brand-amber"
                    : "border-line"
              }`}
            >
              <h2 className="text-xl font-semibold text-navy">{plan.nameAr}</h2>

              <p className="mt-4 text-3xl font-bold text-brand-amber">
                <bdi>{perMonth}</bdi>{" "}
                <span className="text-base font-normal text-muted">
                  <Jod /> / شهرياً
                </span>
              </p>

              {interval === "year" ? (
                <p className="mt-1 text-sm text-muted">
                  تُدفع سنوياً: <bdi>{yearTotal}</bdi> <Jod /> / سنة
                </p>
              ) : (
                <p className="mt-1 text-sm text-muted">أو وفّر {DISCOUNT_PCT}% بالاشتراك السنوي</p>
              )}

              <ul className="mt-6 space-y-2 text-ink">
                {plan.featuresAr.map((f) => (
                  <li key={f}>• {f}</li>
                ))}
              </ul>

              <button
                type="button"
                onClick={() => onChoosePlan(plan.id)}
                disabled={cta.disabled}
                aria-busy={cta.busy}
                className="mt-8 block w-full min-h-[44px] rounded-control bg-brand-amber px-6 py-3 text-center font-semibold text-white shadow-soft transition-all hover:bg-brand-amber-hover hover:shadow-lift disabled:opacity-60"
              >
                {cta.label}
              </button>
            </div>
          );
        })}
      </div>

      {error && (
        <p
          role="alert"
          className="mt-6 flex items-center justify-center gap-2 text-center text-sm font-medium text-danger-strong"
        >
          {/* icon + role=alert so the failure isn't signalled by colour alone */}
          <span aria-hidden="true">⚠️</span>
          {error}
        </p>
      )}

      <p className="mt-10 text-center text-sm text-muted">
        تفضّل الدفع بفاتورة رسمية وتحويل بنكي؟{" "}
        <Link href="/invoice-request" className="font-semibold text-brand-amber hover:underline">
          اطلب فاتورة
        </Link>
      </p>
    </main>
  );
}

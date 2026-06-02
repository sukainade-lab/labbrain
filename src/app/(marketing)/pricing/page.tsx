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
      <h1 className="text-center text-3xl font-bold text-amber-500">الأسعار</h1>
      <p className="mt-3 text-center text-slate-300">
        ادفع بالدينار الأردني. ألغِ في أي وقت.
      </p>

      {/* Billing-interval toggle */}
      <div
        className="mt-8 flex items-center justify-center gap-1 rounded-full border border-slate-700 bg-slate-900/40 p-1 mx-auto w-fit"
        role="group"
        aria-label="دورة الفوترة"
      >
        <button
          type="button"
          onClick={() => setInterval("month")}
          aria-pressed={interval === "month"}
          className={`min-h-[44px] rounded-full px-5 text-sm font-medium transition ${
            interval === "month"
              ? "bg-brand-amber text-white"
              : "text-slate-300 hover:text-white"
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
              ? "bg-brand-amber text-white"
              : "text-slate-300 hover:text-white"
          }`}
        >
          سنوي
          <span className="ms-2 rounded-full bg-emerald-600/20 px-2 py-0.5 text-xs text-emerald-300">
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
              className={`rounded-2xl border bg-slate-900/40 p-8 ${
                resumed
                  ? "border-amber-500 ring-2 ring-amber-500/50"
                  : plan.highlight
                    ? "border-amber-500"
                    : "border-slate-700"
              }`}
            >
              <h2 className="text-xl font-semibold text-slate-100">{plan.nameAr}</h2>

              <p className="mt-4 text-3xl font-bold text-amber-500">
                <bdi>{perMonth}</bdi>{" "}
                <span className="text-base font-normal text-slate-400">
                  <Jod /> / شهرياً
                </span>
              </p>

              {interval === "year" ? (
                <p className="mt-1 text-sm text-slate-400">
                  تُدفع سنوياً: <bdi>{yearTotal}</bdi> <Jod /> / سنة
                </p>
              ) : (
                <p className="mt-1 text-sm text-slate-500">أو وفّر {DISCOUNT_PCT}% بالاشتراك السنوي</p>
              )}

              <ul className="mt-6 space-y-2 text-slate-300">
                {plan.featuresAr.map((f) => (
                  <li key={f}>• {f}</li>
                ))}
              </ul>

              <button
                type="button"
                onClick={() => onChoosePlan(plan.id)}
                disabled={cta.disabled}
                aria-busy={cta.busy}
                className="mt-8 block w-full min-h-[44px] rounded-lg bg-brand-amber px-6 py-3 text-center font-medium text-white hover:bg-brand-amber-hover disabled:opacity-60"
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
          className="mt-6 flex items-center justify-center gap-2 text-center text-sm text-red-400"
        >
          {/* icon + role=alert so the failure isn't signalled by colour alone */}
          <span aria-hidden="true">⚠️</span>
          {error}
        </p>
      )}

      <p className="mt-10 text-center text-sm text-slate-400">
        تفضّل الدفع بفاتورة رسمية وتحويل بنكي؟{" "}
        <Link href="/invoice-request" className="text-amber-500 hover:underline">
          اطلب فاتورة
        </Link>
      </p>
    </main>
  );
}

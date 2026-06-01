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

// AC-4.1 — pricing page: Starter 35 / Pro 70 JOD, monthly⇄annual toggle (annual −25%).
// Plan/cap data comes from lib/pricing/plans (single source of truth).
const DISCOUNT_PCT = Math.round(ANNUAL_DISCOUNT * 100);

function Jod() {
  // English currency code stays LTR-isolated inside the Arabic line.
  return <bdi>JOD</bdi>;
}

export default function PricingPage() {
  const [interval, setInterval] = useState<Interval>("month");

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
              ? "bg-amber-600 text-white"
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
              ? "bg-amber-600 text-white"
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
          return (
            <div
              key={plan.id}
              className={`rounded-2xl border bg-slate-900/40 p-8 ${
                plan.highlight ? "border-amber-500" : "border-slate-700"
              }`}
            >
              <h2 className="text-xl font-semibold text-slate-100">{plan.nameAr}</h2>

              <p className="mt-4 text-3xl font-bold text-amber-500">
                {perMonth}{" "}
                <span className="text-base font-normal text-slate-400">
                  <Jod /> / شهرياً
                </span>
              </p>

              {interval === "year" ? (
                <p className="mt-1 text-sm text-slate-400">
                  تُدفع سنوياً: {yearTotal} <Jod /> / سنة
                </p>
              ) : (
                <p className="mt-1 text-sm text-slate-500">أو وفّر {DISCOUNT_PCT}% بالاشتراك السنوي</p>
              )}

              <ul className="mt-6 space-y-2 text-slate-300">
                {plan.featuresAr.map((f) => (
                  <li key={f}>• {f}</li>
                ))}
              </ul>

              <Link
                href={`/signup?plan=${plan.id}&interval=${interval}`}
                className="mt-8 block min-h-[44px] rounded-lg bg-amber-600 px-6 py-3 text-center font-medium text-white hover:bg-amber-500"
              >
                ابدأ الآن
              </Link>
            </div>
          );
        })}
      </div>

      <p className="mt-10 text-center text-sm text-slate-400">
        تفضّل الدفع بفاتورة رسمية وتحويل بنكي؟{" "}
        <Link href="/invoice-request" className="text-amber-500 hover:underline">
          اطلب فاتورة
        </Link>
      </p>
    </main>
  );
}

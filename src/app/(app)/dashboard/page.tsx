"use client";

import { useCallback, useEffect, useState } from "react";

// AC-4.5 — dashboard usage counters: documents uploaded (X / plan limit), active
// users (X / plan limit), questions asked this month. Fetches /api/dashboard
// (auth-gated, tenant-scoped). RTL-first, brand tokens, matches the documents
// usage-line style.

interface DashboardStats {
  plan: string;
  documents: { count: number; limit: number };
  users: { count: number; limit: number };
  questionsThisMonth: number;
}

const PLAN_LABEL: Record<string, string> = { starter: "Starter", pro: "Pro" };

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch("/api/dashboard");
      if (!res.ok) {
        setError(true);
        return;
      }
      setStats(await res.json());
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      if (active) await load();
    })();
    return () => {
      active = false;
    };
  }, [load]);

  // "X / limit" for the capped counters; the questions counter is uncapped.
  // Numerals + the "/" separator are <bdi>-isolated so they don't reorder in the
  // RTL line. Each KPI gets a distinct accent stripe (bright amber is accent-only,
  // never behind text — the value itself renders in navy per the reference).
  const cards = stats
    ? [
        {
          label: "الوثائق",
          value: `${stats.documents.count} / ${stats.documents.limit}`,
          accent: "bg-amber-bright"
        },
        {
          label: "المستخدمون",
          value: `${stats.users.count} / ${stats.users.limit}`,
          accent: "bg-info"
        },
        {
          label: "الاستعلامات هذا الشهر",
          value: String(stats.questionsThisMonth),
          accent: "bg-success"
        }
      ]
    : [
        { label: "الوثائق", value: "—", accent: "bg-amber-bright" },
        { label: "المستخدمون", value: "—", accent: "bg-info" },
        { label: "الاستعلامات هذا الشهر", value: "—", accent: "bg-success" }
      ];

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-navy">لوحة التحكم</h1>
        {stats && (
          <span className="rounded-full bg-info-soft px-3 py-1 text-xs font-semibold text-navy">
            خطة <bdi>{PLAN_LABEL[stats.plan] ?? stats.plan}</bdi>
          </span>
        )}
      </div>

      {error ? (
        <div
          role="alert"
          className="mt-8 rounded-card border border-danger-soft bg-danger-soft p-6 text-center"
        >
          {/* icon + role=alert so the failure isn't signalled by colour alone */}
          <p className="text-sm font-medium text-danger-strong">
            <span aria-hidden="true">⚠️ </span>تعذّر تحميل الإحصائيات.
          </p>
          <button
            type="button"
            onClick={load}
            className="mt-3 min-h-[44px] rounded-control border border-danger-strong bg-card px-5 text-sm font-semibold text-danger-strong transition-colors hover:bg-danger-strong hover:text-white"
          >
            إعادة المحاولة
          </button>
        </div>
      ) : (
        <div className="mt-8 grid gap-4 sm:grid-cols-3" aria-busy={loading}>
          {cards.map((s) => (
            <div
              key={s.label}
              className="group relative overflow-hidden rounded-card border border-line bg-card p-6 shadow-soft transition-all duration-200 hover:-translate-y-[3px] hover:shadow-lift"
            >
              <span
                aria-hidden="true"
                className={`absolute inset-y-0 start-0 w-1.5 ${s.accent}`}
              />
              <div className="text-sm font-medium text-muted">{s.label}</div>
              <div className="mt-2 text-4xl font-bold tracking-tight text-navy">
                {loading ? "…" : <bdi>{s.value}</bdi>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

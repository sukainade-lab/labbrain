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
  // RTL line.
  const cards = stats
    ? [
        { label: "الوثائق", value: `${stats.documents.count} / ${stats.documents.limit}` },
        { label: "المستخدمون", value: `${stats.users.count} / ${stats.users.limit}` },
        { label: "الاستعلامات هذا الشهر", value: String(stats.questionsThisMonth) }
      ]
    : [
        { label: "الوثائق", value: "—" },
        { label: "المستخدمون", value: "—" },
        { label: "الاستعلامات هذا الشهر", value: "—" }
      ];

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-100">لوحة التحكم</h1>
        {stats && (
          <span className="rounded-full bg-[#1e3a5f] px-3 py-1 text-xs font-medium text-[#93c5fd]">
            خطة <bdi>{PLAN_LABEL[stats.plan] ?? stats.plan}</bdi>
          </span>
        )}
      </div>

      {error ? (
        <div
          role="alert"
          className="mt-8 rounded-xl border border-red-900/60 bg-red-950/30 p-6 text-center"
        >
          <p className="text-sm text-red-300">تعذّر تحميل الإحصائيات.</p>
          <button
            type="button"
            onClick={load}
            className="mt-3 min-h-[44px] rounded-lg border border-red-800 px-5 text-sm font-medium text-red-200 hover:bg-red-900/30"
          >
            إعادة المحاولة
          </button>
        </div>
      ) : (
        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          {cards.map((s) => (
            <div
              key={s.label}
              className="rounded-xl border border-slate-700 bg-slate-900/40 p-6"
            >
              <div className="text-sm text-slate-400">{s.label}</div>
              <div className="mt-2 text-3xl font-bold text-amber-500">
                {loading ? "…" : <bdi>{s.value}</bdi>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

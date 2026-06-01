"use client";

import { useEffect, useState } from "react";

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

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/dashboard");
        const data = await res.json();
        if (active && res.ok) setStats(data);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // "X / limit" for the capped counters; the questions counter is uncapped.
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
            خطة {PLAN_LABEL[stats.plan] ?? stats.plan}
          </span>
        )}
      </div>
      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        {cards.map((s) => (
          <div
            key={s.label}
            className="rounded-xl border border-slate-700 bg-slate-900/40 p-6"
          >
            <div className="text-sm text-slate-400">{s.label}</div>
            <div className="mt-2 text-3xl font-bold text-amber-500">
              {loading ? "…" : s.value}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

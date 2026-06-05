"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { PlatformStats, TenantOverviewRow } from "@/lib/founder/stats";
import type { InferenceModeView } from "@/lib/ai/inference-mode";
import { getPlan } from "@/lib/pricing/plans";
import { migrationControl, regionLabel } from "@/lib/migration/view";
import { InferenceModeBadge } from "@/components/ops/inference-mode-badge";

// AC-8.2 / AC-8.3 / AC-8.4 / AC-8.5 — the founder panel UI. Receives the
// already-fetched cross-tenant overview from the server page (one round-trip) and
// renders: four metric cards, a tenants table, and the pending-invoice queue. The
// three action buttons (pause / unpause / mark-paid) POST to the founder API
// routes, then router.refresh() re-runs the server component for fresh data.
//
// RTL-first. Per lesson L5, every dynamic mixed-script value (lab names that may
// be English, owner emails, JOD figures, counts, plan labels, dates) is wrapped in
// <bdi> so the bidi algorithm can't reorder it inside the Arabic layout.

const PLAN_LABEL: Record<string, string> = { starter: "Starter", pro: "Pro" };

const STATUS_STYLE: Record<string, { label: string; cls: string }> = {
  active: { label: "نشط", cls: "bg-success-soft text-success-strong" },
  inactive: { label: "غير مفعّل", cls: "bg-amber-soft text-brand-amber-hover" },
  past_due: { label: "متأخر الدفع", cls: "bg-amber-soft text-brand-amber-hover" },
  paused: { label: "موقوف", cls: "bg-danger-soft text-danger-strong" }
};

// DD/MM/YYYY (MENA rule). Falls back to the raw value if unparseable.
function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getUTCFullYear()}`;
}

function StatusPill({ status }: { status: string }) {
  const s = STATUS_STYLE[status] ?? STATUS_STYLE.active;
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${s.cls}`}>{s.label}</span>
  );
}

export function FounderPanel({
  rows,
  stats,
  founderEmail,
  inferenceView
}: {
  rows: TenantOverviewRow[];
  stats: PlatformStats;
  founderEmail: string;
  inferenceView: InferenceModeView;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"tenants" | "invoices" | "migration">("tenants");
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pendingRows = rows.filter((r) => r.status === "inactive");

  async function run(action: "pause" | "unpause" | "activate", tenantId: string) {
    setError(null);
    setBusyId(tenantId);
    try {
      const res = await fetch(`/api/founder/tenants/${tenantId}/${action}`, { method: "POST" });
      if (!res.ok) {
        setError("تعذّر تنفيذ العملية. حاول مرة أخرى.");
        return;
      }
      // Re-run the server component so the cards + table reflect the new state.
      startTransition(() => router.refresh());
    } catch {
      setError("تعذّر الاتصال بالخادم.");
    } finally {
      setBusyId(null);
    }
  }

  // S10 — the migration control (AC-10.1 reachable entry point). 'migrate' runs
  // export→import→verify (does NOT cut over); 'cutover' is the distinct, confirmed
  // residency flip for a verified run. A 422 means parity failed — the source stays
  // authoritative and the message tells the founder verification was refused.
  async function runMigration(action: "migrate" | "cutover", tenantId: string) {
    setError(null);
    setBusyId(tenantId);
    try {
      const path =
        action === "cutover"
          ? `/api/founder/tenants/${tenantId}/migrate/cutover`
          : `/api/founder/tenants/${tenantId}/migrate`;
      const res = await fetch(path, { method: "POST" });
      if (!res.ok) {
        setError(
          res.status === 422
            ? "فشل التحقق من تطابق البيانات — لم يُنفَّذ التحويل، والمصدر يبقى المرجع."
            : "تعذّر تنفيذ عملية النقل. حاول مرة أخرى."
        );
        return;
      }
      startTransition(() => router.refresh());
    } catch {
      setError("تعذّر الاتصال بالخادم.");
    } finally {
      setBusyId(null);
    }
  }

  const cards = [
    { label: "المختبرات النشطة", value: String(stats.activeTenants), accent: "text-brand-amber" },
    { label: "الإيراد الشهري (JOD)", value: `${stats.mrrJod} د.أ`, accent: "text-success-strong" },
    {
      label: "فواتير بانتظار التفعيل",
      value: String(stats.pendingInvoices),
      accent: stats.pendingInvoices > 0 ? "text-brand-amber" : "text-success-strong"
    },
    { label: "أسئلة هذا الشهر", value: String(stats.questionsThisMonth), accent: "text-navy" }
  ];

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <header className="flex items-center justify-between border-b border-line bg-gradient-to-l from-navy via-navy2 to-navy3 px-6 py-3.5 shadow-soft">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-control bg-amber-bright text-sm font-bold text-navy">
            LB
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-[15px] font-bold text-white">LabBrain</span>
            <span className="text-xs text-slate-300">لوحة المؤسس</span>
          </div>
        </div>
        <div className="text-xs text-slate-300">
          <bdi>{founderEmail}</bdi>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-5 py-6">
        {error && (
          <div
            role="alert"
            className="mb-5 rounded-control border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-medium text-danger-strong"
          >
            <span aria-hidden="true">⚠️ </span>
            {error}
          </div>
        )}

        {/* Metric cards (AC-8.2) */}
        <div className="mb-7 grid grid-cols-2 gap-3 lg:grid-cols-4" aria-busy={pending}>
          {cards.map((c) => (
            <div key={c.label} className="rounded-card border border-line bg-card p-4 shadow-soft transition-all hover:shadow-lift">
              <div className="mb-1.5 text-[11px] text-muted">{c.label}</div>
              <div className={`text-2xl font-extrabold tracking-tight ${c.accent}`}>
                <bdi>{c.value}</bdi>
              </div>
            </div>
          ))}
        </div>

        {/* Inference-mode indicator (AC-11.8) */}
        <div className="mb-7">
          <InferenceModeBadge view={inferenceView} />
        </div>

        {/* Tabs */}
        <div className="mb-5 flex gap-2">
          {(
            [
              { id: "tenants", label: "المختبرات" },
              {
                id: "invoices",
                label: `الفواتير المعلقة${pendingRows.length > 0 ? ` (${pendingRows.length})` : ""}`
              },
              { id: "migration", label: "النقل والامتثال (KSA)" }
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              aria-pressed={tab === t.id}
              className={`min-h-[44px] rounded-control px-4 text-sm font-medium transition-colors ${
                tab === t.id
                  ? "bg-brand-amber text-white shadow-soft"
                  : "border border-line bg-card text-muted hover:text-navy"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Tenants table (AC-8.3) */}
        {tab === "tenants" &&
          (rows.length === 0 ? (
            <EmptyCard text="لا توجد مختبرات بعد." />
          ) : (
            <div className="overflow-x-auto rounded-card border border-line bg-card shadow-soft">
              <table className="w-full border-collapse text-right">
                <thead>
                  <tr className="border-b border-line bg-canvas">
                    {["المختبر", "الخطة", "الحالة", "المستخدمون", "الوثائق", "الأسئلة", ""].map(
                      (h) => (
                        <th
                          key={h}
                          className="px-3.5 py-2.5 text-[11px] font-semibold text-muted"
                        >
                          {h}
                        </th>
                      )
                    )}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const plan = getPlan(r.plan);
                    return (
                      <tr key={r.tenant_id} className="border-b border-line last:border-0">
                        <td className="px-3.5 py-3">
                          <div className="text-[13px] font-semibold text-ink">
                            <bdi>{r.name}</bdi>
                          </div>
                          <div className="text-[11px] text-muted">
                            <bdi>{r.owner_email ?? "—"}</bdi>
                          </div>
                        </td>
                        <td className="px-3.5 py-3">
                          <span className="rounded-full bg-info-soft px-2.5 py-0.5 text-[11px] font-semibold text-navy">
                            <bdi>{PLAN_LABEL[r.plan] ?? r.plan}</bdi>
                          </span>
                        </td>
                        <td className="px-3.5 py-3">
                          <StatusPill status={r.status} />
                        </td>
                        <td className="px-3.5 py-3 text-[13px] text-muted">
                          <bdi>
                            {r.user_count}/{plan.seatLimit}
                          </bdi>
                        </td>
                        <td className="px-3.5 py-3 text-[13px] text-muted">
                          <bdi>
                            {r.doc_count}/{plan.docLimit}
                          </bdi>
                        </td>
                        <td className="px-3.5 py-3 text-[13px] text-muted">
                          <bdi>{r.questions_this_month}</bdi>
                        </td>
                        <td className="px-3.5 py-3">
                          <div className="flex justify-end gap-1.5">
                            {r.status === "inactive" && (
                              <ActionButton
                                onClick={() => run("activate", r.tenant_id)}
                                disabled={busyId === r.tenant_id}
                                className="bg-success-soft text-success-strong hover:bg-success/20"
                              >
                                تفعيل
                              </ActionButton>
                            )}
                            {r.status === "paused" ? (
                              <ActionButton
                                onClick={() => run("unpause", r.tenant_id)}
                                disabled={busyId === r.tenant_id}
                                className="bg-success-soft text-success-strong hover:bg-success/20"
                              >
                                إعادة تفعيل
                              </ActionButton>
                            ) : (
                              <ActionButton
                                onClick={() => run("pause", r.tenant_id)}
                                disabled={busyId === r.tenant_id}
                                className="bg-danger-soft text-danger-strong hover:bg-danger/20"
                              >
                                إيقاف
                              </ActionButton>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}

        {/* Invoice queue (AC-8.5) */}
        {tab === "invoices" &&
          (pendingRows.length === 0 ? (
            <EmptyCard text="لا توجد فواتير معلقة ✅" />
          ) : (
            <div className="flex flex-col gap-2.5">
              {pendingRows.map((r) => (
                <div
                  key={r.tenant_id}
                  className="flex flex-col gap-3 rounded-card border border-brand-amber bg-card p-4 shadow-soft sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <div className="text-[15px] font-bold text-navy">
                      <bdi>{r.name}</bdi>
                    </div>
                    <div className="mt-1 text-xs text-muted">
                      <bdi>{r.owner_email ?? "—"}</bdi> ·{" "}
                      <bdi>
                        {PLAN_LABEL[r.plan] ?? r.plan} — {getPlan(r.plan).monthly} د.أ
                      </bdi>{" "}
                      · انضمّ <bdi>{formatDate(r.created_at)}</bdi>
                    </div>
                  </div>
                  <ActionButton
                    onClick={() => run("activate", r.tenant_id)}
                    disabled={busyId === r.tenant_id}
                    className="min-h-[44px] bg-brand-amber px-5 text-[13px] font-bold text-white shadow-soft hover:bg-brand-amber-hover hover:shadow-lift"
                  >
                    تفعيل الحساب ✓
                  </ActionButton>
                </div>
              ))}
            </div>
          ))}

        {/* Migration & residency (S10 · AC-10.1 reachable entry point) */}
        {tab === "migration" &&
          (rows.length === 0 ? (
            <EmptyCard text="لا توجد مختبرات بعد." />
          ) : (
            <div className="flex flex-col gap-2.5">
              <p className="mb-1 text-xs text-muted">
                نقل بيانات المختبر من الاتحاد الأوروبي (فرانكفورت) إلى السعودية
                (me-central-1) للامتثال لـ PDPL. النقل يتحقق من تطابق البيانات قبل
                التحويل النهائي ولا يحذف المصدر.
              </p>
              {rows.map((r) => {
                const ctrl = migrationControl(r.data_region, r.migration_status);
                return (
                  <div
                    key={r.tenant_id}
                    className="flex flex-col gap-3 rounded-card border border-line bg-card p-4 shadow-soft sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div>
                      <div className="text-[15px] font-bold text-navy">
                        <bdi>{r.name}</bdi>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                        <span>المنطقة:</span>
                        <bdi className="font-semibold text-ink">
                          {regionLabel(r.data_region)}
                        </bdi>
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${ctrl.statusClass}`}
                        >
                          <bdi>{ctrl.statusLabel}</bdi>
                        </span>
                      </div>
                    </div>
                    {ctrl.cta ? (
                      <ActionButton
                        onClick={() => runMigration(ctrl.cta!.action, r.tenant_id)}
                        disabled={busyId === r.tenant_id}
                        className={`min-h-[44px] px-5 text-[13px] font-bold text-white shadow-soft hover:shadow-lift ${
                          ctrl.cta.action === "cutover"
                            ? "bg-navy hover:bg-navy2"
                            : "bg-brand-amber hover:bg-brand-amber-hover"
                        }`}
                      >
                        <bdi>{ctrl.cta.label}</bdi>
                      </ActionButton>
                    ) : (
                      <span className="text-xs text-muted">
                        {ctrl.kind === "done" ? "مكتمل" : "جارٍ التنفيذ"}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
      </div>
    </div>
  );
}

function ActionButton({
  onClick,
  disabled,
  className,
  children
}: {
  onClick: () => void;
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`min-h-[44px] rounded-md px-3 text-[11px] font-semibold disabled:opacity-50 ${className ?? ""}`}
    >
      {disabled ? "…" : children}
    </button>
  );
}

function EmptyCard({ text }: { text: string }) {
  return (
    <div className="rounded-card border border-line bg-card p-8 text-center text-sm text-muted shadow-soft">
      {text}
    </div>
  );
}

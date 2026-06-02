import type { MigrationStatus } from "./state";

// S10 — pure presentation logic for the founder-panel migration control (L4). The
// panel is a thin RTL shell over this decision table; keeping it pure makes the two
// safety rules checkable without React: cutover is offered ONLY from 'verified'
// (verify-before-cutover, AC-10.4) and NEVER once cut over or already resident in
// the KSA region (no double-cutover, AC-10.6).

const KSA_REGION = "ksa-me-central-1";

const REGION_LABEL: Record<string, string> = {
  "eu-frankfurt": "أوروبا · فرانكفورت",
  "ksa-me-central-1": "السعودية · me-central-1"
};

export function regionLabel(region: string): string {
  return REGION_LABEL[region] ?? region;
}

export type MigrationControlKind = "migrate" | "cutover" | "running" | "done";

export interface MigrationControlView {
  kind: MigrationControlKind;
  statusLabel: string;
  statusClass: string;
  cta: { action: "migrate" | "cutover"; label: string } | null;
}

const RUNNING_STATES: MigrationStatus[] = ["pending", "exported", "imported"];

// The decision table. Order matters: a tenant already in KSA (or a record at
// 'cutover') is terminal regardless of any stale status, so that's checked first.
export function migrationControl(
  dataRegion: string,
  status: MigrationStatus | null
): MigrationControlView {
  if (dataRegion === KSA_REGION || status === "cutover") {
    return {
      kind: "done",
      statusLabel: "مكتمل ✓",
      statusClass: "bg-emerald-950 text-emerald-300",
      cta: null
    };
  }

  if (status === "verified") {
    return {
      kind: "cutover",
      statusLabel: "تم التحقق",
      statusClass: "bg-indigo-950 text-indigo-300",
      cta: { action: "cutover", label: "تنفيذ التحويل النهائي" }
    };
  }

  if (status && RUNNING_STATES.includes(status)) {
    return {
      kind: "running",
      statusLabel: "جارٍ التنفيذ…",
      statusClass: "bg-amber-950 text-amber-300",
      cta: null
    };
  }

  // null (never run) or 'failed' (verify mismatch) → the source stays
  // authoritative; offer a (re-)migrate. A failed run is non-destructive and safe
  // to retry (import is idempotent).
  return {
    kind: "migrate",
    statusLabel: status === "failed" ? "فشل التحقق" : "لم يبدأ",
    statusClass:
      status === "failed" ? "bg-red-950 text-red-300" : "bg-slate-800 text-slate-400",
    cta: { action: "migrate", label: status === "failed" ? "إعادة المحاولة" : "بدء النقل" }
  };
}

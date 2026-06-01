import type { createAdminClient } from "@/lib/supabase/admin";
import { getDocPlanLimit, countDocuments } from "@/lib/documents/limits";
import { getPlanLimit, countSeats } from "@/lib/auth/seats";

type Admin = ReturnType<typeof createAdminClient>;

// AC-4.5 — the three dashboard usage counters: documents uploaded (X / plan
// limit), active users (X / plan limit), and questions asked this month.
export interface DashboardStats {
  plan: string;
  documents: { count: number; limit: number };
  users: { count: number; limit: number };
  questionsThisMonth: number;
}

// Start of the current calendar month (UTC) as an ISO string — the lower bound
// for "questions this month". Pure so the boundary math is unit-tested directly.
export function monthStartISO(now: Date = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

// Count queries logged for this tenant since the start of the current month.
export async function countQueriesThisMonth(
  admin: Admin,
  tenantId: string,
  now: Date = new Date()
): Promise<number> {
  const { count } = await admin
    .from("queries")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .gte("created_at", monthStartISO(now));
  return count ?? 0;
}

// Aggregate the dashboard counters. Reuses the same plan-limit + count helpers
// the upload/seat gates use, so the runway shown here can never drift from the
// caps actually enforced. Counts run concurrently — they're independent reads.
export async function getDashboardStats(admin: Admin, tenantId: string): Promise<DashboardStats> {
  const [docPlan, seatPlan, docCount, seatCount, questionsThisMonth] = await Promise.all([
    getDocPlanLimit(admin, tenantId),
    getPlanLimit(admin, tenantId),
    countDocuments(admin, tenantId),
    countSeats(admin, tenantId, { includePending: false }),
    countQueriesThisMonth(admin, tenantId)
  ]);
  return {
    plan: docPlan.plan,
    documents: { count: docCount, limit: docPlan.limit },
    users: { count: seatCount, limit: seatPlan.limit },
    questionsThisMonth
  };
}

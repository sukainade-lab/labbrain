import type { createAdminClient } from "@/lib/supabase/admin";
import { getPlan, monthlyEquivalent, type Interval, type PlanId } from "@/lib/pricing/plans";
import type { MigrationStatus } from "@/lib/migration/state";

type Admin = ReturnType<typeof createAdminClient>;

// AC-8.2 / AC-8.3 — the founder cross-tenant overview. One row per tenant from
// the founder_tenant_overview RPC (migration 0010): identity + per-tenant usage
// aggregated server-side. The same rows feed BOTH the four metric cards
// (summarized below) and the tenants table — one round-trip, no N+1.
export interface TenantOverviewRow {
  tenant_id: string;
  name: string;
  plan: PlanId;
  status: string;
  created_at: string;
  owner_email: string | null;
  user_count: number;
  doc_count: number;
  questions_this_month: number;
  /** price_interval of the tenant's active subscription, if any (else monthly). */
  active_interval: Interval | null;
  /** Live residency pointer (S10): 'eu-frankfurt' | 'ksa-me-central-1'. */
  data_region: string;
  /** Status of the tenant's most-recent migration run, or null if none (S10). */
  migration_status: MigrationStatus | null;
}

export interface PlatformStats {
  activeTenants: number;
  /** Monthly recurring revenue, JOD. */
  mrrJod: number;
  /** Labs registered but not yet activated — the bank-transfer/invoice queue. */
  pendingInvoices: number;
  questionsThisMonth: number;
}

// Pure — MRR in JOD across the active tenants. Annual subscriptions contribute
// their discounted monthly-equivalent (not the annual total), so the figure is a
// true monthly run-rate. JOD rounds to 2 decimals to avoid float dust.
export function computeMrrJod(rows: TenantOverviewRow[]): number {
  const total = rows
    .filter((r) => r.status === "active")
    .reduce((sum, r) => sum + monthlyEquivalent(getPlan(r.plan), r.active_interval ?? "month"), 0);
  return Math.round(total * 100) / 100;
}

// Pure — reduce the overview rows to the four card metrics. "Pending invoices"
// are tenants still 'inactive' (registered, awaiting their first manual/bank
// activation — the BRD's primary buying path); 'paused' is a separate state and
// is NOT counted as pending.
export function summarizeOverview(rows: TenantOverviewRow[]): PlatformStats {
  return {
    activeTenants: rows.filter((r) => r.status === "active").length,
    mrrJod: computeMrrJod(rows),
    pendingInvoices: rows.filter((r) => r.status === "inactive").length,
    questionsThisMonth: rows.reduce((sum, r) => sum + (r.questions_this_month ?? 0), 0)
  };
}

// DB — fetch the cross-tenant overview via the service-role RPC (0010). Caller
// MUST already be behind the PLATFORM_ADMIN_EMAILS gate: this bypasses RLS.
export async function getTenantOverview(admin: Admin): Promise<TenantOverviewRow[]> {
  const { data, error } = await admin.rpc("founder_tenant_overview");
  if (error) throw error;
  return (data ?? []) as TenantOverviewRow[];
}

export async function getPlatformStats(admin: Admin): Promise<PlatformStats> {
  return summarizeOverview(await getTenantOverview(admin));
}

import type { createAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createAdminClient>;

// Document caps per plan tier (AC-2.6). Mirrors lib/auth/seats.ts.
export const PLAN_DOC_LIMITS = { starter: 50, pro: 200 } as const;
export type DocPlanTier = keyof typeof PLAN_DOC_LIMITS;

// Thrown when a tenant is at its document cap. The route maps this to HTTP 402
// (payment required) + the bilingual upgrade message (AC-2.6).
export class DocLimitError extends Error {
  constructor(
    public readonly plan: DocPlanTier,
    public readonly limit: number,
    public readonly used: number
  ) {
    super(`document cap reached: ${used}/${limit} on ${plan}`);
    this.name = "DocLimitError";
  }
}

export async function getDocPlanLimit(
  admin: Admin,
  tenantId: string
): Promise<{ plan: DocPlanTier; limit: number }> {
  const { data: tenant } = await admin
    .from("tenants")
    .select("plan")
    .eq("id", tenantId)
    .single();
  const plan = (tenant?.plan ?? "starter") as DocPlanTier;
  return { plan, limit: PLAN_DOC_LIMITS[plan] ?? PLAN_DOC_LIMITS.starter };
}

export async function countDocuments(admin: Admin, tenantId: string): Promise<number> {
  const { count } = await admin
    .from("documents")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId);
  return count ?? 0;
}

// Single gate every upload path calls before creating a document row (AC-2.6).
// Throws DocLimitError when the tenant is at or above its cap.
export async function assertDocAvailable(admin: Admin, tenantId: string): Promise<void> {
  const { plan, limit } = await getDocPlanLimit(admin, tenantId);
  const used = await countDocuments(admin, tenantId);
  if (used >= limit) {
    throw new DocLimitError(plan, limit, used);
  }
}

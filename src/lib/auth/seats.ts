import type { createAdminClient } from "@/lib/supabase/admin";
import { PLAN_SEAT_LIMITS } from "@/lib/validation/auth";

type Admin = ReturnType<typeof createAdminClient>;

// Single source of truth for seat accounting (AC-1.6). Two call sites need
// subtly different counts, so the difference is one explicit flag rather than
// two divergent implementations:
//   • invite *creation*  → includePending: true  (a pending invite holds a seat)
//   • invite *acceptance* → includePending: false (the invite being accepted is
//     about to become a real user, so counting it would double-count)
export async function getPlanLimit(
  admin: Admin,
  tenantId: string
): Promise<{ plan: string; limit: number }> {
  const { data: tenant } = await admin
    .from("tenants")
    .select("plan")
    .eq("id", tenantId)
    .single();
  const plan = (tenant?.plan ?? "starter") as keyof typeof PLAN_SEAT_LIMITS;
  return { plan, limit: PLAN_SEAT_LIMITS[plan] ?? PLAN_SEAT_LIMITS.starter };
}

export async function countSeats(
  admin: Admin,
  tenantId: string,
  opts: { includePending: boolean }
): Promise<number> {
  const { count: users } = await admin
    .from("users")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId);

  let pending = 0;
  if (opts.includePending) {
    const { count } = await admin
      .from("invitations")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .is("accepted_at", null);
    pending = count ?? 0;
  }
  return (users ?? 0) + pending;
}

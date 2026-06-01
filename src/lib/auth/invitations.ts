import { randomBytes } from "node:crypto";
import type { createAdminClient } from "@/lib/supabase/admin";
import { PLAN_SEAT_LIMITS } from "@/lib/validation/auth";
import { SignupError } from "@/lib/auth/provision";

type Admin = ReturnType<typeof createAdminClient>;

export type SeatUsage = { plan: string; limit: number; used: number; available: number };

// Seats consumed = active users + still-pending invitations (AC-1.6). A pending
// invite holds a seat so a tenant can't over-invite past its plan cap.
export async function getSeatUsage(admin: Admin, tenantId: string): Promise<SeatUsage> {
  const { data: tenant } = await admin
    .from("tenants")
    .select("plan")
    .eq("id", tenantId)
    .single();
  const plan = (tenant?.plan ?? "starter") as keyof typeof PLAN_SEAT_LIMITS;
  const limit = PLAN_SEAT_LIMITS[plan] ?? PLAN_SEAT_LIMITS.starter;

  const { count: userCount } = await admin
    .from("users")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId);
  const { count: pendingCount } = await admin
    .from("invitations")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .is("accepted_at", null);

  const used = (userCount ?? 0) + (pendingCount ?? 0);
  return { plan, limit, used, available: Math.max(0, limit - used) };
}

export type CreatedInvitation = { id: string; token: string; inviteUrl: string };

export async function createInvitation(
  admin: Admin,
  params: { tenantId: string; email: string; role?: "admin" | "member" }
): Promise<CreatedInvitation> {
  const usage = await getSeatUsage(admin, params.tenantId);
  if (usage.available <= 0) {
    throw new SignupError(
      "seat_limit",
      `بلغت الحد الأقصى للمستخدمين في خطة ${usage.plan} (${usage.limit}). الرجاء الترقية.`
    );
  }

  const token = randomBytes(24).toString("hex");
  const { data, error } = await admin
    .from("invitations")
    .insert({
      tenant_id: params.tenantId,
      email: params.email,
      role: params.role ?? "member",
      token
    })
    .select("id")
    .single();
  if (error || !data) throw new SignupError("unknown", "تعذّر إنشاء الدعوة");

  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  return { id: data.id, token, inviteUrl: `${appUrl}/signup?token=${token}` };
}

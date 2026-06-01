import { randomBytes } from "node:crypto";
import type { createAdminClient } from "@/lib/supabase/admin";
import { SignupError } from "@/lib/auth/provision";
import { countSeats, getPlanLimit } from "@/lib/auth/seats";

type Admin = ReturnType<typeof createAdminClient>;

export type SeatUsage = { plan: string; limit: number; used: number; available: number };

// Seats consumed = active users + still-pending invitations (AC-1.6). A pending
// invite holds a seat so a tenant can't over-invite past its plan cap.
export async function getSeatUsage(admin: Admin, tenantId: string): Promise<SeatUsage> {
  const { plan, limit } = await getPlanLimit(admin, tenantId);
  const used = await countSeats(admin, tenantId, { includePending: true });
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

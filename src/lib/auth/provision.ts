import { createClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { type SignupInput } from "@/lib/validation/auth";
import { countSeats, getPlanLimit } from "@/lib/auth/seats";

// Default post-confirmation destination (AC-1.2). The /auth/confirm route reads
// ?next and falls back here.
export const ONBOARDING_PATH = "/onboarding";

export class SignupError extends Error {
  code: "seat_limit" | "invalid_invite" | "duplicate" | "unknown";
  constructor(code: SignupError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

export type SignupResult = {
  userId: string;
  tenantId: string;
  role: "owner" | "admin" | "member";
};

// Provisions a new lab (or joins an invited user to an existing tenant).
//
// auth.signUp (anon client) creates the auth user and — when email confirmations
// are enabled — sends the 24h verification email with a redirect to /onboarding
// (AC-1.1/1.2). Tenant + users rows are written with the service role because no
// client RLS policy can INSERT a tenant (provisioning is server-side by design).
export async function provisionSignup(input: SignupInput): Promise<SignupResult> {
  const admin = createAdminClient();
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const anon = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  // Resolve target tenant + role before creating the auth user, so an invalid
  // invite or full seat count fails fast without leaving an orphan auth user.
  let tenantId: string;
  let role: SignupResult["role"];
  let invitationId: string | null = null;

  if (input.inviteToken) {
    const { data: invite } = await admin
      .from("invitations")
      .select("id, tenant_id, role, email, accepted_at")
      .eq("token", input.inviteToken)
      .maybeSingle();
    if (!invite || invite.accepted_at) {
      throw new SignupError("invalid_invite", "رابط الدعوة غير صالح أو مستخدم");
    }
    // Bind acceptance to the invited address — a leaked token can't be used to
    // join under a different email (defense in depth; tokens are single-use too).
    if (invite.email.toLowerCase() !== input.email.toLowerCase()) {
      throw new SignupError("invalid_invite", "هذه الدعوة لبريد إلكتروني مختلف");
    }
    await assertSeatAvailable(admin, invite.tenant_id);
    tenantId = invite.tenant_id;
    role = invite.role as SignupResult["role"];
    invitationId = invite.id;
  } else {
    const labName = input.labName?.trim();
    if (!labName || labName.length < 2) {
      throw new SignupError("unknown", "اسم المختبر مطلوب");
    }
    const { data: tenant, error: tErr } = await admin
      .from("tenants")
      .insert({ name: labName })
      .select("id")
      .single();
    if (tErr || !tenant) throw new SignupError("unknown", "تعذّر إنشاء المختبر");
    tenantId = tenant.id;
    role = "owner";
  }

  const { data: signUp, error: suErr } = await anon.auth.signUp({
    email: input.email,
    password: input.password,
    options: {
      emailRedirectTo: `${appUrl}/auth/confirm?next=${encodeURIComponent(ONBOARDING_PATH)}`,
      data: { lab_name: input.labName, full_name: input.adminName }
    }
  });
  if (suErr || !signUp.user) {
    // Roll back a freshly created tenant so a failed signup leaves no orphan.
    if (!input.inviteToken) await admin.from("tenants").delete().eq("id", tenantId);
    const duplicate = suErr?.message?.toLowerCase().includes("already");
    throw new SignupError(
      duplicate ? "duplicate" : "unknown",
      duplicate ? "هذا البريد مسجّل مسبقاً" : "تعذّر إنشاء الحساب"
    );
  }

  const userId = signUp.user.id;
  const { error: linkErr } = await admin
    .from("users")
    .insert({ id: userId, tenant_id: tenantId, email: input.email, role });
  if (linkErr) {
    if (!input.inviteToken) await admin.from("tenants").delete().eq("id", tenantId);
    throw new SignupError("unknown", "تعذّر ربط الحساب بالمختبر");
  }

  if (invitationId) {
    await admin
      .from("invitations")
      .update({ accepted_at: new Date().toISOString() })
      .eq("id", invitationId);
  }

  return { userId, tenantId, role };
}

// Throws SignupError("seat_limit") when the tenant is already at its plan cap.
// Counts real users only (not the pending invite being accepted, which is about
// to become one) — see the note on countSeats.
export async function assertSeatAvailable(
  admin: ReturnType<typeof createAdminClient>,
  tenantId: string
): Promise<void> {
  const { plan, limit } = await getPlanLimit(admin, tenantId);
  const used = await countSeats(admin, tenantId, { includePending: false });
  if (used >= limit) {
    throw new SignupError(
      "seat_limit",
      `بلغت الحد الأقصى للمستخدمين في خطة ${plan}. الرجاء الترقية.`
    );
  }
}

import { NextResponse } from "next/server";
import { inviteSchema } from "@/lib/validation/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createInvitation } from "@/lib/auth/invitations";
import { sendInvitationEmail } from "@/lib/email/resend";
import { SignupError } from "@/lib/auth/provision";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = inviteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" },
      { status: 400 }
    );
  }

  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });

  // Resolve the caller's tenant + role (RLS-scoped to their own tenant).
  const { data: me } = await supabase
    .from("users")
    .select("tenant_id, role")
    .eq("id", user.id)
    .single();
  if (!me || (me.role !== "owner" && me.role !== "admin")) {
    return NextResponse.json({ error: "صلاحيات غير كافية" }, { status: 403 });
  }

  try {
    const admin = createAdminClient();
    const invite = await createInvitation(admin, {
      tenantId: me.tenant_id,
      email: parsed.data.email,
      role: parsed.data.role
    });

    const { data: tenant } = await admin
      .from("tenants")
      .select("name")
      .eq("id", me.tenant_id)
      .single();
    try {
      await sendInvitationEmail(parsed.data.email, tenant?.name ?? "مختبرك", invite.inviteUrl);
    } catch {
      // Email delivery is best-effort; the invite row + token already exist.
    }

    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    if (err instanceof SignupError) {
      const status = err.code === "seat_limit" ? 402 : 400;
      return NextResponse.json({ error: err.message, code: err.code }, { status });
    }
    return NextResponse.json({ error: "تعذّر إرسال الدعوة" }, { status: 500 });
  }
}

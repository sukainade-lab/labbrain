import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logoMetaSchema, MAX_LOGO_BYTES, resolveLogoMime } from "@/lib/validation/branding";
import { uploadLogo, removeLogo } from "@/lib/branding/logo";
import { setSentryTenant } from "@/lib/observability/sentry";
import { captureError } from "@/lib/observability/log";

// Resolve the signed-in admin's tenant. Returns either a NextResponse (the error
// to send) or the admin context. Auth-gated + admin-only (AC-12.8): a member can
// see branding but cannot change it; the tenant is read from the session, never
// from the client.
type AdminResult =
  | { ok: false; response: NextResponse }
  | { ok: true; tenantId: string };

async function resolveAdmin(): Promise<AdminResult> {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, response: NextResponse.json({ error: "غير مصرّح" }, { status: 401 }) };
  }

  const { data: me } = await supabase
    .from("users")
    .select("tenant_id, role")
    .eq("id", user.id)
    .single();
  if (!me) {
    return { ok: false, response: NextResponse.json({ error: "غير مصرّح" }, { status: 401 }) };
  }
  if (me.role !== "owner" && me.role !== "admin") {
    return {
      ok: false,
      response: NextResponse.json({ error: "صلاحيات غير كافية" }, { status: 403 })
    };
  }
  return { ok: true, tenantId: me.tenant_id as string };
}

// POST /api/branding — multipart logo upload (AC-12.1/12.3). Admin-only.
export async function POST(req: Request): Promise<NextResponse> {
  const ctx = await resolveAdmin();
  if (!ctx.ok) return ctx.response;
  setSentryTenant(ctx.tenantId);

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof Blob) || !form) {
    return NextResponse.json({ error: "الملف مطلوب" }, { status: 400 });
  }
  const filename =
    (form.get("filename") as string | null)?.trim() ||
    ("name" in file ? (file as File).name : "");

  // 413 oversize is distinct from a 400 bad-shape error (AC-12.1).
  if (file.size > MAX_LOGO_BYTES) {
    return NextResponse.json({ error: "الحد الأقصى لحجم الشعار 512 كيلوبايت" }, { status: 413 });
  }

  const meta = logoMetaSchema.safeParse({
    mimeType: resolveLogoMime(filename, file.type) ?? file.type,
    sizeBytes: file.size
  });
  if (!meta.success) {
    return NextResponse.json(
      { error: meta.error.issues[0]?.message ?? "بيانات غير صالحة" },
      { status: 400 }
    );
  }

  try {
    const admin = createAdminClient();
    const { data: tenant } = await admin
      .from("tenants")
      .select("logo_path")
      .eq("id", ctx.tenantId)
      .single();

    const { url } = await uploadLogo({
      admin,
      tenantId: ctx.tenantId,
      file,
      mimeType: meta.data.mimeType,
      previousPath: tenant?.logo_path ?? null
    });

    return NextResponse.json({ url }, { status: 201 });
  } catch (err) {
    captureError("branding", err);
    return NextResponse.json({ error: "تعذّرت معالجة الشعار" }, { status: 500 });
  }
}

// DELETE /api/branding — remove the tenant's logo (AC-12.5). Admin-only.
export async function DELETE(): Promise<NextResponse> {
  const ctx = await resolveAdmin();
  if (!ctx.ok) return ctx.response;
  setSentryTenant(ctx.tenantId);

  try {
    const admin = createAdminClient();
    const { data: tenant } = await admin
      .from("tenants")
      .select("logo_path")
      .eq("id", ctx.tenantId)
      .single();

    if (tenant?.logo_path) {
      await removeLogo(admin, ctx.tenantId, tenant.logo_path);
    }
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    captureError("branding", err);
    return NextResponse.json({ error: "تعذّر حذف الشعار" }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServiceTabSchema, deleteServiceTabSchema } from "@/lib/validation/workspace";
import {
  listServiceTabs,
  createServiceTab,
  deleteServiceTab
} from "@/lib/workspace/service-tabs";
import { setSentryTenant } from "@/lib/observability/sentry";
import { captureError } from "@/lib/observability/log";

// Resolve the authenticated user's tenant from the session (NEVER client-supplied,
// L1/AC-2.9). Returns null → the route answers 401.
async function resolveTenant() {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: me } = await supabase
    .from("users")
    .select("tenant_id")
    .eq("id", user.id)
    .single();
  if (!me) return null;
  return { tenantId: me.tenant_id as string };
}

// GET /api/service-tabs — the tenant's New Service tabs (AC-2.1).
export async function GET() {
  const ctx = await resolveTenant();
  if (!ctx) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
  setSentryTenant(ctx.tenantId);
  try {
    const admin = createAdminClient();
    const tabs = await listServiceTabs(admin, ctx.tenantId);
    return NextResponse.json({ tabs });
  } catch (err) {
    captureError("service-tabs", err);
    return NextResponse.json({ error: "تعذّر جلب تبويبات الخدمات" }, { status: 500 });
  }
}

// POST /api/service-tabs — add a New Service tab (AC-2.1). Body: { name }.
export async function POST(req: Request) {
  const ctx = await resolveTenant();
  if (!ctx) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
  setSentryTenant(ctx.tenantId);

  const body = await req.json().catch(() => null);
  const parsed = createServiceTabSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" },
      { status: 400 }
    );
  }

  try {
    const admin = createAdminClient();
    const tab = await createServiceTab({
      admin,
      tenantId: ctx.tenantId,
      name: parsed.data.name
    });
    return NextResponse.json({ tab }, { status: 201 });
  } catch (err) {
    captureError("service-tabs", err);
    return NextResponse.json({ error: "تعذّر إنشاء التبويب" }, { status: 500 });
  }
}

// DELETE /api/service-tabs — remove a New Service tab + cascade its docs/chunks
// (AC-2.1). Body: { id }. 404 if the tab doesn't exist or isn't the tenant's.
export async function DELETE(req: Request) {
  const ctx = await resolveTenant();
  if (!ctx) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
  setSentryTenant(ctx.tenantId);

  const body = await req.json().catch(() => null);
  const parsed = deleteServiceTabSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" },
      { status: 400 }
    );
  }

  try {
    const admin = createAdminClient();
    const removed = await deleteServiceTab({
      admin,
      tenantId: ctx.tenantId,
      id: parsed.data.id
    });
    if (!removed) return NextResponse.json({ error: "التبويب غير موجود" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    captureError("service-tabs", err);
    return NextResponse.json({ error: "تعذّر حذف التبويب" }, { status: 500 });
  }
}

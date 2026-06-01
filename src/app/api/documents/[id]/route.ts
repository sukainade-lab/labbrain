import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { deleteDocument } from "@/lib/documents/ingest";

// DELETE /api/documents/[id] — removes the Storage object + cascades chunks (AC-2.5).
// Cross-tenant deletes return 403 (not 404) so the caller can't probe id existence
// blindly, while a truly-missing id returns 404.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });

  const { data: me } = await supabase
    .from("users")
    .select("tenant_id")
    .eq("id", user.id)
    .single();
  if (!me) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });

  const admin = createAdminClient();
  const { data: doc } = await admin
    .from("documents")
    .select("id, tenant_id, storage_path")
    .eq("id", id)
    .maybeSingle();

  if (!doc) return NextResponse.json({ error: "الوثيقة غير موجودة" }, { status: 404 });
  if (doc.tenant_id !== me.tenant_id) {
    return NextResponse.json({ error: "صلاحيات غير كافية" }, { status: 403 });
  }

  try {
    await deleteDocument(admin, doc.storage_path, doc.id);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "تعذّر حذف الوثيقة" }, { status: 500 });
  }
}

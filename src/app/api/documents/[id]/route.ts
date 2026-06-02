import { NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { deleteDocument, replaceDocument, processReplace } from "@/lib/documents/ingest";
import { uploadMetaSchema, MAX_UPLOAD_BYTES, resolveMime } from "@/lib/validation/documents";
import { track } from "@/lib/analytics/posthog-server";
import { documentUploaded } from "@/lib/analytics/events";
import { setSentryTenant } from "@/lib/observability/sentry";
import { captureError } from "@/lib/observability/log";

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

// PUT /api/documents/[id] — replace a document's file and re-index it, keeping the
// SAME document_id so the library row + its `?doc=ID` citation deep-link stay
// stable (AC-13.1/13.2/13.7). Same accepted formats/cap and same tenant-member
// gate as upload. Mirrors DELETE for the auth/ownership branches and POST for the
// multipart validation + async pipeline. Q&A history is untouched by construction
// (queries have no FK to documents; citations are frozen snapshots) — AC-13.4.
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
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
    .select("id, tenant_id, storage_path, version")
    .eq("id", id)
    .maybeSingle();

  if (!doc) return NextResponse.json({ error: "الوثيقة غير موجودة" }, { status: 404 });
  if (doc.tenant_id !== me.tenant_id) {
    return NextResponse.json({ error: "صلاحيات غير كافية" }, { status: 403 });
  }

  // AC-5.4 — attribute anything captured after this point to the right lab.
  setSentryTenant(me.tenant_id);

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof Blob) || !form) {
    return NextResponse.json({ error: "الملف مطلوب" }, { status: 400 });
  }
  const filename =
    (form.get("filename") as string | null)?.trim() ||
    ("name" in file ? (file as File).name : "");

  // 413 oversize is distinct from a 400 bad-shape error (AC-13.1).
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "الحد الأقصى لحجم الملف 50 ميغابايت" }, { status: 413 });
  }

  const meta = uploadMetaSchema.safeParse({
    filename,
    mimeType: resolveMime(filename, file.type) ?? file.type,
    sizeBytes: file.size
  });
  if (!meta.success) {
    return NextResponse.json(
      { error: meta.error.issues[0]?.message ?? "بيانات غير صالحة" },
      { status: 400 }
    );
  }

  try {
    // Synchronous half: stage the new bytes + flip to 'parsing'. The old chunks +
    // version stay intact until processReplace proves the new revision indexed.
    const { status } = await replaceDocument({
      admin,
      tenantId: me.tenant_id,
      documentId: doc.id,
      file,
      filename: meta.data.filename,
      mimeType: meta.data.mimeType,
      previousPath: doc.storage_path
    });

    // Parse → embed → atomic chunk swap → version bump, off the response path.
    after(() =>
      processReplace({
        admin,
        tenantId: me.tenant_id,
        documentId: doc.id,
        file,
        filename: meta.data.filename
      }).catch(() => {
        // processReplace already flipped the row to 'failed'; nothing to add.
      })
    );

    // AC-5.5 — PII-free event (mime_type only; filename omitted).
    void track(documentUploaded(user.id, { mimeType: meta.data.mimeType }));

    // Echo the current version; processReplace bumps it to version+1 on success.
    return NextResponse.json({ documentId: doc.id, status, version: doc.version });
  } catch (err) {
    captureError("documents", err);
    return NextResponse.json({ error: "تعذّرت معالجة الوثيقة" }, { status: 500 });
  }
}

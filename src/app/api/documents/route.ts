import { NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { uploadMetaSchema, MAX_UPLOAD_BYTES, resolveMime } from "@/lib/validation/documents";
import { createDocument, processDocument } from "@/lib/documents/ingest";
import { DocLimitError, getDocPlanLimit } from "@/lib/documents/limits";
import { track } from "@/lib/analytics/posthog-server";
import { documentUploaded } from "@/lib/analytics/events";
import { setSentryTenant } from "@/lib/observability/sentry";
import { captureError } from "@/lib/observability/log";

// POST /api/documents — multipart upload → store → (async) parse + index (AC-2.1…2.3, 2.6).
export async function POST(req: Request) {
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

  // 413 oversize is distinct from a 400 bad-shape error (AC-2.1).
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: "الحد الأقصى لحجم الملف 50 ميغابايت" },
      { status: 413 }
    );
  }

  // Browsers often mislabel DOCX/XLSX as octet-stream/"" — fall back to the
  // filename extension so valid Office files aren't wrongly rejected (AC-2.1).
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
    const admin = createAdminClient();
    // Synchronous half: cap check + store + create the 'parsing' row.
    const { documentId, status } = await createDocument({
      admin,
      tenantId: me.tenant_id,
      file,
      filename: meta.data.filename,
      mimeType: meta.data.mimeType
    });

    // Parse + index off the response path so a slow LlamaParse poll never holds
    // the connection open. The row is already 'parsing'; the UI polls to 'ready'.
    after(() =>
      processDocument({
        admin,
        tenantId: me.tenant_id,
        documentId,
        file,
        filename: meta.data.filename
      }).catch(() => {
        // processDocument already flipped the row to 'failed'; nothing to add.
      })
    );

    // AC-5.5 — PII-free upload event (mime_type only; filename omitted).
    void track(documentUploaded(user.id, { mimeType: meta.data.mimeType }));

    return NextResponse.json({ documentId, status }, { status: 201 });
  } catch (err) {
    if (err instanceof DocLimitError) {
      return NextResponse.json(
        {
          error: `وصلت إلى الحد الأقصى لعدد الوثائق في خطتك (${err.limit}). الرجاء الترقية لرفع المزيد.`,
          code: "doc_limit",
          plan: err.plan,
          limit: err.limit
        },
        { status: 402 }
      );
    }
    captureError("documents", err);
    return NextResponse.json({ error: "تعذّرت معالجة الوثيقة" }, { status: 500 });
  }
}

// GET /api/documents — the tenant's document list + plan/cap context (AC-2.5,
// AC-2.6). RLS scopes the rows; the cap line lets the UI show usage runway.
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });

  const { data, error } = await supabase
    .from("documents")
    .select("id, filename, status, page_count, created_at")
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: "تعذّر جلب الوثائق" }, { status: 500 });

  const documents = data ?? [];

  // Plan + cap for the usage line. RLS already scoped the list; resolve the
  // tenant's tier so the UI can render "X / 50 · الاستخدام Y%".
  const { data: me } = await supabase
    .from("users")
    .select("tenant_id")
    .eq("id", user.id)
    .single();
  let plan = "starter";
  let limit = 50;
  if (me) {
    const admin = createAdminClient();
    ({ plan, limit } = await getDocPlanLimit(admin, me.tenant_id));
  }

  return NextResponse.json({ documents, count: documents.length, plan, limit });
}

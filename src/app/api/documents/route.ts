import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { uploadMetaSchema, MAX_UPLOAD_BYTES, resolveMime } from "@/lib/validation/documents";
import { ingestDocument } from "@/lib/documents/ingest";
import { DocLimitError } from "@/lib/documents/limits";

// POST /api/documents — multipart upload → store → parse → index (AC-2.1…2.3, 2.6).
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
    const result = await ingestDocument({
      admin,
      tenantId: me.tenant_id,
      file,
      filename: meta.data.filename,
      mimeType: meta.data.mimeType
    });
    return NextResponse.json(result, { status: 201 });
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
    return NextResponse.json({ error: "تعذّرت معالجة الوثيقة" }, { status: 500 });
  }
}

// GET /api/documents — the tenant's document list (AC-2.5). RLS scopes the rows.
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

  return NextResponse.json({ documents: data ?? [] });
}

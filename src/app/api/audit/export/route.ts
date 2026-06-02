import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parseAuditRange, rangeLabel } from "@/lib/validation/audit";
import { getAuditLog } from "@/lib/audit/export-query";
import { buildAuditReportHtml } from "@/lib/audit/report-html";
import { renderPdfFromHtml } from "@/lib/audit/render-pdf";
import { buildAuditFilename } from "@/lib/audit/filename";
import { setSentryTenant } from "@/lib/observability/sentry";
import { captureError } from "@/lib/observability/log";

// GET /api/audit/export — download the lab's Q&A history as an audit-evidence
// PDF (AC-9.1…9.6). Owner/admin only; runs on the user-scoped client so RLS
// guarantees the export, and its log row, never cross tenant.
export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });

  const { data: me } = await supabase
    .from("users")
    .select("tenant_id, role, email")
    .eq("id", user.id)
    .single();
  if (!me) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });

  // AC-9.1 — audit evidence is privileged; least privilege = owner/admin only.
  if (me.role !== "owner" && me.role !== "admin") {
    return NextResponse.json({ error: "هذه الميزة لمالك المختبر أو المشرف فقط" }, { status: 403 });
  }

  // AC-9.3 — optional inclusive date range; reversed/malformed → 400.
  const { searchParams } = new URL(req.url);
  const parsed = parseAuditRange({
    from: searchParams.get("from"),
    to: searchParams.get("to")
  });
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.message }, { status: 400 });
  }
  const { range } = parsed;

  setSentryTenant(me.tenant_id);

  try {
    const { data: tenant } = await supabase
      .from("tenants")
      .select("name")
      .eq("id", me.tenant_id)
      .single();
    const labName = tenant?.name ?? "LabBrain";

    const entries = await getAuditLog(supabase, range);
    const now = new Date();

    const html = buildAuditReportHtml({
      labName,
      generatedAt: now,
      rangeLabel: rangeLabel(range),
      exportedBy: me.email,
      entries
    });
    const pdf = await renderPdfFromHtml(html);

    // AC-9.6 — record the export in-residency (who / which range / when).
    await supabase.from("audit_exports").insert({
      tenant_id: me.tenant_id,
      user_id: user.id,
      range_from: range.from,
      range_to: range.to,
      row_count: entries.length
    });

    const filename = buildAuditFilename(labName, me.tenant_id, now);
    return new NextResponse(pdf as BodyInit, {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "no-store"
      }
    });
  } catch (err) {
    captureError("audit-export", err);
    return NextResponse.json({ error: "تعذّر إنشاء ملف التصدير" }, { status: 500 });
  }
}

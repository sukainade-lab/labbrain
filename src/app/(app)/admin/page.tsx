import { InviteForm } from "@/components/admin/invite-form";
import { AuditExportForm } from "@/components/admin/audit-export-form";
import { InferenceModeBadge } from "@/components/ops/inference-mode-badge";
import { describeInferenceMode } from "@/lib/ai/inference-mode";
import { createClient } from "@/lib/supabase/server";

// AC-4.3 — admin shell: subscription status + activation state per tenant.
// AC-1.4 — team invitations (owner/admin only; enforced server-side).
// AC-9.5 — audit-log PDF export trigger, owner/admin only (gate mirrors the
// route's, so the control is only shown to a caller the route would accept).
export default async function AdminPage() {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  let role: string | null = null;
  if (user) {
    const { data: me } = await supabase
      .from("users")
      .select("role")
      .eq("id", user.id)
      .single();
    role = me?.role ?? null;
  }
  const canExportAudit = role === "owner" || role === "admin";

  // AC-11.8 — operator-visible inference-mode indicator, resolved server-side from
  // the deploy env via the display-safe descriptor (never throws).
  const inferenceView = describeInferenceMode();

  return (
    <div>
      <h1 className="text-2xl font-bold text-navy">الإدارة</h1>
      <p className="mt-2 text-muted">حالة الاشتراك والتفعيل.</p>

      <div className="mt-8">
        <InferenceModeBadge view={inferenceView} />
      </div>

      <section className="mt-8 rounded-card border border-line bg-card p-6 shadow-soft">
        <h2 className="text-lg font-bold text-navy">دعوة فريق المختبر</h2>
        <p className="mt-1 text-sm text-muted">
          أضف زملاءك في المختبر — يخضع العدد لحدود خطتك.
        </p>
        <InviteForm />
      </section>

      {canExportAudit && (
        <section className="mt-8 rounded-card border border-line bg-card p-6 shadow-soft">
          <h2 className="text-lg font-bold text-navy">سجل الأسئلة للتدقيق</h2>
          <p className="mt-1 text-sm text-muted">
            صدِّر سجل الأسئلة والأجوبة كملف PDF — دليل تدقيق لتقييم JISM، كل إجابة
            موثّقة بمصدرها (اسم الوثيقة والصفحة).
          </p>
          <AuditExportForm />
        </section>
      )}

      <table className="mt-8 w-full text-right text-ink">
        <thead>
          <tr className="border-b border-line text-muted">
            <th className="py-2">المختبر</th>
            <th className="py-2">الخطة</th>
            <th className="py-2">الحالة</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-line">
            <td className="py-3" colSpan={3}>
              لا توجد بيانات بعد.
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

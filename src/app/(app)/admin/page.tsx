import { InviteForm } from "@/components/admin/invite-form";

// AC-4.3 — admin shell: subscription status + activation state per tenant.
// AC-1.4 — team invitations (owner/admin only; enforced server-side).
export default function AdminPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-100">الإدارة</h1>
      <p className="mt-2 text-slate-400">حالة الاشتراك والتفعيل.</p>

      <section className="mt-8 rounded-xl border border-[#334155] bg-[#1B2A3D] p-6">
        <h2 className="text-lg font-bold text-slate-100">دعوة فريق المختبر</h2>
        <p className="mt-1 text-sm text-slate-400">
          أضف زملاءك في المختبر — يخضع العدد لحدود خطتك.
        </p>
        <InviteForm />
      </section>

      <table className="mt-8 w-full text-right text-slate-300">
        <thead>
          <tr className="border-b border-slate-700 text-slate-400">
            <th className="py-2">المختبر</th>
            <th className="py-2">الخطة</th>
            <th className="py-2">الحالة</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-slate-800">
            <td className="py-3" colSpan={3}>
              لا توجد بيانات بعد.
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

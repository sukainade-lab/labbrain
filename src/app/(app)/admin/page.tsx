// AC-4.3 — admin shell: subscription status + activation state per tenant.
export default function AdminPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-100">الإدارة</h1>
      <p className="mt-2 text-slate-400">حالة الاشتراك والتفعيل.</p>
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

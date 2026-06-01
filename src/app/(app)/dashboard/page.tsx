// AC-4.5 — dashboard usage counters shell (documents, queries this month).
export default function DashboardPage() {
  const stats = [
    { label: "الوثائق", value: "—" },
    { label: "الاستعلامات هذا الشهر", value: "—" },
    { label: "المستخدمون", value: "—" }
  ];
  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-100">لوحة التحكم</h1>
      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        {stats.map((s) => (
          <div
            key={s.label}
            className="rounded-xl border border-slate-700 bg-slate-900/40 p-6"
          >
            <div className="text-sm text-slate-400">{s.label}</div>
            <div className="mt-2 text-3xl font-bold text-amber-500">{s.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

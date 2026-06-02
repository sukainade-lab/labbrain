import type { InferenceModeView } from "@/lib/ai/inference-mode";

// AC-11.8 — the operator-visible inference-mode indicator (admin + founder). A
// read-only, server-rendered panel fed by the display-safe describeInferenceMode()
// view, so it can never throw and crash the page it sits on.
//
// RTL-first. Per lesson L5 every dynamic mixed-script value (model names and the
// parse host, which are Latin identifiers inside an Arabic layout) is wrapped in
// <bdi> so the bidi algorithm can't reorder it. The three modes are colour-coded:
// air-gap = locked/green (the compliance-safe state), cloud = neutral, invalid =
// red so a typo'd INFERENCE_MODE is impossible to miss.

const MODE_META: Record<
  InferenceModeView["mode"],
  { label: string; chip: string; icon: string }
> = {
  airgap: {
    label: "معزول (Air-gap)",
    chip: "bg-emerald-950 text-emerald-300 border-emerald-800",
    icon: "🔒"
  },
  cloud: {
    label: "سحابي",
    chip: "bg-slate-800 text-slate-300 border-slate-700",
    icon: "☁️"
  },
  invalid: {
    label: "إعداد غير صالح",
    chip: "bg-red-950 text-red-300 border-red-800",
    icon: "⚠️"
  }
};

export function InferenceModeBadge({ view }: { view: InferenceModeView }) {
  const meta = MODE_META[view.mode];

  return (
    <section
      aria-label="نمط الاستدلال"
      className="rounded-xl border border-[#334155] bg-[#1B2A3D] p-4"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="text-[11px] font-semibold text-slate-400">نمط الاستدلال</div>
        <span
          className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${meta.chip}`}
        >
          <span aria-hidden="true">{meta.icon} </span>
          {meta.label}
        </span>
      </div>

      {view.mode === "invalid" ? (
        <p className="mt-3 text-xs text-red-300">
          قيمة <bdi>INFERENCE_MODE</bdi> غير معروفة — راجع إعدادات النشر.
        </p>
      ) : (
        <dl className="mt-3 grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
          <Field label="نموذج التضمين" value={view.embedModel} />
          <Field label="نموذج الإجابة" value={view.answerModel} />
          <Field label="خادم التحليل" value={view.parseHost} />
        </dl>
      )}
    </section>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-slate-400">{label}</dt>
      <dd className="mt-0.5 font-medium text-slate-200">
        <bdi>{value}</bdi>
      </dd>
    </div>
  );
}

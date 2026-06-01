"use client";

import { useState } from "react";
import Link from "next/link";

// AC-3.1 — ask in Arabic or English; RTL default, EN renders LTR inline.
// AC-3.4/3.6 — every found answer carries a citation badge (📄 doc — الصفحة N);
// answer + question direction follow the detected language, IBM Plex Arabic for AR.
// AC-3.5 — when nothing clears the gate, the refusal message is shown, no citation.
// RTL-first, brand tokens (Navy #1B2A3D / Amber #D97706 / BG #0F172A / border
// #334155), matches docs/ux-reference/product-demo.jsx.

interface Citation {
  document_id: string;
  document_name: string;
  section: string | null;
  page_number: number | null;
  similarity: number;
}

interface QaMessage {
  id: number;
  question: string;
  answer: string;
  citations: Citation[];
  found: boolean;
  lang: "ar" | "en";
  emptyCorpus: boolean;
}

interface QaResponse {
  answer: string;
  citations: Citation[];
  found: boolean;
  lang: "ar" | "en";
  emptyCorpus: boolean;
}

export default function QaPage() {
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<QaMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onAsk() {
    const q = question.trim();
    if (!q || loading) return;
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/qa", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: q })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "تعذّرت معالجة السؤال");
        return;
      }
      const r = data as QaResponse;
      setMessages((prev) => [
        {
          id: Date.now(),
          question: q,
          answer: r.answer,
          citations: r.citations ?? [],
          found: r.found,
          lang: r.lang,
          emptyCorpus: r.emptyCorpus ?? false
        },
        ...prev
      ]);
      setQuestion("");
    } catch {
      setError("تعذّرت معالجة السؤال");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-100">الأسئلة والأجوبة</h1>
      <p className="mt-2 text-xs text-slate-400">
        اسأل من وثائق مختبرك فقط — كل إجابة مدعومة بمصدر من ملفاتكم.
      </p>

      {/* Input — dir="auto" so an English question flips to LTR as the user types. */}
      <div className="mt-6 rounded-xl border border-[#334155] bg-[#1B2A3D] p-4">
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onAsk();
          }}
          dir="auto"
          rows={3}
          placeholder="اسأل سؤالاً من وثائق مختبرك... (عربي أو إنجليزي)"
          className="w-full resize-none bg-transparent text-sm text-slate-100 outline-none placeholder:text-slate-500"
        />
        <div className="mt-3 flex justify-start">
          <button
            type="button"
            onClick={onAsk}
            disabled={loading || !question.trim()}
            className="min-h-[44px] rounded-lg bg-[#D97706] px-6 text-sm font-semibold text-white transition hover:bg-[#b45f05] disabled:bg-[#374151] disabled:opacity-80"
          >
            {loading ? "⏳ يبحث في الوثائق..." : "🔍 ابحث في وثائقك"}
          </button>
        </div>
      </div>

      {error && (
        <div className="mt-4 rounded-lg border border-[#92400e] bg-[#3b1c08] px-4 py-3 text-sm text-[#fcd34d]">
          {error}
        </div>
      )}

      {/* Q&A history (newest first). */}
      <div className="mt-6 flex flex-col gap-4">
        {messages.length === 0 && !loading && (
          <div className="rounded-xl border border-dashed border-[#334155] bg-[#1B2A3D] p-8 text-center text-sm text-slate-400">
            اطرح أول سؤال لتحصل على إجابة مدعومة بالمصدر من وثائق مختبرك.
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className="rounded-xl border border-[#334155] bg-[#1B2A3D] p-5">
            {/* Question — direction follows detected language (AC-3.1/3.6). */}
            <div
              dir={msg.lang === "en" ? "ltr" : "rtl"}
              className="mb-2 text-[13px] text-slate-400"
            >
              <span className="mx-1 text-[#F59E0B]">◎</span>
              <bdi>{msg.question}</bdi>
            </div>

            {/* Answer — only the grounded answer renders here; a refusal is shown
                in the dedicated not-found box below so it is never styled as a
                confident answer (AC-3.5). */}
            {msg.found && (
              <div
                dir={msg.lang === "en" ? "ltr" : "rtl"}
                className={`text-sm leading-7 text-slate-100 ${
                  msg.lang === "en" ? "text-left" : "text-right"
                }`}
              >
                {msg.answer}
              </div>
            )}

            {/* AC-3.4 — citation badge only when grounded. The badge links to the
                source document so the engineer can open it and verify the clause
                in context — the whole point of source-traced answers. */}
            {msg.found && msg.citations.length > 0 && (
              <div className="mt-3 flex flex-col gap-2">
                {msg.citations.map((c, i) => (
                  <Link
                    key={`${c.document_id}-${c.page_number ?? i}`}
                    href={`/documents?doc=${c.document_id}`}
                    className="group flex items-start gap-2.5 rounded-lg border border-[#D97706] bg-[#1a1f2e] px-3.5 py-2.5 transition hover:bg-[#22293a] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F59E0B]"
                  >
                    <span className="text-lg leading-none">📄</span>
                    <div className="min-w-0">
                      <bdi className="block text-xs font-semibold text-[#F59E0B] underline-offset-2 group-hover:underline">
                        {c.document_name}
                      </bdi>
                      <div className="mt-0.5 text-[11px] text-slate-300">
                        {c.section ? (
                          <>
                            <bdi>{c.section}</bdi>
                            {c.page_number != null ? " — " : ""}
                          </>
                        ) : null}
                        {c.page_number != null && (
                          <span>الصفحة {c.page_number}</span>
                        )}
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}

            {/* AC-3.5 — refusal styling when nothing cleared the gate. An empty
                corpus gets a distinct nudge: a new lab hasn't uploaded anything to
                search yet, so guide it to /documents rather than implying its
                files were searched and missed. */}
            {!msg.found && msg.emptyCorpus && (
              <div className="mt-3 rounded-lg border border-[#334155] bg-[#1a1f2e] px-3.5 py-3 text-xs text-slate-300">
                <p className="font-semibold text-slate-100">لا توجد وثائق للبحث فيها بعد.</p>
                <p className="mt-1 leading-6">
                  ارفع وثائق مختبرك أولاً، وبعد فهرستها ستحصل على إجابات مدعومة بالمصدر.
                </p>
                <Link
                  href="/documents"
                  className="mt-2 inline-flex min-h-[44px] items-center font-semibold text-[#F59E0B] hover:underline"
                >
                  رفع الوثائق ←
                </Link>
              </div>
            )}

            {!msg.found && !msg.emptyCorpus && (
              <div className="mt-3 rounded-lg border border-[#92400e] bg-[#3b1c08] px-3.5 py-2.5 text-xs text-[#fcd34d]">
                {msg.answer}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

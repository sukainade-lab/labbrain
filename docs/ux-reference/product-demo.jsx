/**
 * LabBrain — Product Demo Mockup
 * BRD Stories: S2 (Document Upload), S3 (Bilingual Q&A with Citation)
 * Loops: domain
 *
 * Shows the core product workflow:
 * 1. Document library (uploaded lab files)
 * 2. Q&A interface (Arabic question → cited answer)
 * 3. Citation badge (document name + section + page)
 *
 * NOTE: This is a UX reference for Claude Code — not production code.
 * Colors: Navy #1B2A3D, Amber #D97706, BG #0F172A
 */

import { useState } from "react";

const SAMPLE_DOCS = [
  { id: 1, name: "إجراء المعايرة — الكتلة والوزن.pdf", pages: 24, status: "ready", type: "pdf" },
  { id: 2, name: "دليل عدم اليقين في القياس v2.pdf", pages: 41, status: "ready", type: "pdf" },
  { id: 3, name: "سجل الأجهزة والمعدات.xlsx", pages: 8, status: "ready", type: "xlsx" },
  { id: 4, name: "SOP-Calibration-Temperature-2024.pdf", pages: 18, status: "indexing", type: "pdf" },
];

const SAMPLE_QA = [
  {
    id: 1,
    question: "ما هو الإجراء المتبع لحساب عدم اليقين في قياس الكتلة وفق الكلوز 7.6؟",
    lang: "ar",
    answer: "وفقاً للإجراء المعتمد، يتم حساب عدم اليقين في قياس الكتلة من خلال تحديد مصادر عدم اليقين الرئيسية: حل القراءة، الانجراف، وعدم التكرارية. يُجمع كل مصدر تربيعياً للحصول على عدم اليقين المركّب، ثم يُضرب بعامل التغطية k=2 للحصول على عدم اليقين الموسّع عند مستوى ثقة 95%.",
    citation: { doc: "دليل عدم اليقين في القياس v2.pdf", section: "7.6.2 — حساب عدم اليقين المركّب", page: 18 },
    found: true,
  },
  {
    id: 2,
    question: "What is the calibration interval for reference weights class E2?",
    lang: "en",
    answer: "Class E2 reference weights must be recalibrated every 12 months under normal laboratory conditions. If the weights are used more than 200 times per month or exposed to potential contamination, the interval reduces to 6 months. See the Equipment Registry for individual weight serial numbers and last calibration dates.",
    citation: { doc: "إجراء المعايرة — الكتلة والوزن.pdf", section: "Section 5.3 — Calibration Intervals", page: 11 },
    found: true,
  },
];

const StatusBadge = ({ status }) => {
  const map = {
    ready: { label: "جاهز", bg: "#064e3b", color: "#6ee7b7" },
    indexing: { label: "يُعالج...", bg: "#1e3a5f", color: "#93c5fd" },
    uploading: { label: "يُرفع...", bg: "#3b1c08", color: "#fcd34d" },
    failed: { label: "خطأ", bg: "#7f1d1d", color: "#fca5a5" },
  };
  const s = map[status] || map.ready;
  return (
    <span style={{
      background: s.bg, color: s.color,
      padding: "2px 10px", borderRadius: 999, fontSize: 11, fontWeight: 500,
    }}>{s.label}</span>
  );
};

const CitationBadge = ({ citation }) => (
  <div style={{
    marginTop: 12, padding: "10px 14px",
    background: "#1a1f2e", border: "1px solid #D97706",
    borderRadius: 8, display: "flex", alignItems: "flex-start", gap: 10,
  }}>
    <span style={{ fontSize: 18, lineHeight: 1 }}>📄</span>
    <div>
      <div style={{ color: "#F59E0B", fontWeight: 600, fontSize: 12 }}>{citation.doc}</div>
      <div style={{ color: "#9ca3af", fontSize: 11, marginTop: 2 }}>
        {citation.section} — <span style={{ color: "#d1d5db" }}>الصفحة {citation.page}</span>
      </div>
    </div>
  </div>
);

export default function ProductDemo() {
  const [activeTab, setActiveTab] = useState("qa");
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState(SAMPLE_QA);
  const [loading, setLoading] = useState(false);

  const handleAsk = () => {
    if (!question.trim()) return;
    setLoading(true);
    setTimeout(() => {
      const isAr = /[؀-ۿ]/.test(question);
      setMessages(prev => [{
        id: Date.now(), question, lang: isAr ? "ar" : "en",
        answer: isAr
          ? "بناءً على وثائق مختبركم، وجدت الإجابة في الإجراء المعتمد لديكم. الرجاء مراجعة المصدر المرفق للتفاصيل الكاملة."
          : "Based on your lab documents, I found a relevant answer in your approved procedure. Please refer to the citation below for the full details.",
        citation: { doc: "دليل عدم اليقين في القياس v2.pdf", section: "القسم المرتبط", page: 7 },
        found: true,
      }, ...prev]);
      setQuestion("");
      setLoading(false);
    }, 1200);
  };

  return (
    <div style={{
      background: "#0F172A", color: "#e2e8f0", minHeight: "100vh",
      fontFamily: "'IBM Plex Arabic', 'Segoe UI', sans-serif", direction: "rtl",
    }}>
      {/* Header */}
      <div style={{
        background: "#1B2A3D", padding: "14px 24px",
        display: "flex", justifyContent: "space-between", alignItems: "center",
        borderBottom: "1px solid #334155",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            width: 32, height: 32, background: "#D97706",
            borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center",
            fontWeight: 700, fontSize: 14, color: "#fff",
          }}>LB</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>LabBrain</div>
            <div style={{ fontSize: 11, color: "#9ca3af" }}>مختبر الأردن للمعايرة</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {["qa", "docs"].map(t => (
            <button key={t} onClick={() => setActiveTab(t)} style={{
              padding: "6px 16px", borderRadius: 6, fontSize: 13, fontWeight: 500,
              background: activeTab === t ? "#D97706" : "transparent",
              color: activeTab === t ? "#fff" : "#94a3b8",
              border: activeTab === t ? "none" : "1px solid #334155",
              cursor: "pointer",
            }}>
              {t === "qa" ? "الأسئلة والأجوبة" : "الوثائق"}
            </button>
          ))}
        </div>
      </div>

      <div style={{ maxWidth: 760, margin: "0 auto", padding: "24px 20px" }}>

        {activeTab === "docs" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>وثائق المختبر</h2>
              <button style={{
                padding: "8px 18px", background: "#D97706", color: "#fff",
                border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer",
              }}>+ رفع وثيقة</button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {SAMPLE_DOCS.map(doc => (
                <div key={doc.id} style={{
                  background: "#1B2A3D", borderRadius: 10, padding: "14px 16px",
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  border: "1px solid #334155",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={{
                      width: 36, height: 36, background: doc.type === "pdf" ? "#7f1d1d" : "#14532d",
                      borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 11, fontWeight: 700, color: "#fca5a5",
                      textTransform: "uppercase", direction: "ltr",
                    }}>{doc.type}</div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 500 }}>{doc.name}</div>
                      <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>{doc.pages} صفحة</div>
                    </div>
                  </div>
                  <StatusBadge status={doc.status} />
                </div>
              ))}
            </div>
            <div style={{ marginTop: 16, padding: "10px 16px", background: "#1e3a5f", borderRadius: 8, fontSize: 12, color: "#93c5fd" }}>
              4 وثائق · خطة Starter (50 وثيقة كحد أقصى) · الاستخدام: 8%
            </div>
          </div>
        )}

        {activeTab === "qa" && (
          <div>
            {/* Input */}
            <div style={{
              background: "#1B2A3D", borderRadius: 12, padding: 16, marginBottom: 24,
              border: "1px solid #334155",
            }}>
              <textarea
                value={question}
                onChange={e => setQuestion(e.target.value)}
                placeholder="اسأل سؤالاً من وثائق مختبرك... (عربي أو إنجليزي)"
                rows={3}
                style={{
                  width: "100%", background: "transparent", border: "none",
                  color: "#e2e8f0", fontSize: 14, resize: "none", outline: "none",
                  direction: "rtl", fontFamily: "'IBM Plex Arabic', sans-serif",
                  boxSizing: "border-box",
                }}
              />
              <div style={{ display: "flex", justifyContent: "flex-start", marginTop: 10 }}>
                <button
                  onClick={handleAsk}
                  disabled={loading || !question.trim()}
                  style={{
                    padding: "10px 24px", background: question.trim() ? "#D97706" : "#374151",
                    color: "#fff", border: "none", borderRadius: 8,
                    fontSize: 14, fontWeight: 600, cursor: question.trim() ? "pointer" : "default",
                    transition: "background 0.2s",
                  }}
                >
                  {loading ? "⏳ يبحث في الوثائق..." : "🔍 ابحث في وثائقك"}
                </button>
              </div>
            </div>

            {/* Q&A History */}
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {messages.map(msg => (
                <div key={msg.id} style={{
                  background: "#1B2A3D", borderRadius: 12, padding: 18,
                  border: "1px solid #334155",
                }}>
                  <div style={{
                    fontSize: 13, color: "#94a3b8", marginBottom: 8,
                    direction: msg.lang === "en" ? "ltr" : "rtl",
                  }}>
                    <span style={{ color: "#F59E0B", marginLeft: 4 }}>◎</span>
                    {msg.question}
                  </div>
                  <div style={{
                    fontSize: 14, lineHeight: 1.7, color: "#e2e8f0",
                    direction: msg.lang === "en" ? "ltr" : "rtl",
                    textAlign: msg.lang === "en" ? "left" : "right",
                  }}>
                    {msg.answer}
                  </div>
                  {msg.found && <CitationBadge citation={msg.citation} />}
                  {!msg.found && (
                    <div style={{
                      marginTop: 12, padding: "10px 14px",
                      background: "#3b1c08", border: "1px solid #92400e",
                      borderRadius: 8, fontSize: 12, color: "#fcd34d",
                    }}>
                      لم أجد إجابة لهذا السؤال في وثائقكم.
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

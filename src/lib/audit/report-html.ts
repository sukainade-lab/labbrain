import type { Citation } from "@/lib/qa/citations";
import type { AuditLogEntry, AuditReportInput } from "./types";

// Story 9 — pure builder for the RTL print HTML that Chromium renders to an A4
// PDF (AC-9.4). No DB, no network, no Chromium here: deterministic string in →
// string out, so the whole template is unit-tested without a browser.

// Labs are in Amman; Jordan is fixed UTC+3 (DST abolished 2022). Formatting via
// Intl with an explicit zone keeps output deterministic regardless of server TZ.
const AMMAN_TZ = "Asia/Amman";

// DD/MM/YYYY HH:MM (AC-9.2) in Amman local time.
export function formatAuditDate(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: AMMAN_TZ,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  // en-GB gives "00" for midnight hour (not "24"); keep as-is.
  return `${get("day")}/${get("month")}/${get("year")} ${get("hour")}:${get("minute")}`;
}

// Escape HTML so user/data-derived text (questions, answers, filenames, emails)
// can never inject markup into the report.
function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Bidi-isolate a dynamic mixed-script value (L5): wrap the escaped value in
// <bdi> so Latin filenames / digits / emails don't reorder inside the RTL flow.
function bidi(value: string): string {
  return `<bdi>${esc(value)}</bdi>`;
}

function citationLine(c: Citation): string {
  // Document name is the genuine mixed-script value → <bdi> (L5). Page/section
  // are bare numerics that don't reorder in RTL, and the AC fixes the literal
  // "صفحة [N]" wording, so they stay unwrapped.
  const name = bidi(c.document_name);
  const page = c.page_number != null ? ` — صفحة ${esc(String(c.page_number))}` : "";
  const section = c.section ? ` — بند ${esc(c.section)}` : "";
  return `<div class="citation">📄 ${name}${page}${section}</div>`;
}

function entryBlock(e: AuditLogEntry, index: number): string {
  const notFound = !e.found_answer;
  const classes = `entry${notFound ? " entry--not-found" : ""}`;
  const date = bidi(formatAuditDate(e.created_at));
  const email = bidi(e.asker_email);
  const lang = bidi(e.question_lang.toUpperCase());

  const citations = e.citations.length
    ? `<div class="citations">${e.citations.map(citationLine).join("")}</div>`
    : "";

  const answer = notFound
    ? `<div class="answer answer--not-found">⚠️ غير موجود / not found</div>`
    : `<div class="answer">${esc(e.answer_text)}</div>`;

  return `<section class="${classes}">
  <div class="entry-meta">
    <span class="num">#${index + 1}</span>
    <span class="lang">${lang}</span>
    <span class="email">${email}</span>
    <span class="date">${date}</span>
  </div>
  <div class="question">${esc(e.question_text)}</div>
  ${answer}
  ${citations}
</section>`;
}

const STYLE = `
  @page { size: A4; margin: 18mm 14mm; }
  * { box-sizing: border-box; }
  body {
    font-family: "IBM Plex Arabic", "IBM Plex Sans Arabic", system-ui, sans-serif;
    color: #0f172a; font-size: 12px; line-height: 1.6; margin: 0;
  }
  header.report-head {
    border-bottom: 2px solid #0f172a; padding-bottom: 12px; margin-bottom: 16px;
  }
  header.report-head h1 { font-size: 18px; margin: 0 0 8px; }
  .head-row { display: flex; justify-content: space-between; font-size: 11px; color: #334155; }
  .entry { border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; margin-bottom: 12px; page-break-inside: avoid; }
  .entry--not-found { border-color: #b45309; background: #fffbeb; }
  .entry-meta { display: flex; gap: 12px; font-size: 10px; color: #475569; margin-bottom: 8px; }
  .entry-meta .lang { font-weight: 600; }
  .question { font-weight: 600; margin-bottom: 6px; }
  .answer { margin-bottom: 6px; white-space: pre-wrap; }
  .answer--not-found { color: #b45309; font-weight: 600; }
  .citations { border-top: 1px dashed #cbd5e1; padding-top: 6px; }
  .citation { font-size: 10px; color: #334155; }
  bdi { unicode-bidi: isolate; }
  .empty { text-align: center; color: #475569; padding: 48px 0; font-size: 14px; }
`;

// Build the full HTML document. Empty entries → a valid document stating the
// bilingual empty-state (AC-9.4), never an error.
export function buildAuditReportHtml(input: AuditReportInput): string {
  const generated = bidi(formatAuditDate(input.generatedAt));
  const body = input.entries.length
    ? input.entries.map(entryBlock).join("\n")
    : `<div class="empty">لا توجد سجلات في هذا النطاق / no records in range</div>`;

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8" />
<title>سجل الأسئلة — ${esc(input.labName)}</title>
<style>${STYLE}</style>
</head>
<body>
<header class="report-head">
  <h1>سجل الأسئلة والأجوبة — ${esc(input.labName)}</h1>
  <div class="head-row">
    <span>النطاق: ${esc(input.rangeLabel)}</span>
    <span>تم التصدير بواسطة: ${bidi(input.exportedBy)}</span>
  </div>
  <div class="head-row">
    <span>تاريخ الإصدار: ${generated}</span>
    <span>عدد السجلات: ${bidi(String(input.entries.length))}</span>
  </div>
</header>
<main>
${body}
</main>
</body>
</html>`;
}

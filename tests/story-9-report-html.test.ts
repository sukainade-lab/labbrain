import { describe, it, expect } from "vitest";
import {
  buildAuditReportHtml,
  formatAuditDate
} from "@/lib/audit/report-html";
import type { AuditLogEntry } from "@/lib/audit/types";

// Story 9 — pure RTL report builder (no DB / no Chromium). Renders the print
// HTML that the Chromium seam (render-pdf.ts) turns into the A4 PDF.

function entry(over: Partial<AuditLogEntry> = {}): AuditLogEntry {
  return {
    id: "q1",
    question_text: "ما هي فترة المعايرة لميزان class E2؟",
    answer_text: "فترة المعايرة 12 شهراً وفق إجراء المختبر.",
    question_lang: "ar",
    found_answer: true,
    citations: [
      {
        document_id: "d1",
        document_name: "SOP-Calibration v3.pdf",
        section: "5.3",
        page_number: 7,
        similarity: 0.91
      }
    ],
    asker_email: "eng@lab-amman.jo",
    created_at: "2026-02-15T10:30:00Z",
    ...over
  };
}

const baseReport = {
  labName: "مختبر عمّان للمعايرة",
  generatedAt: "2026-06-02T09:00:00Z",
  rangeLabel: "كامل السجل / full history",
  exportedBy: "owner@lab-amman.jo"
};

describe("Story 9 — date formatting (@AC-9.2)", () => {
  it("formats created_at as DD/MM/YYYY HH:MM in Amman time (UTC+3)", () => {
    // 10:30 UTC → 13:30 Asia/Amman (fixed UTC+3 since 2022).
    expect(formatAuditDate("2026-02-15T10:30:00Z")).toBe("15/02/2026 13:30");
  });

  it("zero-pads day, month, hour, minute", () => {
    expect(formatAuditDate("2026-01-05T02:05:00Z")).toBe("05/01/2026 05:05");
  });
});

describe("Story 9 — report HTML structure (@AC-9.4)", () => {
  it("is a full RTL HTML document using IBM Plex Arabic", () => {
    const html = buildAuditReportHtml({ ...baseReport, entries: [entry()] });
    expect(html).toMatch(/<!DOCTYPE html>/i);
    expect(html).toContain('dir="rtl"');
    expect(html).toContain("IBM Plex Arabic");
    expect(html).toMatch(/@page/); // A4 print sizing
  });

  it("renders the header: lab name, generated-at, range, exported-by", () => {
    const html = buildAuditReportHtml({ ...baseReport, entries: [entry()] });
    expect(html).toContain("مختبر عمّان للمعايرة");
    expect(html).toContain("كامل السجل / full history");
    expect(html).toContain("owner@lab-amman.jo");
    expect(html).toContain("02/06/2026"); // generated-at, Amman date
  });
});

describe("Story 9 — entry fidelity (@AC-9.2)", () => {
  it("renders question, answer, asker email and formatted date", () => {
    const html = buildAuditReportHtml({ ...baseReport, entries: [entry()] });
    expect(html).toContain("ما هي فترة المعايرة لميزان class E2؟");
    expect(html).toContain("فترة المعايرة 12 شهراً وفق إجراء المختبر.");
    expect(html).toContain("eng@lab-amman.jo");
    expect(html).toContain("15/02/2026 13:30");
  });

  it("renders the citation block as 📄 [document] — صفحة [page]", () => {
    const html = buildAuditReportHtml({ ...baseReport, entries: [entry()] });
    expect(html).toContain("📄");
    expect(html).toContain("SOP-Calibration v3.pdf");
    expect(html).toContain("صفحة 7");
  });

  it("bidi-isolates dynamic mixed-script values with <bdi> (L5)", () => {
    const html = buildAuditReportHtml({ ...baseReport, entries: [entry()] });
    // document name, email, and date are mixed-script → must be <bdi>-wrapped
    expect(html).toContain("<bdi>SOP-Calibration v3.pdf</bdi>");
    expect(html).toContain("<bdi>eng@lab-amman.jo</bdi>");
    expect(html).toContain("<bdi>15/02/2026 13:30</bdi>");
  });

  it("escapes HTML in user-derived text (no raw injection)", () => {
    const html = buildAuditReportHtml({
      ...baseReport,
      entries: [entry({ question_text: "<script>alert(1)</script>" })]
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("marks a not-found entry as visually distinct with the bilingual label", () => {
    const html = buildAuditReportHtml({
      ...baseReport,
      entries: [
        entry({ found_answer: false, answer_text: "", citations: [] })
      ]
    });
    expect(html).toMatch(/not-found/);
    expect(html).toContain("غير موجود");
  });

  it("renders one block per entry in given order", () => {
    const html = buildAuditReportHtml({
      ...baseReport,
      entries: [
        entry({ id: "a", question_text: "سؤال أول" }),
        entry({ id: "b", question_text: "سؤال ثانٍ" })
      ]
    });
    expect(html.indexOf("سؤال أول")).toBeLessThan(html.indexOf("سؤال ثانٍ"));
  });
});

describe("Story 9 — empty state (@AC-9.4)", () => {
  it("renders a valid document stating لا توجد سجلات, not an error", () => {
    const html = buildAuditReportHtml({ ...baseReport, entries: [] });
    expect(html).toMatch(/<!DOCTYPE html>/i);
    expect(html).toContain("لا توجد سجلات");
  });
});

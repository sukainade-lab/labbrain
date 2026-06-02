import type { Citation } from "@/lib/qa/citations";

// Story 9 — one row of the Q&A audit log, shaped for export. Produced by
// getAuditLog (export-query.ts) and consumed by the report builder
// (report-html.ts). `asker_email` is joined from the asking user (AC-9.2).
export interface AuditLogEntry {
  id: string;
  question_text: string;
  answer_text: string;
  question_lang: string;
  found_answer: boolean;
  citations: Citation[];
  asker_email: string;
  created_at: string;
}

// Everything the PDF header + body needs (AC-9.4).
export interface AuditReportInput {
  labName: string;
  generatedAt: string | Date;
  rangeLabel: string;
  exportedBy: string;
  entries: AuditLogEntry[];
}

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Citation } from "@/lib/qa/citations";
import type { AuditRange } from "@/lib/validation/audit";
import type { AuditLogEntry } from "./types";

// Story 9 — fetch the tenant's Q&A audit log for export (AC-9.1 / AC-9.2). Must
// be called with the USER-SCOPED client so RLS (tenant_isolation on `queries`)
// guarantees only the caller's tenant rows are returned — never a service-role
// client. The asking user's email is joined for the audit trail.

interface AuditQueryRow {
  id: string;
  question_text: string;
  answer_text: string | null;
  question_lang: string | null;
  found_answer: boolean;
  citations: Citation[] | null;
  created_at: string;
  // Supabase types an embedded to-one relation as object | array | null.
  user: { email: string } | { email: string }[] | null;
}

// Date filter is inclusive on both ends (AC-9.3). `to` covers the whole day, so
// we bound by the end of that calendar day (UTC) rather than its midnight start.
const DAY_START = "T00:00:00.000Z";
const DAY_END = "T23:59:59.999Z";

export async function getAuditLog(
  supabase: SupabaseClient,
  range: AuditRange
): Promise<AuditLogEntry[]> {
  let query = supabase
    .from("queries")
    .select(
      "id, question_text, answer_text, question_lang, found_answer, citations, created_at, user:users(email)"
    )
    .order("created_at", { ascending: true });

  if (range.from) query = query.gte("created_at", `${range.from}${DAY_START}`);
  if (range.to) query = query.lte("created_at", `${range.to}${DAY_END}`);

  const { data, error } = await query;
  if (error) throw error;

  return (data ?? []).map((row) => {
    const r = row as unknown as AuditQueryRow;
    const userRel = Array.isArray(r.user) ? r.user[0] : r.user;
    return {
      id: r.id,
      question_text: r.question_text,
      answer_text: r.answer_text ?? "",
      question_lang: r.question_lang ?? "",
      found_answer: r.found_answer,
      citations: r.citations ?? [],
      asker_email: userRel?.email ?? "—",
      created_at: r.created_at
    };
  });
}

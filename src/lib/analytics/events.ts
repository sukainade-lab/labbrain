import type { Lang } from "@/lib/qa/lang";

// AC-5.5 — the analytics event contract. Pure builders return a fully-formed,
// PII-free payload; the transport (posthog-server) just ships what these return.
// Keeping the shape here (not inline at each call-site) makes the no-PII rule a
// single, unit-testable surface: properties may only ever carry the typed,
// non-identifying fields below — never email, name, lab name, question text or
// filename.

export type AnalyticsEventName =
  | "signup_completed"
  | "document_uploaded"
  | "question_asked"
  | "invoice_requested";

export interface CapturedEvent {
  event: AnalyticsEventName;
  distinctId: string;
  properties: Record<string, string | number | boolean>;
}

// Invoice requests come from a public (logged-out) form — there is no user to
// attribute, and the buyer's email/company is PII we deliberately do not send.
const ANONYMOUS = "anonymous";

export function signupCompleted(userId: string): CapturedEvent {
  return { event: "signup_completed", distinctId: userId, properties: {} };
}

// mime_type is a content-type string (e.g. application/pdf) — categorical, not
// identifying. The filename is intentionally omitted (it can carry PII / client
// names).
export function documentUploaded(
  userId: string,
  props: { mimeType: string }
): CapturedEvent {
  return {
    event: "document_uploaded",
    distinctId: userId,
    properties: { mime_type: props.mimeType }
  };
}

export function questionAsked(
  userId: string,
  props: { foundAnswer: boolean; lang: Lang }
): CapturedEvent {
  return {
    event: "question_asked",
    distinctId: userId,
    properties: { found_answer: props.foundAnswer, lang: props.lang }
  };
}

export function invoiceRequested(): CapturedEvent {
  return { event: "invoice_requested", distinctId: ANONYMOUS, properties: {} };
}

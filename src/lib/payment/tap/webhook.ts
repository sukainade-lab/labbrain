import { createHmac, timingSafeEqual } from "crypto";
import { tapSecretKey } from "./index";
import { formatAmount, isSupportedCurrency, type Currency } from "@/lib/pricing/currency";
import type { WebhookOutcome, SubscriptionRecord } from "../types";

// The Tap charge fields we read — only the ones the signature + activation need.
interface TapCharge {
  id?: string;
  amount?: number;
  currency?: string;
  status?: string;
  reference?: { gateway?: string | null; payment?: string | null } | null;
  // Tap nests the txn timestamp under `transaction`, NOT at the top level.
  transaction?: { created?: string | number | null } | null;
  customer?: { id?: string | null } | null;
  metadata?: { tenant_id?: string; plan?: string; interval?: string } | null;
}

// AC-6.3 — Tap's webhook signature. Tap signs the POST body with an HMAC-SHA256
// over a FIXED-ORDER hashstring, keyed by the SECRET API key (sk_…). Tap has NO
// separate webhook secret — the plan's TAP_WEBHOOK_SECRET was a placeholder; the
// verified scheme keys off TAP_SECRET_KEY (see docs/env-contract.md). The amount
// is formatted to the currency's decimals (AC-6.5) — a wrong exponent breaks every
// check. Field order/names are Tap's contract and must not be reordered:
//   x_id{id}x_amount{amount}x_currency{currency}x_gateway_reference{gw}
//   x_payment_reference{pmt}x_status{status}x_created{transaction.created}
export function tapHashstring(charge: TapCharge): string {
  const currency = charge.currency ?? "";
  const amount =
    charge.amount !== undefined && isSupportedCurrency(currency)
      ? formatAmount(charge.amount, currency as Currency)
      : String(charge.amount ?? "");
  const gateway = charge.reference?.gateway ?? "";
  const payment = charge.reference?.payment ?? "";
  const created = charge.transaction?.created ?? "";
  return (
    `x_id${charge.id ?? ""}` +
    `x_amount${amount}` +
    `x_currency${currency}` +
    `x_gateway_reference${gateway}` +
    `x_payment_reference${payment}` +
    `x_status${charge.status ?? ""}` +
    `x_created${created}`
  );
}

export function signTapHashstring(hashstring: string): string {
  return createHmac("sha256", tapSecretKey()).update(hashstring).digest("hex");
}

// AC-6.3 — verify a raw Tap webhook and reduce it to a provider-neutral outcome.
// Returns null when the signature header is missing or invalid → the route then
// responds 400 and applies nothing.
export function verifyTapWebhook(rawBody: string, headers: Headers): WebhookOutcome | null {
  const provided = headers.get("hashstring");
  if (!provided) return null;

  let charge: TapCharge;
  try {
    charge = JSON.parse(rawBody) as TapCharge;
  } catch {
    return null;
  }

  let expected: string;
  try {
    expected = signTapHashstring(tapHashstring(charge));
  } catch {
    // No TAP_SECRET_KEY → cannot verify, so reject rather than trust.
    return null;
  }

  if (!timingSafeEqualHex(provided, expected)) return null;

  return chargeToOutcome(charge);
}

function timingSafeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

// A CAPTURED charge activates the tenant; any other status (declined/failed/
// initiated) activates nothing. Idempotent downstream: the record keys on the
// Tap charge id via the provider-aware upsert (migration 0008).
function chargeToOutcome(charge: TapCharge): WebhookOutcome {
  if (charge.status !== "CAPTURED") return { kind: "ignore" };

  const tenantId = charge.metadata?.tenant_id ?? null;
  if (!tenantId) return { kind: "ignore" };

  const plan = charge.metadata?.plan ?? null;
  const interval = charge.metadata?.interval ?? null;
  const currency = charge.currency ?? "JOD";
  const chargeId = charge.id ?? null;

  const record: SubscriptionRecord | null = chargeId
    ? {
        tenantId,
        provider: "tap",
        providerCustomerId: charge.customer?.id ?? null,
        providerSubscriptionId: chargeId,
        currency,
        plan,
        interval,
        status: "active"
      }
    : null;

  return { kind: "activate", tenantId, plan, record };
}

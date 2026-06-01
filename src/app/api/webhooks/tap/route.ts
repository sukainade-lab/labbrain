import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { tapProvider } from "@/lib/payment/tap/provider";
import { applyOutcome } from "@/lib/payment/activation-core";
import { captureError } from "@/lib/observability/log";

// AC-6.3 — Tap webhook: HMAC-signature-verified, then applied to the DB via the
// SAME provider-neutral reducer the Stripe webhook uses. A captured charge
// activates the tenant + records a provider='tap' subscription row + emails the
// owner; a declined/failed charge (or a bad signature) activates nothing.
// Idempotent: Tap may redeliver, and recordSubscription keys on the charge id.
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.text();

  const outcome = await tapProvider.verifyWebhook(body, req.headers);
  if (!outcome) {
    // Missing/invalid signature — reject and apply nothing.
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }

  try {
    await applyOutcome(createAdminClient(), outcome);
  } catch (err) {
    captureError("webhook:tap", err);
    // 500 so Tap retries; applyOutcome is idempotent, so a retry is safe.
    return NextResponse.json({ error: "webhook handler failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

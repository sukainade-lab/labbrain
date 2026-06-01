import type { CapturedEvent } from "./events";
import { captureError } from "@/lib/observability/log";

// AC-5.5 — server-side PostHog capture over the public capture HTTP endpoint.
// We deliberately avoid the posthog-node SDK: a single fetch keeps the dependency
// surface flat and is trivially mockable in tests. distinct_id + the typed,
// PII-free properties come straight from the event builders (events.ts).
//
// Best-effort by contract: telemetry must never break a signup/upload/question.
// No key (local/CI/build) → no-op. A transport failure is logged, never thrown.
const DEFAULT_HOST = "https://us.i.posthog.com";

export async function track(evt: CapturedEvent): Promise<void> {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) return;
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? DEFAULT_HOST;
  try {
    await fetch(`${host.replace(/\/$/, "")}/capture/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        api_key: key,
        event: evt.event,
        distinct_id: evt.distinctId,
        properties: evt.properties
      })
    });
  } catch (err) {
    captureError("analytics", err);
  }
}

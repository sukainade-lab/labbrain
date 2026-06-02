// AC-6.2 / AC-6.3 — Tap Payments API client on native fetch + node crypto. No SDK
// dependency (no axios), consistent with the bundle-discipline lesson.
//
// Auth + webhook signing both key off the SECRET API key (sk_test_… / sk_live_…).
// Tap has NO separate "webhook secret": its webhook hashstring is an HMAC-SHA256
// keyed with this same secret key (see tap/webhook.ts + docs/env-contract.md).
// The S6 plan named TAP_WEBHOOK_SECRET before this was verified against Tap's docs;
// the verified scheme is TAP_SECRET_KEY for both calls and signature checks.
const TAP_API_BASE = "https://api.tap.company/v2";

export function tapSecretKey(): string {
  const key = process.env.TAP_SECRET_KEY;
  if (!key) throw new Error("TAP_SECRET_KEY is not set — cannot make Tap calls.");
  return key;
}

// Minimal authenticated JSON call to the Tap API. Throws on a non-2xx so callers
// never silently proceed on a failed charge.
export async function tapFetch(path: string, init: { method: string; body?: unknown }): Promise<unknown> {
  const res = await fetch(`${TAP_API_BASE}${path}`, {
    method: init.method,
    headers: {
      Authorization: `Bearer ${tapSecretKey()}`,
      "Content-Type": "application/json"
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(`Tap API ${path} failed (${res.status}): ${JSON.stringify(data)}`);
  }
  return data;
}

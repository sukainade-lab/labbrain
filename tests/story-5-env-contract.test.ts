import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Story 5 — AC-5.6. The env contract must be complete and value-free:
//  - every secret the app reads is declared by NAME in .env.example
//  - .env.example carries no real values (names only)
//  - docs/env-contract.md documents the source of each variable
// This guards the deploy runbook: a missing var name means a silent prod outage.

const ROOT = resolve(__dirname, "..");
const envExample = readFileSync(resolve(ROOT, ".env.example"), "utf8");
const envContract = readFileSync(resolve(ROOT, "docs/env-contract.md"), "utf8");

// The full set the runtime depends on across all stories.
const REQUIRED_VARS = [
  "APP_URL",
  "NODE_ENV",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "LLAMAPARSE_API_KEY",
  "RESEND_API_KEY",
  "RESEND_FROM_EMAIL",
  "INVOICE_REQUEST_TO",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
  "STRIPE_PRICE_STARTER_MONTH",
  "STRIPE_PRICE_STARTER_YEAR",
  "STRIPE_PRICE_PRO_MONTH",
  "STRIPE_PRICE_PRO_YEAR",
  "NEXT_PUBLIC_SENTRY_DSN",
  "NEXT_PUBLIC_POSTHOG_KEY",
  "NEXT_PUBLIC_POSTHOG_HOST"
] as const;

describe("@AC-5.6 env contract", () => {
  it.each(REQUIRED_VARS)(".env.example declares %s by name", (name) => {
    expect(envExample).toMatch(new RegExp(`^${name}=`, "m"));
  });

  it.each(REQUIRED_VARS)("docs/env-contract.md documents the source of %s", (name) => {
    expect(envContract).toContain(`\`${name}\``);
  });

  it(".env.example holds names only — no real secret values", () => {
    for (const line of envExample.split("\n")) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (!m) continue;
      const [, key, value] = m;
      // NODE_ENV=development is a non-secret default; everything else must be empty.
      if (key === "NODE_ENV") continue;
      expect(value, `${key} must be empty in .env.example`).toBe("");
    }
  });

  it("never leaks a live key prefix (sk_live_, whsec_, sb_secret_, pk_live_)", () => {
    expect(envExample).not.toMatch(/sk_live_|whsec_[A-Za-z0-9]|sb_secret_|pk_live_/);
  });
});

# Environment Contract — where each secret comes from

Copy `.env.example` → `.env.local` and fill. Never commit `.env.local`.

| Variable | Source | Notes |
|----------|--------|-------|
| `APP_URL` | You | `http://localhost:3000` locally; your domain in prod |
| `NODE_ENV` | Runtime | Not a secret. `development` locally; `production` on the VPS (set by the image) |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API | Frankfurt region project |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Project Settings → API | Public anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API | **Server-only.** Never expose to client |
| `OPENAI_API_KEY` | platform.openai.com → API keys | GPT-4o-mini default, GPT-4o complex |
| `ANTHROPIC_API_KEY` | console.anthropic.com → API keys | Fallback + Arabic quality check |
| `LLAMAPARSE_API_KEY` | cloud.llamaindex.ai | PDF/DOCX/XLSX parsing with page numbers |
| `RESEND_API_KEY` | resend.com → API keys | Transactional email |
| `RESEND_FROM_EMAIL` | You | Verified sender domain in Resend |
| `STRIPE_SECRET_KEY` | dashboard.stripe.com → Developers → API keys | `sk_test_…` in dev |
| `STRIPE_WEBHOOK_SECRET` | dashboard.stripe.com → Developers → Webhooks | `whsec_…`; from the endpoint for `/api/stripe/webhook` |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | dashboard.stripe.com → Developers → API keys | `pk_test_…` |
| `STRIPE_PRICE_STARTER_MONTH` | Stripe → Products | Price ID for Starter monthly (35 JOD/mo) |
| `STRIPE_PRICE_STARTER_YEAR` | Stripe → Products | Price ID for Starter annual (−25% = 315 JOD/yr) |
| `STRIPE_PRICE_PRO_MONTH` | Stripe → Products | Price ID for Pro monthly (70 JOD/mo) |
| `STRIPE_PRICE_PRO_YEAR` | Stripe → Products | Price ID for Pro annual (−25% = 630 JOD/yr) |
| `TAP_SECRET_KEY` | dashboard.tap.company → Developers → API Credentials | `sk_test_…`/`sk_live_…`; **one key, two jobs** — authenticates Tap API calls AND verifies the webhook hashstring (HMAC-SHA256). No separate webhook secret exists (S6/AC-6.3). |
| `TAP_PRICE_{PLAN}_{INTERVAL}_{KWD\|SAR}` | You (founder price points) | KWD/SAR amounts in major units (e.g. `49.000`). 8 keys: STARTER/PRO × MONTH/YEAR × KWD/SAR. JOD is derived from `lib/pricing/plans` (not env). `amountFor` THROWS if a needed key is missing — no FX guessing (AC-6.5). |
| `INVOICE_REQUEST_TO` | You | Founder/sales inbox that receives bank-transfer invoice requests (AC-4.2 fallback) |
| `DEMO_VIDEO_URL` | You | Welcome-email demo link (AC-4.4); falls back to `${APP_URL}/demo` if unset |
| `UNIFONIC_API_KEY` | unifonic.com → console → SMS app (AppSid) | **Server-only.** Authenticates every SMS API POST for 2FA OTPs (S7/AC-7.2) |
| `UNIFONIC_SENDER_ID` | unifonic.com → console → SenderIDs | Approved alphanumeric sender name (e.g. `LabBrain`) shown on the OTP SMS |
| `MFA_COOKIE_SECRET` | You (`openssl rand -base64 32`) | **Server-only.** One HMAC key for BOTH the OTP code hash AND the `lb_mfa` elevation cookie (S7). Min 32 bytes. Rotating it invalidates live OTP challenges + elevation cookies |
| `PLATFORM_ADMIN_EMAILS` | You | **Server-only.** Comma-separated email allowlist — the *entire* gate for the `/founder` super-admin panel (S8/AC-8.1). There is no platform-admin DB role; an email here can pause/activate any lab and read cross-tenant usage. Keep tight; match the founder's sign-in address |
| `PUPPETEER_EXECUTABLE_PATH` | The runtime image (Contabo Docker) | **Server-only.** Absolute path to the system Chromium that `puppeteer-core` drives to render the audit-log PDF (S9/AC-9.4), e.g. `/usr/bin/chromium`. `CHROMIUM_PATH` is an accepted alias. Unset in CI/local — the render seam is mocked there. Unset in prod → `GET /api/audit/export` 500s with a clear message |
| `NEXT_PUBLIC_SENTRY_DSN` | sentry.io → Project → Client Keys (DSN) | Error monitoring |
| `NEXT_PUBLIC_POSTHOG_KEY` | posthog.com → Project Settings | Product analytics |
| `NEXT_PUBLIC_POSTHOG_HOST` | posthog.com | e.g. `https://eu.posthog.com` (EU for residency) |

## Payments caveat (founder override)

Payments use **Stripe** by founder decision. Stripe does **not** onboard Jordan-registered businesses, and JOD is not a standard Stripe settlement currency. This setup assumes a Stripe account under an entity in a supported country (e.g. US/UK LLC). Pricing is *displayed* in JOD; actual charge/settlement currency depends on the Stripe account. If Stripe onboarding is rejected, fall back to Tap Payments or manual JOD bank transfer + invoice (the original BRD plan — the `onboarding-flow.jsx` invoice screen covers this).

## Two payment rails (S6 — AC-6.1)

As of S6 both rails are wired behind one `PaymentProvider` interface, selected at runtime by `pickProvider(currency)`:

- **Tap** — primary for **JOD / KWD / SAR** (the Gulf currencies). Requires `TAP_SECRET_KEY` and, for KWD/SAR, the `TAP_PRICE_*` price points. JOD needs no price env (derived from `lib/pricing/plans`).
- **Stripe** — every other currency (the S4 contract, unchanged). A checkout POST with no `currency` still routes to Stripe, so the shipped loop is untouched.

The live default is JOD → Tap. Stripe stays fully configured as the international rail and as the documented fallback if Tap (or Stripe) onboarding is rejected.

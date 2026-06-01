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
| `INVOICE_REQUEST_TO` | You | Founder/sales inbox that receives bank-transfer invoice requests (AC-4.2 fallback) |
| `DEMO_VIDEO_URL` | You | Welcome-email demo link (AC-4.4); falls back to `${APP_URL}/demo` if unset |
| `NEXT_PUBLIC_SENTRY_DSN` | sentry.io → Project → Client Keys (DSN) | Error monitoring |
| `NEXT_PUBLIC_POSTHOG_KEY` | posthog.com → Project Settings | Product analytics |
| `NEXT_PUBLIC_POSTHOG_HOST` | posthog.com | e.g. `https://eu.posthog.com` (EU for residency) |

## Payments caveat (founder override)

Payments use **Stripe** by founder decision. Stripe does **not** onboard Jordan-registered businesses, and JOD is not a standard Stripe settlement currency. This setup assumes a Stripe account under an entity in a supported country (e.g. US/UK LLC). Pricing is *displayed* in JOD; actual charge/settlement currency depends on the Stripe account. If Stripe onboarding is rejected, fall back to Tap Payments or manual JOD bank transfer + invoice (the original BRD plan — the `onboarding-flow.jsx` invoice screen covers this).

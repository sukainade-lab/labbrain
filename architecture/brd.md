# LabBrain — Business Requirements Document (BRD)

**Version:** 1.0 | **Date:** 2026-05-30
**Product:** LabBrain — ISO/IEC 17025 Document Intelligence, MENA
**Founder:** Solo non-technical — Claude Code pair
**Deploy target:** Weekend MVP → Contabo VPS (Germany/EU)

---

> **Weekend MVP — Stories S1–S5.**
> Ship these 5 stories. Email auth (Supabase), Stripe Checkout + webhook money loop (bank-transfer/invoice retained as fallback). No SMS 2FA. No super-admin panel (Supabase Studio until ~50 labs). All 7 loops wired: auth, domain, money, notify, deploy, observability, compliance.

> **v2 Phase — Stories S6–S16 `[@Phase2]`.**
> Everything tagged `[@Phase2]` below is deferred. v2 entry point: `/2-eo-dev-plan story-6` after the MVP is live. The numbered chain continues without another bootstrap.

---

## Product Vision

LabBrain gives every staff member in a JISM-accredited lab instant, cited answers from their own documents — in Arabic and English. Zero hallucination. Mandatory source citation. Built for ISO 17025.

---

## Weekend MVP Definition

A Weekend MVP is shippable when all 7 loops are wired end-to-end:

| Loop | Status |
|------|--------|
| auth | signup → confirm → login → forgot → logout |
| domain | upload doc → index → ask question → cited answer |
| money | pricing page → Stripe Checkout → webhook activation → email receipt (invoice fallback available) |
| notify | welcome email + activation confirmation |
| deploy | Contabo VPS, custom domain, SSL, /api/health 200 |
| observability | Sentry errors + PostHog events + PM2 uptime |
| compliance | Supabase RLS on all multi-tenant tables, .env.example, secrets managed |

---

## Stories

---

### S1 — Lab Onboarding & Auth [@WeekendMVP] [loop: auth, compliance]

**As a** Quality Manager at a JISM-accredited lab,
**I want to** register my lab and team on LabBrain,
**so that** my staff can access the Q&A system with isolated, secure data.

#### Acceptance Criteria

**AC-1.1** — Signup form accepts: lab name, admin full name, work email, password. Submission triggers email verification.

**AC-1.2** — Email verification link expires in 24 hours. Clicking it activates the account and redirects to the onboarding flow.

**AC-1.3** — Each lab is provisioned as an isolated tenant. Supabase RLS policies enforce that queries on `documents`, `document_chunks`, `queries`, and `users` tables return only rows matching the authenticated user's `tenant_id`. Direct API calls with a valid token from Lab A cannot access Lab B data.

**AC-1.4** — Admin can invite team members by email. Invitation email includes a sign-up link with a pre-filled token. Invited user signs up → automatically joined to the same tenant.

**AC-1.5** — Login supports: email + password. "Forgot password" sends a reset link. All 5 auth flows (signup, confirm, login, forgot, logout) return appropriate error messages for invalid inputs.

**AC-1.6** — Plan tier (Starter / Pro) controls user seat limit: Starter = 5 users, Pro = 20 users. Inviting beyond the limit shows an upgrade prompt.

---

### S2 — Document Upload & Indexing [@WeekendMVP] [loop: domain, compliance]

**As a** lab admin,
**I want to** upload our ISO 17025 lab documents (procedures, calibration methods, uncertainty budgets),
**so that** LabBrain can answer questions from those exact documents.

#### Acceptance Criteria

**AC-2.1** — Upload accepts: PDF, DOCX, XLSX files up to 50 MB each. File is stored in Supabase Storage under the tenant's namespace bucket.

**AC-2.2** — On upload, LlamaParse API processes the file. Extracted text preserves: document name, page numbers, section headings (where detectable). Processing status shown in UI: uploading → parsing → indexing → ready.

**AC-2.3** — Parsed text is chunked (≤500 tokens per chunk, 50-token overlap). Each chunk is embedded via OpenAI `text-embedding-3-small` and stored in the `document_chunks` table (pgvector column). Chunk metadata: `document_id`, `tenant_id`, `page_num`, `section_text`.

**AC-2.4** — Tenant isolation is enforced at the vector layer: all pgvector queries filter by `tenant_id` before performing similarity search. A query from Tenant A cannot retrieve chunks belonging to Tenant B.

**AC-2.5** — Document list page shows: file name, upload date, page count, status, delete button. Deleting a document removes the file from Storage AND all associated chunks from `document_chunks`.

**AC-2.6** — Starter plan cap: 50 documents. Pro plan cap: 200 documents. Uploading beyond the cap shows a clear upgrade message.

---

### S3 — Bilingual Q&A with Mandatory Citation [@WeekendMVP] [loop: domain]

**As a** lab engineer or quality officer,
**I want to** ask questions about our lab procedures in Arabic or English,
**so that** I get an accurate, cited answer without having to search through documents manually.

#### Acceptance Criteria

**AC-3.1** — Question input accepts Arabic and English text. The UI is RTL by default; English input switches to LTR inline. No language-selection toggle required — the system detects language automatically.

**AC-3.2** — On submission, the system performs a pgvector similarity search filtered to the tenant's document chunks (top-5 results, cosine similarity threshold ≥ 0.75). Retrieved chunks are passed to GPT-4o-mini with a strict system prompt.

**AC-3.3** — The system prompt instructs the AI: "Answer only from the provided document excerpts. If the answer is not present, respond with: 'لم أجد إجابة لهذا السؤال في وثائقكم.' Do not generate information not present in the source."

**AC-3.4** — Every answer includes a citation block: document name, section (if available), page number. Citation is displayed as a styled badge below the answer. Format: `📄 [Document Name] — الصفحة [N]`.

**AC-3.5** — If no relevant chunk scores above the threshold (0.75), the system returns the "not found" message in the user's language. It does NOT attempt to answer from general AI knowledge.

**AC-3.6** — Arabic answers are displayed RTL with IBM Plex Arabic font. English technical terms within Arabic answers (ISO 17025, calibration, uncertainty) are BiDi-isolated inline (LTR within RTL sentence).

**AC-3.7** — Each Q&A pair is saved to the `queries` table with: `question_text`, `question_lang`, `answer_text`, `citations` (jsonb), `found_answer` (bool), `tenant_id`, `user_id`, `created_at`.

---

### S4 — Pricing, Stripe Checkout & Account Activation [@WeekendMVP] [loop: money, notify]

> **Payment provider: Stripe (founder override 2026-06-01).** Original BRD specified manual bank-transfer/invoice. Money loop is now Stripe Checkout + webhook. Bank-transfer/invoice ("Request Invoice" form → Resend → manual Supabase activation) is retained as a **fallback** path for finance teams that require an official JOD invoice. Caveat: Stripe requires an entity in a supported country — see `architecture/tech-stack-decision.md`.

**As a** lab manager evaluating LabBrain,
**I want to** see pricing and subscribe (or request an invoice),
**so that** I can activate a paid plan.

#### Acceptance Criteria

**AC-4.1** — Public pricing page displays: Starter (35 JOD/mo, 5 users, 50 docs) and Pro (70 JOD/mo, 20 users, 200 docs). Annual pricing shown with 25% discount. Currency displayed as JOD.

**AC-4.2** — "Subscribe" button creates a Stripe Checkout session (mode `subscription`) for the selected plan/interval and redirects to Stripe-hosted checkout. A secondary "Request Invoice" link opens the fallback form (company, billing address, VAT optional, plan) that emails the founder via Resend for manual JOD bank-transfer handling.

**AC-4.3** — A Stripe webhook endpoint (`/api/stripe/webhook`, signature-verified) handles `checkout.session.completed` → sets the tenant's plan status to `active`, records the `subscriptions` row (stripe_customer_id, stripe_subscription_id, plan, status), and sends an activation confirmation email. `customer.subscription.deleted` / `invoice.payment_failed` flip status back to `inactive` / `past_due`. Invoice-fallback accounts are still activated manually via the admin panel.

**AC-4.4** — A welcome email is sent automatically when a new account is created (regardless of plan). It includes: lab name, admin name, 3 onboarding steps (upload first doc, ask first question, invite team), and a link to the demo video.

**AC-4.5** — Dashboard shows usage counters: documents uploaded (X / plan limit), active users (X / plan limit), questions asked this month.

---

### S5 — Deploy, Health & Observability [@WeekendMVP] [loop: deploy, observability, compliance]

**As the** sole founder operating LabBrain,
**I want to** know the system is running and get alerted on errors,
**so that** I can respond quickly and maintain trust with paying labs.

#### Acceptance Criteria

**AC-5.1** — `GET /api/health` returns HTTP 200 with JSON: `{ status: "ok", version: "1.0.0", uptime_seconds: N }`. Responds within 200ms.

**AC-5.2** — App deploys to a Contabo VPS (Germany/EU) via `docker-compose up -d`. A single `deploy.sh` script pulls latest code, builds, restarts with zero-downtime (PM2 reload). The script is documented in `README.md`.

**AC-5.3** — Caddy reverse proxy handles SSL certificate (auto Let's Encrypt) and routes traffic to Next.js on port 3000. Custom domain configured in Caddy config.

**AC-5.4** — Sentry SDK is initialized with `NEXT_PUBLIC_SENTRY_DSN`. All uncaught errors and unhandled promise rejections are captured. Each error event includes `tenant_id` (set in Sentry scope on auth).

**AC-5.5** — PostHog is initialized. These events are tracked: `signup_completed`, `document_uploaded`, `question_asked` (with `found_answer: bool`, `lang: ar|en`), `invoice_requested`. No PII in event properties.

**AC-5.6** — `.env.example` is shipped with all required variable names (no values). README documents which service provides each variable and where to find it.

**AC-5.7** — Supabase RLS is enabled on tables: `tenants`, `users`, `documents`, `document_chunks`, `queries`, `subscriptions`, `invitations`. RLS policies are named (e.g., `tenant_isolation_documents`) and tested in a seed script.

---

## v2 Stories (Post-Weekend MVP) [@Phase2]

| # | Story | Loop |
|---|-------|------|
| S6 | Tap Payments card integration (JOD + KWD + SAR) | money |
| S7 | SMS 2FA via Unifonic (Jordan numbers) | auth |
| S8 | Founder super-admin panel — view all tenants, usage, pause/unpause accounts, mark invoices paid | domain |
| S9 | Audit export — download Q&A log as PDF (audit evidence for JISM inspectors) | domain |
| S10 | KSA data migration — tenant migration tool to AWS me-central-1 for PDPL compliance | compliance |
| S11 | Air-gap mode — self-hosted LlamaParse + Ollama for labs with classified documents | domain, compliance |
| S12 | Multi-tenant branding — lab logo in UI header | domain |
| S13 | Document versioning — replace a document and re-index without losing Q&A history | domain |
| S14 | Slack/email digest — weekly summary of top questions asked (for lab QA review) | notify |
| S15 | API access — REST endpoints for enterprise integrations (LIMS, ERP) | domain |
| S16 | Webinar demo flow — group demo booking + recording distribution (Waitlist Heat motion) | domain |

---

## Constraints

- Arabic RTL layout tested from day 1 (not retrofitted)
- Payments via Stripe (founder override 2026-06-01) — assumes a Stripe entity in a supported country. Tap Payments / JOD bank transfer retained as fallback. (Original constraint was "No Stripe"; superseded by founder decision — see `architecture/tech-stack-decision.md`.)
- No Vercel — EU data residency requires Contabo (Germany) or AWS MENA
- No SMS in MVP — email-only auth is sufficient for Jordan B2B labs
- Non-technical founder: no manual server config beyond documented deploy.sh steps

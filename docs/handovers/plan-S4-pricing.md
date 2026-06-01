# Plan — S4: Pricing, Stripe Checkout & Account Activation

> `/2-eo-dev-plan story-4` · 2026-06-01 · approved by founder. Next: `/3-eo-code`.
> Loops: **money** (Stripe Checkout + activation) + **notify** (welcome/activation email).

## BRD acceptance criteria
- **AC-4.1** — Pricing page: Starter 35 JOD/mo (5 users / 50 docs), Pro 70 JOD/mo (20 users / 200 docs); monthly⇄annual toggle (annual −25%); JOD shown both ways; RTL, BiDi-isolated `JOD`.
- **AC-4.2** — Checkout: Stripe Checkout (`mode: subscription`) as primary money loop; bank-transfer/invoice request as MENA fallback (relationship-gated buyers). Auth required to start checkout; unauth → `/signup?plan=`.
- **AC-4.3** — Activation: on successful payment, tenant goes `active`; admin/founder can manually activate invoice-paid accounts. Activation email sent.
- **AC-4.4** — Welcome email on every new account creation (lab name, admin name, onboarding steps, demo link).
- **AC-4.5** — Dashboard usage counters: documents X/limit, active users X/limit, questions this month — real data, user-scoped.

## Founder overrides in force (see CLAUDE.md + tech-stack-decision)
- **Stripe primary** (not Tap). Bank-transfer/invoice = fallback for JOD relationship buyers, not removed.
- Stripe Price IDs are **founder-provided config** — added to `.env.example` + `docs/env-contract.md` as TODO placeholders; `STRIPE_PRICE_STARTER_MONTH/YEAR`, `STRIPE_PRICE_PRO_MONTH/YEAR`.
- `APP_URL` production value lands in **S5**; checkout success/cancel URLs fall back to `http://localhost:3000` until then.

## Lessons in force
- **L1 (active)** — test the HTTP seam. S4 adds `/api/checkout`, `/api/invoice-request`, and the `/api/stripe/webhook` handler → route-handler integration tests per branch (success + each error status), or QA caps at 8.
- **L3 (active)** — confirm the actual CI run is green (`gh run list`) before declaring ship-ready, not just local gates.

## Reuse (do not rebuild)
- `lib/payment/stripe/checkout.ts` — `createCheckoutSession(...)`. **Harden:** reuse `subscriptions.stripe_customer_id` instead of `customer_email` (avoids duplicate Stripe customers).
- `lib/payment/stripe/index.ts` — lazy Stripe client (Proxy; survives `next build` with empty key).
- `app/api/stripe/webhook/route.ts` — signature-verified stub (`force-dynamic`, `req.text()`); fill the 3 TODO(S4) handlers.
- `lib/auth/seats.ts` — `PLAN_SEAT_LIMITS = { starter: 5, pro: 20 }`, `countSeats(includePending)`.
- `lib/documents/limits.ts` — `PLAN_DOC_LIMITS = { starter: 50, pro: 200 }`.
- `lib/email/resend.ts` — lazy Resend; has `sendActivationEmail`, `sendInvitationEmail`. **Add** `sendWelcomeEmail`.
- `subscriptions` table (0001) — id, tenant_id, stripe_customer_id, stripe_subscription_id, status, current_period_end; partial-unique `subscriptions_stripe_sub_idx` on stripe_subscription_id (idempotent upsert key).
- `tenants.plan` (starter/pro), `tenants.status` (inactive/active/past_due) — `tenants.status` is the **access gate**; `subscriptions.status` mirrors Stripe.

## Migration 0005_billing.sql
1. Add `subscriptions.plan text` (starter/pro) + `subscriptions.price_interval text` (month/year) — so the webhook can record what was bought.
2. Confirm/add an RLS read policy so a tenant reads **its own** subscription row (dashboard reads via user-scoped client; webhook writes via service-role/admin which bypasses RLS).

## Components (test-first)
1. **AC-4.1** `(marketing)/pricing/page.tsx` — fix wrong limits (current copy says 100 docs / 1 user / unlimited / 10 users — all WRONG). Correct to 5 users/50 docs · 20 users/200 docs. Add monthly⇄annual toggle (−25%), JOD both ways, `<bdi>JOD</bdi>`. Render test asserts correct limits + both prices.
2. **AC-4.2** `lib/payment/stripe/prices.ts` — typed price map from `STRIPE_PRICE_*` env keyed by `plan × interval`. Harden `createCheckoutSession` to reuse `stripe_customer_id`. `POST /api/checkout` (auth → 401/redirect to signup; resolves price; returns session URL). Route test mocks Stripe.
3. **AC-4.2 fallback** `POST /api/invoice-request` — company, billing address, VAT (optional), plan → Resend email to founder. RTL form. Route test mocks Resend.
4. **AC-4.3** webhook handlers (idempotent, upsert on `stripe_subscription_id`):
   - `checkout.session.completed` → resolve tenant via `client_reference_id`/`metadata.tenant_id` → `tenants.status='active'`, upsert `subscriptions` (plan, interval, customer, sub id, status, period_end) → `sendActivationEmail`.
   - `customer.subscription.deleted` → `tenants.status='inactive'`, subscription `canceled`.
   - `invoice.payment_failed` → `tenants.status='past_due'`, subscription `past_due`.
   - Tests: live serialized DB test (mock `stripe.webhooks.constructEvent` → synthetic event, assert DB), signature-rejection (400), same-event-twice idempotency.
5. **AC-4.4** `sendWelcomeEmail(to, {labName, adminName})` — called from S1 signup provisioning on **every** account creation. Content test (lab name, admin name, 3 onboarding steps, demo link).
6. **AC-4.5** `(app)/dashboard/page.tsx` — replace `—` placeholders with real counts (user-scoped client): documents X/limit, active users X/limit, questions this month (`queries.created_at` ≥ month start). Match `admin-dashboard.jsx` style.

## Test plan
- **Webhook (P0 money path)** — serialized live DB (L2): activate → DB asserts; idempotency (same event twice = one row, still active); bad signature → 400. AI/Resend mocked; Stripe event synthesized.
- **Route (L1)** — `/api/checkout` (200 w/ URL, 401 unauth), `/api/invoice-request` (200, 400 bad body).
- **Units** — `prices.ts` resolution (plan×interval → id; missing env → clear error), pricing-page render (limits + both intervals).

## Risks
- Stripe Price IDs unknown until founder creates products → tests mock the env; `.env.example` carries placeholders. Do not hardcode.
- Webhook idempotency is load-bearing (Stripe retries) — upsert on the partial-unique sub id, never blind insert.
- `tenants.status` vs `subscriptions.status`: gate access on `tenants.status` only; subscription status is an audit mirror.
- No new runtime dependency (stripe + resend present) → no bundle lesson.

## Out of scope (deferred)
- PostHog `invoice_requested` event → **S5** (AC-5.5, observability loop).
- Super-admin cross-tenant panel → **S8** `[@Phase2]`.
- `APP_URL` production value → **S5** (deploy).

## MENA checks
arabic-rtl-checker + mena-mobile-check on pricing + invoice-request form + dashboard — 375px, RTL, BiDi isolation on JOD/Stripe terms, tap targets ≥44px.

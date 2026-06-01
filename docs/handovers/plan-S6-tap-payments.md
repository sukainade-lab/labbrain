# Plan — S6: Tap Payments card integration (JOD + KWD + SAR)

> `/2-eo-dev-plan story-6` · approved 2026-06-02 · branch `feat/s6-tap-payments` (off `main`)
> First Phase-2 story. BRD lists S6 as a one-line v2 row, so this plan defines its ACs.

## Why

S4 shipped the money loop on **Stripe** (founder override), with a documented caveat:
Stripe cannot onboard a Jordan-registered entity and will not settle **JOD**, the
currency the entire Amman beachhead pays in. S6 makes **Tap Payments** the real
JOD/Gulf card rail. Tap was always the BRD's intended provider and the recorded
fallback (`tech-stack-decision.md` "Payments (fallback)", BRD Constraints).

## Architect's decisions (the two open questions)

1. **Provider role → Tap as primary JOD/Gulf rail behind a `pickProvider` router.**
   Both providers sit behind one `PaymentProvider` interface; Stripe is refactored
   to implement it with **zero behavior change** (all S4 tests stay green). JOD/KWD/SAR
   route to Tap; other currencies to Stripe. We keep Stripe for any future intl entity
   instead of deleting a working loop.
2. **Renewals → per-interval charge (MVP).** One Tap hosted-payment-page (HPP) charge
   activates the tenant for the chosen month/year; webhook flips status. Tap recurring
   (saved-card token + subscription) is carved into an **S6 follow-up** — materially
   heavier and not needed to validate the loop pre-launch.

## Acceptance Criteria (defined here)

- **AC-6.1** — `PaymentProvider` interface (`createCheckout`, `verifyWebhook`) with Stripe
  + Tap implementations; `pickProvider(currency)` routes JOD/KWD/SAR → Tap, else Stripe.
  Stripe refactored behind it, no behavior change.
- **AC-6.2** — Tap HPP checkout for a plan×interval; amount derived from the pricing
  source of truth (no hardcoded amounts), in the tenant's currency (JOD default);
  redirect to Tap.
- **AC-6.3** — `POST /api/webhooks/tap`, signature-verified (`TAP_WEBHOOK_SECRET`): a
  captured charge activates the tenant, records a provider-neutral `subscriptions` row,
  and sends the activation email — via the **shared** activation effects Stripe also uses.
  Idempotent on Tap charge id; a declined/failed charge activates nothing.
- **AC-6.4** — Migration `0008` adds provider-neutral columns (`provider`,
  `provider_customer_id`, `provider_subscription_id`, `currency`) + a provider-aware
  atomic upsert RPC; RLS unchanged (tenant self-read, service-role writes).
- **AC-6.5** — Currencies JOD/KWD/SAR with correct decimals (JOD & KWD = 3, SAR = 2);
  default JOD; KWD/SAR use founder-provided per-currency price points — **no FX guessing**.
- **AC-6.6** — Pricing CTA reaches the right rail end-to-end via the router (JOD → Tap);
  invoice fallback retained; currency/amount strings `<bdi>`-wrapped (L5); 375px + RTL verified.

## Approach

- **Refactor, don't fork.** Extract DB effects from `stripe/activation.ts` into
  provider-agnostic `payment/activation-core.ts` (`activateTenant` / `recordSubscription`
  / `deactivate` / `markPastDue` / `sendActivation`). Both webhooks call it.
- **`src/lib/payment/tap/`** (`index`, `checkout`, `webhook`) on **native `fetch` + node
  `crypto`** for the HMAC signature — **no new dependency** (no axios), consistent with
  the dependency-free posthog-server choice + global bundle discipline. Verify Tap's
  exact hashstring signing scheme against Tap API docs before implementing the verifier.
- **Server-side provider switch.** `/api/checkout` consults `pickProvider` and returns
  `{ url }` for either rail. The pricing page already POSTs to `/api/checkout` and
  redirects to the returned URL → minimal UI churn, clean L4 end-to-end path.
- **`src/lib/pricing/currency.ts`** — decimals + minor-unit resolver; `amountFor(plan,
  interval, currency)`. Default JOD; KWD/SAR price points config-gated.
- **Schema** `0008_tap_payments.sql` + provider-aware `upsert_subscription` (atomic
  INSERT…ON CONFLICT on a new partial unique index), mirroring 0006.

## Risks / unknowns

- Tap signature scheme must match docs exactly (security-critical, QA Q4) — verify first.
- KWD/SAR billing needs founder per-currency price points; until then JOD is the live default.
- Live Tap needs founder sandbox keys; build/test with mocked seams + signature unit test.
- Migration ordering (S5 gate): `supabase db push` before any deploy carrying 0008.
- Sequencing: don't switch a real lab to Tap before the core loop is validated live;
  building S6 now de-risks launch.

## Lessons applied
- **L1** — route-handler tests for `/api/checkout` (Tap branch) + `/api/webhooks/tap`, every status.
- **L2** — any live-DB activation test serialized + unique-tenant scoped.
- **L3** — confirm CI green on the PR before ship.
- **L4** — trace pricing CTA → router → Tap HPP → webhook → activation; no orphan route.
- **L5** — `<bdi>` on currency codes/amounts from first write.

## MENA checks
- `arabic-rtl-checker` + `mena-mobile-check` (pricing UI touched).

## Out of scope (S6 follow-ups)
- Tap recurring / auto-renew (saved-card token + Tap subscription, renewal/failure webhooks).
- Live KWD/SAR price points (added when a Gulf lab signs).
- Refunds via the `PaymentProvider` interface.

# Plan — S7: SMS 2FA via Unifonic (Jordan numbers)

**Story:** S7 (first-defined ACs; BRD lists S7 as a one-line v2 row `brd.md:163`).
**Loop:** auth. **Branch:** `feat/s7-sms-2fa` off `main`.
**Planned:** 2026-06-02 · `/2-eo-dev-plan story-7`.

> The Weekend-MVP "No SMS 2FA" line (`brd.md:11,181`) scopes the *MVP*; S7 is the
> explicit Phase-2 story that lifts it. Email auth (Supabase) stays the primary
> factor; S7 adds an **optional second factor** on top.

## Founder decisions (locked at plan time)

1. **Enrollment model: per-user opt-in.** Each user enables 2FA on their own
   account. Tenant-enforced 2FA (admin forces all lab members) is an S7 follow-up.
2. **Session-elevation: app-level signed cookie**, not Supabase native AAL2. After
   `signInWithPassword`, a 2FA-enabled user's session is "password-only" until they
   pass the OTP step, which sets a signed httpOnly `lb_mfa` cookie that middleware
   requires. Stateless, locally testable, provider-agnostic. Migrating to Supabase
   native AAL2 is a possible hardening follow-up (needs dashboard/auth-hook config,
   partly founder-gated, harder to test deterministically).

## Acceptance criteria (defined by this plan)

- **AC-7.1 — Phone enrollment.** A logged-in user adds a Jordan mobile
  (`07XXXXXXXX` → normalized `+9627XXXXXXXX`); `mfa_enabled` flips true **only**
  after a successful enrollment OTP round-trip, never on save alone.
- **AC-7.2 — OTP issuance via Unifonic.** A 6-digit code is generated, **hashed**
  (never plaintext) with a 5-min TTL + attempt counter, and sent via Unifonic SMS
  (Arabic body) to the enrolled number.
- **AC-7.3 — Verify + session elevation.** Correct code within TTL + attempt limit
  sets the `lb_mfa` cookie and routes to `/dashboard`; wrong/expired/exhausted →
  localized error, no elevation; code single-use.
- **AC-7.4 — Gate enforcement (end-to-end, L4).** A 2FA-enabled user past password
  auth but not the OTP step cannot reach any `(app)` route — middleware redirects to
  the verify screen. Users without 2FA are unaffected.
- **AC-7.5 — Rate-limit / anti-abuse.** Resend cooldown + max sends per number/window;
  max verify attempts per challenge; fail-closed; constant-time compare; single-use.
- **AC-7.6 — Disable/recovery + RTL UI.** User can disable 2FA (fresh OTP or password
  re-auth required). Enrollment + verify screens RTL, 375px, `<bdi>` on phone/digits,
  ≥44px targets, `aria-live` for sent/error states.

## Approach

- **Migration `0009_mfa.sql`** — `users.phone` (E.164), `users.mfa_enabled` (default
  false), `users.phone_verified_at`; new `mfa_challenges` (`id`, `user_id` fk,
  `code_hash`, `purpose` login|enroll|disable, `expires_at`, `attempts`, `consumed_at`,
  `created_at`); **named RLS** per the compliance rule (server/service-role managed —
  challenges are never client-readable); index `(user_id, created_at)`.
- **Pure helpers (node-testable):**
  - `lib/auth/phone.ts` — Jordan normalize/validate (`07…`/`+9627…`/`009627…`).
  - `lib/auth/mfa-cookie.ts` — HMAC sign/verify of `{userId, exp}` with `MFA_COOKIE_SECRET`.
  - `lib/auth/otp.ts` — generate / hash / constant-time compare; TTL + attempt rules.
- **Unifonic sender** — `lib/sms/unifonic.ts`, native `fetch` + node `crypto`, no SDK,
  lazy client, fails closed (matches Tap/PostHog dependency-free pattern).
- **Routes** — `/api/auth/2fa/enroll` · `/send` · `/verify` · `/disable`.
- **Middleware (`src/proxy.ts`)** — extend the `(app)` gate: if the session user has
  `mfa_enabled` and lacks a valid `lb_mfa` cookie → redirect to `(auth)/login/verify`.
- **UI** — `(auth)/login/verify` (OTP entry) + a 2FA section in account settings
  (enroll/disable), RTL + 375px + `<bdi>` + `aria-live`.

## Risks / verify FIRST (the S6-style security gate)

- **Unifonic API contract** — confirm auth scheme (AppSid vs Bearer/API key), the
  send-SMS endpoint + request/response shape, and Jordan sender-ID rules against
  Unifonic docs **before** writing the sender (security + correctness critical), the
  same way we verified Tap's hashstring scheme before S6.
- **Session-downgrade correctness** — prove a 2FA-enabled user cannot reach `(app)`
  with only the Supabase cookie; the middleware addition is the entire security value.

## Lessons applied

- **L1** — route-seam tests for all four `/api/auth/2fa/*` routes, every branch.
- **L2** — live DB suite for `mfa_challenges`, serialized + unique-user scoped.
- **L4** — trace login → 2FA-pending → verify → dashboard; confirm the gate blocks.
- **L5** — `<bdi>` on phone number/digits from first implementation.
- **L6** — `.env.example` placeholder shapes for `UNIFONIC_API_KEY` / `MFA_COOKIE_SECRET`.
- **L3 + retro P1** — push branch + confirm `gh run` green **before** `/5-eo-score`,
  to retire the recurring Architecture-8 procedural cap.

## New env (names only; placeholders per L6)

- `UNIFONIC_API_KEY` (or `UNIFONIC_APP_SID` per confirmed auth scheme)
- `UNIFONIC_SENDER_ID`
- `MFA_COOKIE_SECRET` (HMAC key for the `lb_mfa` marker)

Add to `.env.example` + `docs/env-contract.md` (where each comes from).

## Out of scope (S7 follow-ups)

TOTP/authenticator app, backup codes, WhatsApp OTP, tenant-enforced 2FA policy,
"remember this device 30 days" beyond the session marker.

## MENA checks

arabic-rtl-checker + mena-mobile-check (new enrollment + verify screens).

**Phase = `ready-to-code`. Next: `/3-eo-code`.**

# Plan — S1: Lab Onboarding & Auth

> Approved 2026-06-01. Build sequence: `/3-eo-code` (TDD) → `/4-eo-review` → `/5-eo-score`.

## BRD ACs
- **AC-1.1** — Signup accepts lab name, admin name, work email, password → triggers email verification.
- **AC-1.2** — Verification link expires 24h; clicking activates account → redirects to onboarding.
- **AC-1.3** — Tenant isolation via RLS on `documents`, `document_chunks`, `queries`, `users`. Lab A token cannot read Lab B data. *(Compliance test — runs against live RLS, never mocked.)*
- **AC-1.4** — Admin invites by email; invite link carries a token; invited user signs up → joins same tenant.
- **AC-1.5** — Login (email+password), forgot-password reset link, logout; all 5 flows return correct errors for invalid input.
- **AC-1.6** — Seat limits: Starter=5, Pro=20. Over-limit invite shows upgrade prompt.

## Reuse (already scaffolded)
- `supabase/migrations/0001_init.sql` — tenants, users, invitations, subscriptions.
- `supabase/migrations/0002_rls_policies.sql` — `current_tenant_id()` + named isolation policies (promoted from standalone policies/ so it applies in every env). No INSERT policy on `tenants` (provisioning is server-side by design).
- `src/proxy.ts` — gates `/dashboard` + `/admin`.
- `docs/ux-reference/onboarding-flow.jsx` — visual ground truth (Navy/Amber, IBM Plex Arabic).

## Approach
1. **Service-role admin client** `src/lib/supabase/admin.ts` (`SUPABASE_SERVICE_ROLE_KEY`, server-only). Add key to `.env.example` + env-contract.
2. **Signup → provisioning** `POST /api/auth/signup`: `auth.signUp` (24h confirm email) → service-role inserts tenant + owner user. If `?token` present, join invitation's tenant instead of creating one. Confirm redirect → `/onboarding`.
3. **Login/forgot/logout** — wire shells to `signInWithPassword`/`resetPasswordForEmail`/`signOut` with field-level errors.
4. **Invitations + seat limits** — admin action counts active tenant users vs plan limit before creating `invitations` row + Resend email (`/signup?token=…`). Over-limit → upgrade prompt, no invite.
5. **RTL UI** matching `onboarding-flow.jsx` tokens; 375px-safe; Jordanian register.

## Risks
- AC-1.3 needs a live Supabase (local CLI or test project) — not mocks.
- AC-1.2 24h expiry is a Supabase Auth dashboard setting; app asserts redirect path only.
- Seat-limit count must be race-safe enough for MVP (count immediately before insert).
- Service-role key must never reach the client bundle.

## MENA checks
- `arabic-rtl-checker`, `mena-mobile-check` (S1 ships UI).

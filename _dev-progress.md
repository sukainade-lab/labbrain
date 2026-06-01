# LabBrain — Dev Progress

> Read by `/eo-guide` on every session. The filesystem is the source of truth; this is a view.
> Bootstrapped 2026-06-01 from EO-Brain phases 0–4. SaaSfast mode M3. Payments: Stripe. Deploy: Contabo.

## Weekend MVP (Stories S1–S5)

| Story | Title | Loops | ACs | Status |
|-------|-------|-------|-----|--------|
| S1 | Lab Onboarding & Auth | auth, compliance | AC-1.1…1.6 (6) | 🩹 bridging gaps · score=88 · lowest=QA(8) · add route-handler integration tests → /6-eo-bridge-gaps |
| S2 | Document Upload & Indexing | domain, compliance | AC-2.1…2.6 (6) | ⬜ not started |
| S3 | Bilingual Q&A with Mandatory Citation | domain | AC-3.1…3.7 (7) | ⬜ not started |
| S4 | Pricing, Stripe Checkout & Activation | money, notify | AC-4.1…4.5 (5) | ⬜ not started |
| S5 | Deploy, Health & Observability | deploy, observability, compliance | AC-5.1…5.7 (7) | ⬜ not started |

**Totals:** 5 stories · 31 ACs · all 7 loops covered.

## v2 (Phase 2 — Stories S6–S16, frozen)

| Story | Title | Loop |
|-------|-------|------|
| S6 | Tap Payments card integration (JOD + KWD + SAR) | money |
| S7 | SMS 2FA via Unifonic (Jordan numbers) | auth |
| S8 | Founder super-admin panel | domain |
| S9 | Audit export — Q&A log as PDF | domain |
| S10 | KSA data migration → AWS me-central-1 (PDPL) | compliance |
| S11 | Air-gap mode (self-hosted LlamaParse + Ollama) | domain, compliance |
| S12 | Multi-tenant branding (lab logo) | domain |
| S13 | Document versioning + re-index | domain |
| S14 | Slack/email weekly digest | notify |
| S15 | API access (LIMS/ERP integration) | domain |
| S16 | Webinar demo flow | domain |

## Legend
⬜ not started · 🟡 in progress · ✅ shipped (PR merged + score ≥90)

## Next
`/6-eo-bridge-gaps` → lift QA 8→9 by adding route-handler integration tests for
`/api/auth/signup` + `/api/invitations`. Re-score → expect composite 90 → ship.

---
**Last updated:** 2026-06-01 · **Current sprint:** 1 / ~5 · **Last command:** `/5-eo-score` (S1)

## Reconciliation log
- 2026-06-01 — `/eo-guide`: filesystem matches tracker (all S1–S5 ⬜, no plans, git local without remote). No diff. Phase = `ready-to-plan`.
- 2026-06-01 — `/2-eo-dev-plan story-1`: S1 planned → `docs/handovers/plan-S1-auth.md`. Phase = `ready-to-code`.
- 2026-06-01 — `/3-eo-code` S1: implemented AC-1.1…1.6 test-first. Backend (provision/login/invitations/seat-limits) + RTL auth UI (signup/login/forgot/onboarding + admin invite + logout). 18/18 live+pure tests pass against local Supabase; `next build` + `eslint .` green. RLS promoted to migration `0002_rls_policies.sql`. Resend + Stripe clients made lazy to survive build with empty keys. Phase = `ready-to-review`.
- 2026-06-01 — `/4-eo-review` S1: 35 files reviewed. No secrets, no `any`, 6/6 ACs tagged, RTL classes clean. 🔴 must-fix found+fixed: invite-mode UI signup sent `labName:"—"` (1 char) which failed `signupSchema.min(2)` → every UI invite-signup 400'd; the unit test missed it by calling `provisionSignup` directly. Fixed: schema `superRefine` (labName required only without invite token) + form omits labName on invite + 2 regression tests. 🟡 hardening applied: invite acceptance now bound to invited email. 20/20 tests green. Phase = `ready-to-score`.
- 2026-06-01 — `/5-eo-score` S1: composite **88** (Product 9 / Arch 9 / Eng 9 / QA 8 / UX 9). Report → `docs/qa-scores/2026-06-01-1731-S1-auth.md`; trend.csv started. Below 90 gate → bridge gaps. Lowest hat QA(8): no integration tests at the HTTP route seam (the layer where the labName bug hid). First score <90 + first bug → captured lesson **L1** (test the HTTP seam). Phase = `bridging-gaps`.

# LabBrain — Dev Progress

> Read by `/eo-guide` on every session. The filesystem is the source of truth; this is a view.
> Bootstrapped 2026-06-01 from EO-Brain phases 0–4. SaaSfast mode M3. Payments: Stripe. Deploy: Contabo.

## Weekend MVP (Stories S1–S5)

| Story | Title | Loops | ACs | Status |
|-------|-------|-------|-----|--------|
| S1 | Lab Onboarding & Auth | auth, compliance | AC-1.1…1.6 (6) | ✅ shipped 2026-06-01 · 100/100 · PR #1 merged (`2c93614`) · runtime deploy deferred to S5 |
| S2 | Document Upload & Indexing | domain, compliance | AC-2.1…2.6 (6) | 🔨 coding · all 6 ACs green · 30 S2 tests (2 live vector-isolation + 16 helper + 12 route) · gates clean · awaiting `/4-eo-review` |
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
`/4-eo-review` → review S2 diff (security/RTL/mobile/traceability) before scoring. Never skip review.

---
**Last updated:** 2026-06-01 · **Current sprint:** 1 / ~5 · **Last command:** `/3-eo-code story-2`

## Reconciliation log
- 2026-06-01 — `/eo-guide`: filesystem matches tracker (all S1–S5 ⬜, no plans, git local without remote). No diff. Phase = `ready-to-plan`.
- 2026-06-01 — `/2-eo-dev-plan story-1`: S1 planned → `docs/handovers/plan-S1-auth.md`. Phase = `ready-to-code`.
- 2026-06-01 — `/3-eo-code` S1: implemented AC-1.1…1.6 test-first. Backend (provision/login/invitations/seat-limits) + RTL auth UI (signup/login/forgot/onboarding + admin invite + logout). 18/18 live+pure tests pass against local Supabase; `next build` + `eslint .` green. RLS promoted to migration `0002_rls_policies.sql`. Resend + Stripe clients made lazy to survive build with empty keys. Phase = `ready-to-review`.
- 2026-06-01 — `/4-eo-review` S1: 35 files reviewed. No secrets, no `any`, 6/6 ACs tagged, RTL classes clean. 🔴 must-fix found+fixed: invite-mode UI signup sent `labName:"—"` (1 char) which failed `signupSchema.min(2)` → every UI invite-signup 400'd; the unit test missed it by calling `provisionSignup` directly. Fixed: schema `superRefine` (labName required only without invite token) + form omits labName on invite + 2 regression tests. 🟡 hardening applied: invite acceptance now bound to invited email. 20/20 tests green. Phase = `ready-to-score`.
- 2026-06-01 — `/5-eo-score` S1: composite **88** (Product 9 / Arch 9 / Eng 9 / QA 8 / UX 9). Report → `docs/qa-scores/2026-06-01-1731-S1-auth.md`; trend.csv started. Below 90 gate → bridge gaps. Lowest hat QA(8): no integration tests at the HTTP route seam (the layer where the labName bug hid). First score <90 + first bug → captured lesson **L1** (test the HTTP seam). Phase = `bridging-gaps`.
- 2026-06-01 — `/6-eo-bridge-gaps qa` S1: added `tests/story-1-auth-routes.test.ts` — 10 route-handler integration tests POSTing to `/api/auth/signup` (400 bad-body, 201 new-lab, 409 duplicate, 201 invite-join, 400 invite-email-mismatch, 402 seat_limit) and `/api/invitations` (401, 403 member, 201 owner, 402 seat_limit). signup runs live; invitations mocks only the cookie-bound auth/role, createInvitation runs live. Also fixed a latent isolation flaw: the AC-1.1 rollback test counted global tenants → now asserts on a unique tenant name (immune to parallel test files). 30/30 tests green; build+lint clean. QA 8→9. Phase = `ready-to-rescore`.
- 2026-06-01 — `/7-eo-ship` S1: final HEAD gate green — 36/36 tests, `eslint .`, `next build` all clean; `npm audit` 0 high/critical in production runtime (dev-only vitest/vite/postcss advisories documented). Score gate ✅ (composite 100, no hat <8). Trunk→PR: pushed `feat/s1-auth`, opened **PR #1**, founder-authorized merge (`--merge`), merge commit `2c93614`; local main fast-forwarded + branch deleted. Status → ✅ shipped. NOTE: production runtime deploy (Contabo VPS + Caddy + PM2) + live `/api/health` are **S5 scope** (Deploy/Observability, ⬜) — S1 ships code to main; the deploy pipeline lands with S5.
- 2026-06-01 — `/3-eo-code` S2: implemented AC-2.1…2.6 test-first. Migration `0003` (status +`indexing`, `document_chunks.section`, private `documents` Storage bucket + path-namespaced RLS, `match_document_chunks` RPC filtering `tenant_id` BEFORE cosine — AC-2.4). Live AC-2.4 vector-isolation test FIRST (2 tests: own-tenant retrieval + Lab A blocked from Lab B even with B's exact embedding, synthetic orthogonal vecs, no OpenAI key). Pure helpers: `lib/documents/chunk.ts` (js-tiktoken cl100k_base, ≤500 tok/50 overlap, page+section per chunk, never blends pages → citation stays page-exact), `lib/documents/limits.ts` (`PLAN_DOC_LIMITS` 50/200, `assertDocAvailable`→`DocLimitError`), `lib/validation/documents.ts` (mime∈{pdf,docx,xlsx}, ≤50MB). Lazy seams: `lib/parsing/llamaparse.ts` (upload→poll→page blocks), `lib/ai/embeddings.ts` (text-embedding-3-small, batched). Orchestrator `lib/documents/ingest.ts` (inline pipeline w/ DB checkpoints parsing→indexing→ready/failed; storage cleanup on failure). Routes `POST/GET /api/documents` + `DELETE /api/documents/[id]` (402 over-cap, 413 oversize, 403 cross-tenant vs 404 missing). RTL `(app)/documents` UI matching `product-demo.jsx` (type tile, status badge, delete, cap line). **L1 satisfied:** 12 route-handler integration tests (seams mocked, Storage+DB live). 66/66 tests green (30 new S2), `eslint .` + `next build` clean. Status stays 🔨 coding until `/4-eo-review`. Phase = `ready-to-review`.
- 2026-06-01 — "bridge to 10/10" S1: closed every remaining −1 honestly. **Product:** `/api/auth/resend` route + signup success-state "أعد الإرسال" button (AC-1.2). **Arch/Eng:** extracted `lib/auth/seats.ts` (single source of truth for seat accounting — `getPlanLimit`+`countSeats`; both create/accept paths use it) and added `confirm` route `token_hash`/`verifyOtp` fallback for the OTP/magic-link shape. **QA:** route tests 10→16 (added login 200/401/400, forgot 200×2, logout 200 — server seam mock now delegates `signInWithPassword`/`resetPasswordForEmail`/`signOut` to a real anon client, so credentials are checked for real); lesson L1 cap marked satisfied for S1. **UX:** real 375px audit (Claude Preview) across signup/login/forgot — RTL, zero h-overflow, inputs 49px@16px (no iOS zoom), CTA 48px. 36/36 tests green; `eslint .` + `next build` clean. `/5-eo-score` re-run → composite **100** (10/10/10/10/10). Report → `docs/qa-scores/2026-06-01-1755-S1-auth.md`. Phase = `ready-to-ship`.

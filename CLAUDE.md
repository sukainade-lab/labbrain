# LabBrain — Project Instructions

> ISO/IEC 17025 document intelligence for JISM-accredited labs. Bilingual Arabic/English. Zero hallucination. Mandatory source citation.

## The product safety contract (non-negotiable)

LabBrain answers a lab engineer's question **only** from that lab's own uploaded documents, with the document name and page cited. A hallucinated ISO clause read to an auditor is a non-conformity finding. Therefore:

- **Source-traced retrieval only.** Every answer is grounded in retrieved `document_chunks`. No general-knowledge fallback — ever.
- **If no chunk scores ≥ 0.75 similarity**, return the "not found" message in the user's language. Do not attempt to answer.
- **Every answer carries a citation block**: `📄 [Document Name] — الصفحة [N]`.

This is the product, not a feature. Any code path that lets the model answer ungrounded is a P0 bug.

## Domain & ICP

- **ICP:** Technical/Quality Manager at a JISM-accredited ISO 17025 calibration/testing lab, 5–25 staff, Amman (beachhead). Arabic native (Jordanian dialect), English professional. WhatsApp-first. Budget ~100 JOD/mo.
- **Buying behavior:** bank transfer + official JOD invoice. Relationship-gated. Trigger = upcoming accreditation assessment.

## Stack

| Layer | Choice |
|-------|--------|
| Frontend | Next.js 14 App Router + TypeScript |
| Styling | Tailwind CSS + RTL (`tailwindcss-rtl`), IBM Plex Arabic |
| Data fetching | TanStack React Query · Validation: Zod |
| Backend | Next.js API Routes |
| DB | Supabase Postgres (Frankfurt / EU) |
| Vector | pgvector (Supabase extension), HNSW index |
| Auth | Supabase Auth (email + magic link), multi-tenant via RLS |
| Storage | Supabase Storage (Frankfurt) |
| Parsing | LlamaParse (cloud API) |
| AI | OpenAI GPT-4o-mini (default), GPT-4o (complex), Claude API (fallback + AR quality) |
| Email | Resend |
| Payments | Stripe Checkout + webhooks (founder override). Tap / bank-transfer = fallback if Stripe onboarding rejected. See tech-stack note. |
| Deploy | Contabo VPS (Germany/EU) + Caddy (auto-SSL) + PM2 + docker-compose |
| Observability | Sentry + PostHog |

**SaaSfast mode: M3 — Core stack.** See `architecture/tech-stack-decision.md`.

## MENA rules (RTL from day 1 — not retrofitted)

- RTL default layout; English input/terms switch to LTR inline with BiDi isolation (ISO 17025, calibration, uncertainty, JISM).
- IBM Plex Arabic font for Arabic content.
- Currency: **JOD**. Dates: DD/MM/YYYY. Weekend: Fri/Sat.
- Test at 375px viewport (WhatsApp demo sharing).
- Enforced per-PR by `arabic-rtl-checker` + `mena-mobile-check` via `/eo-score`.

## Data residency

All persistent data (accounts, files, vectors, query logs) stays in **Supabase Frankfurt (EU)**. LlamaParse + OpenAI are processing-only (transient). KSA expansion (PDPL) → migrate to AWS me-central-1 — plan before first KSA paying lab.

## Multi-tenancy (compliance loop)

Every multi-tenant table (`tenants`, `users`, `documents`, `document_chunks`, `queries`, `subscriptions`, `invitations`) has **named RLS policies** (e.g. `tenant_isolation_documents`) tested in a seed script. pgvector similarity search **filters by `tenant_id` before** searching. Lab A must never retrieve Lab B's chunks — test this explicitly (AC-1.3, AC-2.4).

## Build sequence

1. `/2-eo-dev-plan story-1` → plan a Weekend MVP story
2. `/3-eo-code` → TDD: failing test → minimum code → refactor
3. `/4-eo-review` → 4-dimension review (security, performance, correctness, maintainability)
4. `/5-eo-score` → 5-hat scorecard (≥8 per hat, ≥90 composite to ship)
5. `/6-eo-bridge-gaps` → close gaps if below threshold
6. `/7-eo-ship` → clean PR + release

Weekend MVP = Stories S1–S5. v2 = S6–S16 `[@Phase2]`.

## Voice (when generating user-facing content)

- Arabic: Jordanian conversational dialect. Preserve English technical terms inline. Never MSA/fusha.
- English: direct, professional, no buzzwords ("leverage", "ecosystem", "cutting-edge"), no filler openings.
- Lead with the answer. Never translate ISO clause numbers, units, or accreditation body names.
- Two business lines exist: **LabBrain** (this SaaS) and ISO consulting/training. Default to LabBrain.

## Non-negotiables

- No hard-coded secrets. `.env.local` is gitignored; `.env.example` carries names only.
- Every `AC-N.N` has a `@AC-N.N` tagged test (`brd-traceability`).
- `/eo-review` before every commit; 5-hat scorecard before every PR (save to `docs/qa-scores/`).
- Bugs → `/eo-debug` (systematic, root-cause, no guessing).

## Operations & infrastructure ownership (Claude-owned)

The founder has delegated **GitHub + Supabase database + server admin** to Claude, operated
through the connected MCP servers (`Github-sukaina`, `Supabase-sukaina`). Standing rules:

- **Never write a secret into this file or any committed file.** Secret *values* live ONLY in
  the VPS `/opt/labbrain/.env` (gitignored, chmod 600). This file records *names + non-secret
  facts* only. The `secret-scanner` hook is the backstop.
- **Never push directly to `main`; never merge a PR without explicit founder authorization
  naming the PR.** Work goes via feature branch → PR. Never force-push / hard-reset / delete
  branches without explicit instruction.
- **Production DB DDL requires explicit founder authorization** per change set (the auto-mode
  classifier enforces this; do not route around it).

### Production Supabase (the live database — EU residency honored)

| Field | Value |
|-------|-------|
| Project name | `labbrain-prod-eu` |
| Project ref | `elbsrrtbstxtudnbpvzw` |
| Region | `eu-central-1` (Frankfurt) — satisfies the data-residency contract |
| API URL | `https://elbsrrtbstxtudnbpvzw.supabase.co` |
| Publishable key (public) | `sb_publishable_zpcyJNqnPtegCNh7kZCWhg_inbaQbZl` |
| Service-role secret | **NOT here** — VPS `.env` only (`SUPABASE_SERVICE_ROLE_KEY`); from dashboard → API keys |
| Migrations | `0001`–`0016` applied (15 schema + `0016` definer-grant lockdown) |

The old `eftjsgoaepjcmzduuddy` (Sydney / `ap-southeast-2`) project is **abandoned** (partial
schema, violated EU residency) and is being deleted by the founder. Do not use it.

### Secret inventory (names only — values in VPS `.env`)

`SUPABASE_SERVICE_ROLE_KEY` · `LLAMAPARSE_API_KEY` · `OPENAI_API_KEY` · `RESEND_API_KEY` ·
`RESEND_FROM_EMAIL` · `PLATFORM_ADMIN_EMAILS` · payment rail (`TAP_SECRET_KEY` or Stripe set).

**Founder-gated, still outstanding:** rotate the GitHub PAT, Contabo API secret, and server
root password (all were pasted in chat earlier — treat as compromised, rotate post-launch).

---

**Global precedence:** the global playbook lives at `~/.claude/CLAUDE.md`. This project `CLAUDE.md` overrides global when they conflict. If a rule is missing here, fall through to global.

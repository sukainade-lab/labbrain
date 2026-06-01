# LabBrain

Bilingual Arabic/English document intelligence for ISO/IEC 17025 (JISM-accredited) labs. Every answer is pulled from the lab's own uploaded documents, with the document name and page cited. Zero hallucination, mandatory source citation — this is the product's safety contract.

- **Strategy / source of truth:** [`EO-Brain/`](EO-Brain/) (phases 0–4)
- **Spec:** [`architecture/brd.md`](architecture/brd.md) — 5 Weekend-MVP stories (S1–S5), 31 ACs; 11 Phase-2 stories (S6–S16)
- **Stack decision:** [`architecture/tech-stack-decision.md`](architecture/tech-stack-decision.md)
- **Project rules for Claude Code:** [`CLAUDE.md`](CLAUDE.md)
- **Progress tracker:** [`_dev-progress.md`](_dev-progress.md)

## Stack

Next.js 14 (App Router, TS) · Tailwind + RTL · Supabase (Postgres + pgvector + Auth + Storage, Frankfurt) · LlamaParse · OpenAI GPT-4o-mini (+Claude fallback) · Resend · **Stripe** (payments) · Sentry + PostHog. **SaaSfast mode: M3.**

## Local development

```bash
npm install
cp .env.example .env.local   # then fill values — see docs/env-contract.md
npm run db:migrate           # apply supabase/migrations (needs Supabase project + CLI)
npm run dev                  # http://localhost:3000
```

Health check: `GET /api/health` → `{ "status": "ok", "version": "1.0.0", "uptime_seconds": N }`.

## Tests

```bash
npm run test    # vitest — placeholder @AC-N.N stubs (.skip) until implemented per story
```

Every acceptance criterion in the BRD has a matching `@AC-N.N` test. The `brd-traceability` gate enforces coverage.

## Deploy — Contabo VPS (Germany / EU)

EU region preserves data residency (Supabase Frankfurt + Contabo Germany). Reverse proxy is Caddy (auto Let's Encrypt SSL); the app runs under PM2 via docker-compose.

`deploy.sh` (to be authored in S5) pulls latest code, builds, and reloads with zero downtime:

```bash
# on the Contabo VPS
git pull
docker-compose build
pm2 reload labbrain        # or: docker-compose up -d
```

Caddy routes the custom domain → Next.js on port 3000. See [`architecture/brd.md`](architecture/brd.md) S5 (AC-5.1…5.7) for the full deploy/observability/compliance contract.

## Payments note

Payments use **Stripe** (founder decision). Stripe does not onboard Jordan-registered businesses and JOD is not a standard Stripe settlement currency — this assumes a Stripe entity in a supported country. JOD bank transfer + invoice is retained as a fallback. See [`docs/env-contract.md`](docs/env-contract.md) and `architecture/tech-stack-decision.md`.

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

EU region preserves data residency (Supabase Frankfurt + Contabo Germany). The app runs as a Next.js standalone container; Caddy is the reverse proxy with automatic Let's Encrypt SSL. Both run via `docker-compose.yml`.

**Files:** [`Dockerfile`](Dockerfile) (standalone build) · [`docker-compose.yml`](docker-compose.yml) (app + caddy) · [`Caddyfile`](Caddyfile) (TLS + proxy → `:3000`) · [`deploy.sh`](deploy.sh) (zero-downtime roll).

### First-time VPS setup

```bash
# on the Contabo VPS (Ubuntu, Germany region)
sudo apt-get update && sudo apt-get install -y docker.io docker-compose-plugin git
git clone https://github.com/sukainade-lab/labbrain.git && cd labbrain
cp .env.example .env            # fill production values — see docs/env-contract.md
export LABBRAIN_DOMAIN=app.labbrain.example   # the domain Caddy serves + SSLs
docker compose up -d            # builds app, starts caddy; SSL auto-provisions
```

### Subsequent deploys

```bash
# on the VPS, from the repo root
./deploy.sh
```

`deploy.sh` pulls `main`, rebuilds the app image, rolls it with `--wait` (Caddy keeps serving the old container until the new one passes its healthcheck), reloads Caddy, then curls `/api/health` and rolls back on failure.

Caddy routes `LABBRAIN_DOMAIN` → Next.js on port 3000 with auto-renewing TLS. The container `HEALTHCHECK` and `deploy.sh` both probe the AC-5.1 health endpoint.

> **Note:** the live deploy is founder-gated — the infra above is verified by config tests (`tests/story-5-deploy.test.ts`); running it against the production VPS requires the founder's go-ahead and a populated `.env`.

## Observability & analytics

- **Sentry** (`@sentry/nextjs`) — DSN-guarded init in [`src/instrumentation.ts`](src/instrumentation.ts) (server/edge) and [`src/instrumentation-client.ts`](src/instrumentation-client.ts) (browser). With no `NEXT_PUBLIC_SENTRY_DSN` (local/CI) it stays inert. Handled errors flow through the single `captureError` seam ([`src/lib/observability/log.ts`](src/lib/observability/log.ts)); every event is tagged with `tenant_id` once the request's tenant is resolved.
- **PostHog** — server-side capture over the public HTTP endpoint ([`src/lib/analytics/posthog-server.ts`](src/lib/analytics/posthog-server.ts)), no SDK dependency. Events are built by the PII-free builders in [`src/lib/analytics/events.ts`](src/lib/analytics/events.ts): `signup_completed`, `document_uploaded` (mime_type only), `question_asked` (found_answer + lang), `invoice_requested` (anonymous). No email, name, lab name, filename, or question text is ever sent.

See [`architecture/brd.md`](architecture/brd.md) S5 (AC-5.1…5.7) for the full deploy/observability/compliance contract.

## Payments note

Payments use **Stripe** (founder decision). Stripe does not onboard Jordan-registered businesses and JOD is not a standard Stripe settlement currency — this assumes a Stripe entity in a supported country. JOD bank transfer + invoice is retained as a fallback. See [`docs/env-contract.md`](docs/env-contract.md) and `architecture/tech-stack-decision.md`.

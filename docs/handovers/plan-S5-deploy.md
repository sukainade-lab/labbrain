# Plan — S5: Deploy, Health & Observability

> `/2-eo-dev-plan story-5` · 2026-06-02 · branch `feat/s5-deploy` (cut off `main`, carries the S4-shipped tracker bookkeeping for committing on-branch, not on main).
> Last Weekend-MVP story. Closes loops: **deploy · observability · compliance**.

## BRD ACs

| AC | Requirement | Delivery |
|----|-------------|----------|
| AC-5.1 | `GET /api/health` → 200 `{status:"ok",version:"1.0.0",uptime_seconds:N}`, <200ms | Already implemented; add route-handler test (L1) |
| AC-5.2 | Contabo VPS deploy via `docker-compose up -d`; one `deploy.sh` zero-downtime (PM2 reload); documented in README | Config + runbook authored & verified; **live execution founder-gated** (needs VPS/domain/SSH) |
| AC-5.3 | Caddy reverse proxy: auto Let's Encrypt SSL → Next.js `:3000`; custom domain in Caddy config | `Caddyfile` + compose service |
| AC-5.4 | Sentry init from `NEXT_PUBLIC_SENTRY_DSN`; capture uncaught errors + rejections; each event scoped with `tenant_id` | `instrumentation.ts` + client config; `captureError` seam → `Sentry.captureException`; `setSentryTenant` helper |
| AC-5.5 | PostHog tracks `signup_completed`, `document_uploaded`, `question_asked{found_answer,lang}`, `invoice_requested`; **no PII** | Pure typed event builders (unit-tested no-PII) + lazy server capture seam, wired to 4 real call-sites |
| AC-5.6 | `.env.example` all var names (no values); README documents each source | Completeness test + README/env-contract docs |
| AC-5.7 | RLS enabled on 7 tables with **named** policies, tested in a seed script | Live `pg_policies` assertion test (runs in CI integration job) |

7 tables (AC-5.7): `tenants`, `users`, `documents`, `document_chunks`, `queries`, `subscriptions`, `invitations`.

## Approach (TDD red→green→blue)

1. **AC-5.1 health** — `tests/story-5-health.test.ts`: handler returns the exact shape, status 200, numeric `uptime_seconds`, `version` from one constant. (Route already exists from scaffold.)
2. **AC-5.5 PostHog** —
   - `lib/analytics/events.ts`: pure builders → `{ event, distinctId, properties }`. `distinctId` = user/tenant id only. **No PII** (no email, name, lab name, question text, filename). `question_asked` carries `found_answer:boolean` + `lang:"ar"|"en"`; `document_uploaded` carries non-PII metadata only (e.g. mime/page count, not filename).
   - `lib/analytics/posthog-server.ts`: lazy `posthog-node` client; `captureEvent(builderResult)` no-ops when `NEXT_PUBLIC_POSTHOG_KEY` absent (build/test safe).
   - Wire the 4 call-sites: signup route (`signup_completed`), documents route (`document_uploaded`), qa route (`question_asked`), invoice-request route (`invoice_requested`). **L4: confirm each fires from its real handler.**
   - Tests: builder unit tests (names, shapes, no-PII assertions); route tests assert the capture seam is invoked with the right builder.
3. **AC-5.4 Sentry** — `instrumentation.ts` (nodejs + edge runtimes) + client init; point `lib/observability/log.ts#captureError` at `Sentry.captureException(err,{tags:{scope}})`; `setSentryTenant(tenantId)` helper (`Sentry.setTag('tenant_id', …)`), called where tenant resolves (server client / proxy). Unit-test the helper + captureError wiring via a mocked `@sentry/nextjs`. No `SENTRY_AUTH_TOKEN` in CI.
4. **AC-5.7 RLS compliance** — `tests/story-5-rls.test.ts` (live, `skipIf(!hasLiveSupabase)`): for each of the 7 tables assert `relrowsecurity = true` and ≥1 **named** policy in `pg_policies`. Serialized; runs in CI integration job.
5. **AC-5.2 / 5.3 deploy infra** — `Dockerfile` (multi-stage, Next standalone), `docker-compose.yml` (app + caddy services, app on `:3000`, healthcheck hitting `/api/health`), `Caddyfile` (domain placeholder, auto-TLS, reverse_proxy app:3000), `deploy.sh` (`git pull` → `npm ci` → `npm run build` → `pm2 reload ecosystem` zero-downtime; compose path documented). README "Deploy to Contabo" runbook. Verified for correctness; live deploy is founder ops.
6. **AC-5.6 env contract** — `tests/story-5-env-contract.test.ts` asserts every required name present in `.env.example`; extend README + `docs/env-contract.md` with per-var source.
7. **CI integration job** — add `integration` to `.github/workflows/ci.yml` per `docs/backlog/S5-ci-integration-db.md` (Supabase CLI `supabase start`, export env, `npm run test -- --no-file-parallelism`, `supabase stop`). Keep fast `quality` job separate. **L2/L3: serialized; confirm 3 green runs.**

## Risks / unknowns

- **Live deploy not executable here** — no VPS/domain/SSH. AC-5.2/5.3 ship as verified config + runbook; real `docker-compose up` + live `/api/health` 200 is founder-executed. Score honestly; do not fake a green deploy.
- **`posthog-node` new dep** — server-only, lazy, no-ops without key. Bundle-justified.
- **Sentry in CI** — init only, no auth token; build must succeed without it.
- **New `integration` CI job flake risk** — `--no-file-parallelism` mandatory (L2); watch 3 runs (L3).
- **No-PII rule is the load-bearing compliance check** — assert it in tests, not just by inspection.

## MENA checks
Light-touch — infra + provider inits, negligible net-new UI. `arabic-rtl-checker` / `mena-mobile-check` only confirm no regression (client SDK init adds no visible chrome). The AC-5.5 no-PII contract is the real compliance gate.

## Out of scope (Phase-2 / founder ops)
- Executing the deploy against real Contabo hardware (founder ops; runbook provided).
- Sentry source-map upload (optional, founder-side auth token).
- Alerting/on-call routing beyond Sentry default (v2).

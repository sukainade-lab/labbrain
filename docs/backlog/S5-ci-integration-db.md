# S5 backlog — Run live integration suites against a real Supabase in CI

> Status: **designed, not implemented.** Implement in S5 (deploy + observability + CI-infra),
> after S3 (PR #3) merges so `main` carries the hardened `ci.yml`.
> Author: solution-architect pass, 2026-06-01. See lessons L2 + L3.

## Problem (P0 coverage gap)

LabBrain's P0 safety contract is **tenant isolation** — Lab A must never retrieve Lab B's
chunks (AC-1.3, AC-2.4, AC-3.2). That contract is enforced by Postgres RLS + the
security-definer `match_document_chunks` RPC + Supabase Auth sessions, and is covered by
**live** integration suites:

- `tests/story-1-auth.test.ts`, `tests/story-1-auth-routes.test.ts`
- `tests/story-2-upload.test.ts`, `tests/story-2-documents-routes.test.ts`, `tests/story-2-helpers.test.ts`
- `tests/story-3-qa.test.ts` (incl. cross-tenant P0 + empty-corpus)

**These never run in CI.** They self-skip via `describe.skipIf(!hasLiveSupabase)` because the
runner has no `.env.local` and no database. CI today validates lint/build/unit/audit but
**not** the product's most important guarantee. S1 + S2 shipped with this blind spot.

## Proposed design (ready to implement)

Add an `integration` job to `.github/workflows/ci.yml` alongside `quality`. A real local
Supabase stack is required (not bare Postgres+pgvector) because the suites call GoTrue
`signUp` + RLS + security-definer RPCs.

```yaml
  integration:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - uses: supabase/setup-cli@v1
        with: { version: latest }
      - name: Start Supabase (applies migrations 0001-0004)
        run: supabase start
      - name: Export Supabase env for tests
        run: |
          supabase status -o env > sb.env
          echo "NEXT_PUBLIC_SUPABASE_URL=$(grep '^API_URL=' sb.env | cut -d= -f2- | tr -d '\"')" >> "$GITHUB_ENV"
          echo "NEXT_PUBLIC_SUPABASE_ANON_KEY=$(grep '^ANON_KEY=' sb.env | cut -d= -f2- | tr -d '\"')" >> "$GITHUB_ENV"
          echo "SUPABASE_SERVICE_ROLE_KEY=$(grep '^SERVICE_ROLE_KEY=' sb.env | cut -d= -f2- | tr -d '\"')" >> "$GITHUB_ENV"
      - name: Live integration tests (serialized — shared DB)
        run: npm run test -- --no-file-parallelism
      - name: Stop Supabase
        if: always()
        run: supabase stop
```

## Design notes / constraints

- **Serialize the live run** (`--no-file-parallelism`). Vitest parallelizes files by
  default and all live suites share one Supabase instance → seed/cleanup races. (Lesson L2.)
- Local Supabase demo anon/service keys are public, non-secret local-dev constants;
  extracting them via `supabase status -o env` is robust to default changes. **No real
  secrets in CI.**
- The live suites mock `@/lib/ai/embeddings` + `@/lib/ai/answer`, so **no OpenAI/LlamaParse
  keys and no external AI calls** are needed.
- Confirm `supabase start` applies migrations on a fresh CI DB (it does). The match RPC
  `grant execute … to authenticated` (migration `0004_qa.sql`) must be present for AC-3.2.
- Keep `quality` (lint/build/audit + fast self-skipping unit run) separate so the fast gate
  stays fast; `integration` is the authoritative live gate.

## Why S5, not now

BRD scopes deploy + observability + CI-infra to **S5**. Doing this mid-S3 would jump the
build sequence and force a `ci.yml` conflict with PR #3 (which carries the audit/test
hardening on `feat/s3-qa`). Implement after S3 merges and `main` carries the hardened
`ci.yml`.

## Acceptance

- [ ] `integration` job runs all live suites against a real Supabase in CI
- [ ] Live run is serialized; 3 consecutive runs are green (no flake)
- [ ] Cross-tenant P0 (AC-1.3 / AC-2.4 / AC-3.2) executes (not skipped) and passes in CI
- [ ] No real secrets added to the repo or workflow

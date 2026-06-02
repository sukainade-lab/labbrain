# Runbook — First production cutover (Amman pilot)

> **Goal:** get LabBrain in front of **one real Amman lab** on a Contabo VPS, the
> fastest safe path. Everything here is **founder-executed** — it depends on the VPS,
> the prod Supabase project, the domain, and real secrets, none of which live in this
> repo or this agent's reach. The agent has verified the infra (`Dockerfile`,
> `docker-compose.yml`, `Caddyfile`, `deploy.sh`, `docs/env-contract.md`) and migrations
> `0001–0014`; this runbook sequences the parts only you can run.
>
> **Scope decision (deliberate):** pilot = **single Amman lab · JOD · cloud inference ·
> Stripe/Tap one rail.** Defer everything the first lab doesn't need: KSA/me-central-1
> (`KSA_*`, S10), air-gap/on-prem (`AIRGAP_*` / `OLLAMA_*` / `LLAMAPARSE_BASE_URL`, S11),
> and the KWD/SAR `TAP_PRICE_*` points. Add those only when a customer needs them.

---

## Phase 0 — Security gate (do first, unrelated to the deploy)

- [ ] **Rotate the GitHub PAT for `sukainade-lab`.** It was pasted in plaintext and is
  still live (#1 standing risk). GitHub → Settings → Developer settings → fine-grained
  tokens → revoke the exposed one → issue a new one scoped to `labbrain` (Contents RW,
  Pull requests RW, Checks Read, Actions Read, Metadata Read) → `gh auth login` to
  re-auth locally. **Never** put the token in a file or a git remote URL.
- [ ] Decide the `.claude/settings.json` SessionStart hook (auto-load lessons): approve
  it explicitly, or leave it denied. It does not block the deploy.

---

## Phase 1 — Migration dry-run (de-risk the 14-at-once first apply)

The 14 migrations (`0001_init` … `0014_document_versioning`) have only ever run
**locally, one at a time, as each story was built.** Production will replay all 14 in
sequence for the first time. Prove they apply cleanly against a throwaway target before
touching the real project.

- [ ] Create a **temporary** Supabase project (or a `supabase branch`) in **Frankfurt
  (EU)** — not the one you'll keep.
- [ ] From a trusted machine:
  ```
  supabase link --project-ref <throwaway-ref>
  supabase db push           # applies supabase/migrations/0001..0014 in order
  ```
- [ ] Confirm: zero errors; `pgvector` extension present; the HNSW index on
  `document_chunks` exists; every multi-tenant table has its **named** RLS policy
  (`tenant_isolation_*`); the `branding` storage bucket exists (0013); the
  `replace_document_chunks` RPC exists with `security definer` + `service_role` grant (0014).
- [ ] Run `get_advisors` (security + performance lints) → resolve any **error**-level
  finding before prod. Note warnings.
- [ ] **Delete the throwaway project/branch.** Its only job was to prove the sequence.

> The agent **cannot** run `supabase db push` against a remote project (classifier-denied
> by policy — prod writes are founder-only). These commands are yours to run.

---

## Phase 2 — Provision the production database (Supabase Frankfurt)

- [ ] Create the **keep** Supabase project in **Frankfurt (EU)** — data-residency
  requirement (accounts, files, vectors, query logs stay in EU; KSA/PDPL is a later
  migration, S10).
- [ ] Apply the schema (same commands as Phase 1, against the **prod** ref). Set this as
  the source of truth for `MIGRATIONS_APPLIED=1` later.
- [ ] In **Auth settings**: confirm email confirmations / magic-link sender are set, and
  the Site URL = your prod domain (so confirmation links resolve).
- [ ] Re-run `get_advisors` against prod → no error-level findings.

---

## Phase 3 — Minimum env for the pilot

Copy `.env.example` → `.env` **on the VPS** and fill **only** the rows below. Full
sourcing notes for every variable are in `docs/env-contract.md`. `.env` is never
committed.

**Required for the pilot:**

| Variable | Value / source |
|----------|----------------|
| `APP_URL` | `https://<your-domain>` |
| `LABBRAIN_DOMAIN` | `<your-domain>` (Caddy reads this for auto-SSL; compose env) |
| `NEXT_PUBLIC_SUPABASE_URL` | prod project → Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | prod project → Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | prod project → Settings → API (**server-only**) |
| `OPENAI_API_KEY` | platform.openai.com (cloud inference — the default mode) |
| `LLAMAPARSE_API_KEY` | cloud.llamaindex.ai (document parsing) |
| `RESEND_API_KEY` + `RESEND_FROM_EMAIL` | resend.com (welcome / transactional email; verified sender) |
| `MFA_COOKIE_SECRET` | `openssl rand -base64 32` (S7 — OTP hash + elevation cookie) |
| `PLATFORM_ADMIN_EMAILS` | your founder sign-in email (the **entire** `/founder` gate) |
| **Payment rail — pick the one matching the lab's currency:** | |
| → JOD (Amman default): `TAP_SECRET_KEY` | dashboard.tap.company (JOD needs no price env) |
| → or Stripe: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_PRICE_{STARTER,PRO}_{MONTH,YEAR}` | dashboard.stripe.com |
| `INVOICE_REQUEST_TO` | your sales inbox (bank-transfer invoice fallback) |

**Strongly recommended (observability — you're flying blind without it on a first lab):**

| `NEXT_PUBLIC_SENTRY_DSN` | sentry.io |
| `NEXT_PUBLIC_POSTHOG_KEY` + `NEXT_PUBLIC_POSTHOG_HOST` | posthog.com (use **EU** host for residency) |

**Already handled — do NOT set:**
- `PUPPETEER_EXECUTABLE_PATH` — baked into the image (`/usr/bin/chromium-browser`, Dockerfile).
- `NODE_ENV=production` — set by the image.

**Leave UNSET for the pilot (add only when a customer needs them):**
- `KSA_SUPABASE_URL`, `KSA_SUPABASE_SERVICE_KEY` (S10 — KSA lab).
- `INFERENCE_MODE`/`OLLAMA_*`/`AIRGAP_*`/`LLAMAPARSE_BASE_URL` (S11 — leaving `INFERENCE_MODE`
  unset = cloud default; setting it to `airgap` makes 5 vars required and fails closed).
- `TAP_PRICE_*` (only KWD/SAR labs), `UNIFONIC_*` (only if SMS-2FA on at launch),
  `DEMO_VIDEO_URL` (falls back to `${APP_URL}/demo`).

---

## Phase 4 — VPS bootstrap

- [ ] DNS: point an **A record** for `<your-domain>` at the Contabo VPS IP. Confirm it
  resolves before deploying (Caddy needs it to issue the Let's Encrypt cert).
- [ ] On the VPS: install `docker` + the `docker-compose` plugin.
- [ ] Clone the repo, `git checkout main`, place the filled `.env` at the repo root.
- [ ] Open ports **80** and **443** (Caddy). The app port 3000 stays internal (compose
  `expose`, not `ports`).

---

## Phase 5 — Deploy

- [ ] The schema is already applied (Phase 2), so authorize the deploy guard:
  ```
  MIGRATIONS_APPLIED=1 ./deploy.sh
  ```
  `deploy.sh` will: `git pull --ff-only`, tag the current image for rollback, build,
  roll with zero downtime (`--wait` for health), reload Caddy, then poll
  `/api/health` 10×. On failure it **auto-rolls back** to the previous image.
- [ ] First-ever deploy has no prior image → no rollback target; if it's unhealthy, fix
  and re-run (the script says so explicitly).
- [ ] Confirm Caddy issued a valid TLS cert (`https://<domain>` padlock, no warning).

---

## Phase 6 — Smoke test the real product loop (not just "is it up")

Health 200 ≠ working product. Walk the actual ICP path against prod:

- [ ] **Sign up** a new lab; confirm the email/magic-link arrives and resolves.
- [ ] **Upload a real ISO 17025 SOP** (Arabic, with page numbers); confirm it reaches
  `ready` (parse → index) — watch for LlamaParse / embedding errors in logs.
- [ ] **Ask a question** answerable from that SOP; confirm the answer is **grounded with a
  citation block** (`📄 [Document] — الصفحة N`).
- [ ] **Ask something NOT in any document**; confirm the **"not found"** message (no
  hallucinated ISO clause — this is the P0 product-safety contract).
- [ ] **Cross-tenant check:** with a second lab, confirm it cannot retrieve the first
  lab's chunks (the RLS + pre-filter guarantee, AC-1.3/2.4).
- [ ] **Payment:** run one checkout in the rail's **test mode**; confirm the webhook
  activates the subscription and the dashboard counters update.
- [ ] **Founder panel:** sign in with a `PLATFORM_ADMIN_EMAILS` address → `/founder`
  loads; pause/activate works.
- [ ] Confirm **Sentry** receives a test error and **PostHog** receives events.
- [ ] Verify at **375px** (the WhatsApp-demo viewport) on a real phone — RTL, tap targets.

---

## Abort / rollback criteria

- Any smoke-test step in Phase 6 that breaks the **product-safety contract** (ungrounded
  answer, missing citation, cross-tenant leak) → **abort the pilot**, don't hand the link
  to the lab. These are P0.
- Unhealthy build → `deploy.sh` auto-rolls back; investigate from logs before retrying.
- Migration error in Phase 1/2 → stop; do **not** push a partial schema to prod.

---

## After a successful cutover

- [ ] Record the live URL + deploy commit in `_dev-progress.md` and flip the S5 row's
  "live Contabo cutover deferred" note to shipped-live.
- [ ] Now backlog priority is driven by **what the pilot lab actually asks for** —
  re-rank S14–S16 against real feedback rather than the pre-built order.

---

*Standing founder-gated items remain: PAT rotation (Phase 0), the SessionStart hook
decision, and — for a KSA lab later — the AWS me-central-1 cutover (S10) which reuses the
`MigrationTarget` seam and the `KSA_*` env. This runbook intentionally excludes them.*

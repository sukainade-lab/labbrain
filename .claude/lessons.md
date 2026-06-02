# Lessons — LabBrain

Last pruned: 2026-06-02 (Sprint 2 retro — 0 archived, 0 pruned; all lessons <90d)

## Active lessons

### L1 — Test the HTTP seam, not just the functions behind it (2026-06-01, S1)
**Trigger:** S1 review found invite-mode signups always 400'd — the form posted
`labName: "—"` (1 char) which failed `signupSchema.min(2)` before reaching
`provisionSignup`. Every test called `provisionSignup`/schemas **directly**, so
the form↔schema↔route wiring was never exercised and the bug slipped to review.
**Rule:** for any story with API routes, include at least one test that POSTs to
the actual route handler for each branch (success + each error status). Direct
unit tests on the logic layer are necessary but not sufficient.
**Effect on scoring:** QA hat capped at 8 until a story has route-handler
integration coverage for its primary flows.
**Satisfied for S1 (2026-06-01):** `tests/story-1-auth-routes.test.ts` now POSTs
to every S1 route handler — signup (new-lab/invite/duplicate/seat-limit/bad-body),
invitations (401/403/201/402), login (200/401/400), forgot (200×2), logout (200).
16 route tests. The cap no longer applies to S1; it remains active for new stories.

### L2 — Live DB suites must be serialized; they share one Supabase (2026-06-01, S3)
**Trigger:** the live integration suites (`story-1-auth`, `story-2-*`, `story-3-qa`)
all seed/cleanup against a single shared Supabase instance. Vitest runs test files
in parallel by default (no `pool`/`fileParallelism` config), so concurrent seeding
and `afterAll` cleanup across suites can race — a flaky-CI hazard the moment these
suites actually run in a runner (today they self-skip in CI for lack of `.env.local`).
**Rule:** any CI job that runs the live suites must disable file parallelism
(`vitest run --no-file-parallelism`, or `poolOptions.*.singleFork`). Each suite must
also scope its seed data to a unique tenant/user and clean up in `afterAll`, never
assuming an empty DB. Don't rely on luck from self-skipping to hide the race.
**Effect on scoring:** when the CI-DB job lands (S5), QA hat capped at 8 for any
story whose live suite runs unserialized against the shared instance.

### L3 — Verify the CI pipeline is green; never assume local gates == CI (2026-06-01, S3)
**Trigger:** S1 and S2 were merged with a **red** CI Quality Gate. Root cause: the
`Audit` step ran `npm audit --audit-level=high` over *all* deps and died on a
dev-only esbuild/vitest critical that never ships to production; the `Test` step
soft-failed (`npm run test || echo …`) so tests couldn't block a merge. Local gates
passed, so the red CI went unnoticed across two ships.
**Rule:** before declaring a story ship-ready, confirm the actual CI run is green
(`gh run list --branch <b>` → success), not just local `npm run build/test/lint`.
Audit gates on production-runtime deps (`--omit=dev`); the test step is a hard gate,
never soft-failed. Fixed in `feat/s3-qa` (`fd96333`); lands on `main` with PR #3.
**Effect on scoring:** Architecture hat capped at 8 for any story shipped without a
confirmed-green CI run on its PR.

### L4 — Review must walk the user-reachable end-to-end path, not audit files in isolation (2026-06-01, S4)
**Trigger:** S4's `/4-eo-review` passed clean (no 🔴) — every file was correct on its
own: `createCheckoutSession`, `POST /api/checkout`, the webhook handlers, the price
map all audited fine. But `/5-eo-score` Product hat hit **6**: the pricing CTA still
linked to `/signup` and *nothing in the app POSTed to `/api/checkout`*. The money loop
existed file-by-file with no caller — a dead end no per-file audit caught, because each
file was individually valid. Sibling to L1 (test the HTTP seam), but for the review gate.
**Rule:** in `/4-eo-review`, for any story that delivers a user flow, trace the path a
real user takes click-by-click (CTA → handler → effect) and confirm each hop has a
caller. Grep that every new API route has at least one UI/caller reference. A file that
compiles and tests green can still be unreachable; "wired end-to-end" is a distinct check
from "each file is correct."
**Effect on scoring:** Product hat capped at 8 for any story whose primary user flow has
an orphaned step (a route/handler with no caller, or a CTA that doesn't reach it).

### L5 — Wrap dynamic mixed-script values in `<bdi>` from first implementation (2026-06-02, retro S1–S5)
**Trigger:** the UX hat scored 8 on first-pass `/5-eo-score` **twice** for the same
root cause — dynamic, mixed Arabic/Latin content rendered without BiDi isolation:
S2 document filenames (Arabic SOP names with embedded Latin/numbers mis-ordered) and
S4 dashboard counters + plan badge (Latin plan names / digits mis-ordered inside the
RTL flow). Each fix was mechanical (`<bdi>…</bdi>`) but cost a bridge round-trip.
**Rule:** any value rendered into RTL layout that can contain Latin script, digits,
or technical terms — filenames, plan names, counts, ISO clause numbers, units,
accreditation-body names, user-entered text — must be wrapped in `<bdi>` (or carry
`unicode-bidi: isolate`) the first time it's written, not retrofitted at review. Static
Arabic labels don't need it; dynamic/user/data-derived strings do.
**Effect on scoring:** UX hat capped at 8 for any story that renders dynamic
mixed-script content into RTL without BiDi isolation.

### L6 — Never write a real-looking secret prefix in example/doc/test files (2026-06-02, S6)
**Trigger:** S6's `.env.example` Tap comment used a literal `sk_live_…` to illustrate
the key shape. The S5 leak-guard test (`/sk_live_|whsec_[A-Za-z0-9]|sb_secret_|pk_live_/`)
matched the **prefix itself** and reddened the whole suite at `/5-eo-score` time, even
though nothing real was leaked — the string was documentation. The scanner can't
distinguish "illustrative prefix" from "real key," and neither can a reviewer skimming
a diff. Caught by an existing test before scoring; fixed by rewording to `sk_…`.
**Rule:** in `.env.example`, `docs/`, code comments, and test fixtures, never write a
real-looking secret **prefix** — `sk_live_`, `sk_test_`, `whsec_`, `pk_live_`,
`sb_secret_`, `Bearer eyJ…`, etc. Use an abstract placeholder shape instead (`sk_…`,
`<tap-secret-key>`, `whsec_REDACTED`). Real secrets live only in gitignored `.env.local`.
**Effect on scoring:** Engineering hat capped at 8 for any story whose tracked files
contain a literal secret prefix, even in documentation/comment context.

### L7 — UI stories must cite a manual 375px + axe-core walk as verification evidence (2026-06-02, Sprint 3 retro; pattern S6 + S7)
**Trigger:** QA scored 9 on first pass for **both** S6 and S7 — the *same* root cause
each time: verification was automated/CI-only, with no manual 375px mobile walk and no
axe-core accessibility pass cited as PR/score evidence. Both score reports listed
"capture a manual 375px + axe walk" as a deferred gap. The automated suite proves logic
and route behavior, but the MENA mobile + a11y promise (375px WhatsApp-demo viewport,
RTL, ≥44px targets) is only ever asserted in code, never observed.
**Rule:** any story that ships or changes UI must cite a manual verification walk in its
PR / score evidence: (a) render at 375px and confirm layout + tap targets, (b) run
axe-core (or equivalent) and record zero serious/critical violations. A screenshot or a
one-line "375px + axe: clean" note in the PR satisfies it. Automated component/route
tests are necessary but do not substitute for the observed walk.
**Effect on scoring:** QA hat capped at 9 for any UI story with no cited manual 375px +
axe-core verification. (Caps at 9, not 8 — an evidence/polish gap, less severe than L1's
missing route coverage.)

## Archived lessons

None.

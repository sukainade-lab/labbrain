# Seeded-session axe-walk harness

> QA infra from the Sprint 6 retro (`docs/retros/2026-06-02-sprint6-s10.md`).
> Makes the **lesson L7** live a11y walk on auth/role-gated surfaces a one-liner.

## Why it exists

**L7** caps QA at 9 for any UI story whose a11y verification is *static* (computed
contrast + tap-target audit) rather than a live **375px + axe-core** walk on the
new surface. On gated surfaces (`/admin`, `/founder`) the live walk was expensive
to stand up by hand — you must seed a session, render real tenant rows, and drive
a browser — so it kept getting deferred to static. That cost S10 its QA point
(the founder migration tab lives on `/founder`).

This harness removes the friction: it seeds a privileged session, signs in
through the **real** login form, and runs axe-core at a 375px viewport against the
gated surfaces. Run it during `/4-eo-review` so every gated-UI story clears L7
with a real walk.

## What it is / isn't

- **Local, opt-in.** It is **not** part of `npm test` and never runs in CI (CI has
  no Chromium and no seeded session). The standing CI a11y gate remains the static
  contrast guard, `tests/a11y-button-contrast.test.ts`.
- Drives a real browser via **puppeteer-core** (already a dep — the PDF render
  seam uses it) against your locally-running dev server. It seeds its own
  user + tenant via the service-role key and cleans them up afterward.

## Prerequisites

1. Local Supabase up + `.env.local` populated:
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`, `PLATFORM_ADMIN_EMAILS`.
2. The app running: `npm run dev` (default `http://localhost:3000`).
3. A local Chrome/Chromium. Set `PUPPETEER_EXECUTABLE_PATH` (or `CHROMIUM_PATH`),
   else the harness probes the usual OS install paths.

## Usage

```bash
npm run axe:walk                       # walk the default gated routes
npm run axe:walk -- /admin /founder    # walk specific routes
npm run axe:walk -- --keep             # don't delete the seeded user/tenant
npm run axe:walk -- --headed           # show the browser (debug)
APP_URL=http://localhost:3001 npm run axe:walk
```

Default routes: `/dashboard`, `/admin`, `/founder`.
Tags: `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`.

## How the seeded session reaches `/founder`

The founder gate is the `PLATFORM_ADMIN_EMAILS` env allowlist (no DB role —
`src/lib/auth/platform-admin.ts`). The harness reads the **same** allowlist the
server reads and seeds the first `.test` address on it (default
`founder@labbrain.test`) as an `owner`. That one user therefore reaches
`/dashboard` (auth), `/admin` (owner) **and** `/founder` (allowlist). The `.test`
guard means the harness only ever creates/deletes throwaway accounts — never a
real founder login.

## Exit codes

| Code | Meaning |
|-----:|---------|
| 0 | Every route clean — 0 violations |
| 1 | axe-core violations found (details printed per node) |
| 2 | Setup error — app unreachable, no Chromium, missing env, or a gated route bounced to `/login`/`404` (so the walk would have graded the wrong page) |

The setup-error guard (code 2) is deliberate: a gated route that redirects to
`/login` or 404s must **not** be silently reported as "0 violations" — that would
be a false pass on the wrong page.

## Baseline (2026-06-02, `main` @ post-#19)

```
✓ /dashboard   0 violations · 19 passes
✓ /admin       0 violations · 25 passes
✓ /founder     0 violations · 20 passes
```

`/founder` is the exact surface (S10 migration tab) that took the L7 cap on a
static walk — now verified clean by a real one.

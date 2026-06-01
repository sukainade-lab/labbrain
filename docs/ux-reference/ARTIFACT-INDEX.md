# UX Reference Artifacts

These are the UX ground truth from EO-Brain Phase 5. Use them as the target for any UI work. `/2-eo-dev-plan` reads them when planning visual features; `/4-eo-review` UX hat compares rendered components against these. A component shipped that doesn't match its artifact → UX hat Q1 drops.

**Project:** LabBrain — ISO 17025 Document Intelligence, MENA. Generated 2026-05-30.

| Artifact | Covers BRD stories | Loops | What to match |
|----------|--------------------|-------|---------------|
| `product-demo.jsx` | S2, S3 | domain | Core Q&A workflow: document library tab (upload list, status badges) + Q&A tab (Arabic/English question → cited answer with document name, section, page). Bilingual input detection, citation badge design, "not found" state. |
| `onboarding-flow.jsx` | S1, S4 | auth, money | 4-step signup wizard: create account → email verification → plan selection (Starter 35 JOD / Pro 70 JOD) → checkout. **Note (override):** money loop is now **Stripe Checkout**; the invoice-request screen in this mockup becomes the *fallback* path, not the primary one. |
| `admin-dashboard.jsx` | S4, S5 | money, observability | Founder admin panel: metric cards (active tenants, MRR, queries) + tenants table (plan/status/usage) + activation controls. **Note (override):** "mark invoice paid" → activation now driven primarily by the **Stripe webhook**; manual activate remains for invoice-fallback accounts. |

## Design tokens (match in production)

- All components: `direction: rtl`, `fontFamily: "'IBM Plex Arabic', 'Segoe UI', sans-serif"`.
- Brand colors: Navy `#1B2A3D`, Amber `#D97706`, Amber-light `#F59E0B`, Background `#0F172A`.
- Arabic labels: Jordanian/Gulf conversational register (not MSA).
- English tech terms inside Arabic text: BiDi isolation (`<bdi>` or CSS `unicode-bidi: isolate`).
- Plan limits: Starter = 5 users / 50 docs; Pro = 20 users / 200 docs.
- Status values match DB `CHECK`: `'active'`, `'trial'`, `'paused'`, `'pending'`, `'past_due'`.

## Loop coverage

auth · domain · money · notify shown in mockups. deploy (Contabo + Caddy + PM2) and compliance (tenant RLS) are infrastructure — no user-facing screens in MVP. All 7 loops represented.

Artifacts are reference-only — not production code. Component logic is intentionally simplified.

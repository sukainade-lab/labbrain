# Lessons — LabBrain

Last pruned: 2026-06-01

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

## Archived lessons

None.

# Score — S13 Document versioning + re-index — 2026-06-02

**Branch:** `feat/s13-doc-versioning` (PR #25) vs `main`
**CI:** ✅ green on PR #25 head `1e951ec` — run 26833156553 (**quality** + **integration** both success), confirmed BEFORE scoring (L3 / retro-P1).

| Hat | Score | Notes |
|-----|:-----:|-------|
| Product | 9 | Full reachable replace loop (per-row "استبدال" control → `PUT /api/documents/[id]` → re-index → `نسخة N` badge), same `document_id` so the `?doc=ID` citation deep-link stays valid. The headline guarantee — **a replace never touches Q&A history** — is proven against real Postgres (AC-13.4). Fail-safe: a failed re-index leaves the prior revision fully answerable. Arabic copy throughout. −1: enhancement to an existing surface (not net-new product surface); replace reuses the existing parsing badge rather than a distinct per-row "replacing…" state (MVP-acceptable). L4 satisfied (control reachable + caller wired). |
| Architecture | 9 | The atomic `replace_document_chunks` RPC is the **single all-or-nothing point** where a document's chunks ever change — delete-old + insert-new in one tx, `security definer`, tenant-guarded (`tenant mismatch` raise), `revoke public` / `grant service_role`. Fail-safe ordering: the destructive swap is deferred until the new chunks are parsed+embedded, so any pre-RPC failure leaves prior chunks + version intact. Pure composition of proven seams (S2 ingest + S12 replace-in-place); **zero new deps**. Read-then-increment version is safe under single-writer-per-doc (concurrent replace explicitly out of scope, documented). L3 cap neutralized (CI green pre-score). |
| Engineering | 9 | Three test layers (9 service + 9 route-seam + 4 live-DB = 22 new; full suite **569/569 / 66 files** `--no-file-parallelism`). Guard on embedding-count mismatch, discriminated status handling, no `any`, no secret-prefix literals, `<bdi>` on dynamic values. Fail-safe paths (parse-fail / embed-mismatch / swap-error → `failed`, RPC not called for pre-swap fails) are explicitly tested. jsonb→`::vector` + `nullif(page_number,'')::int` casts validated against local PG before building. |
| QA | 9 | **Capped at the L7/L8 ceiling (9), both satisfied.** L1 (route-seam every branch 401/401/404/403/400/400/413/200/200) ✓ · L2 (live `describe.skipIf().sequential` unique-tenant + cleanup, proves cross-tenant guard + history survival against real RPC) ✓ · L7 (live `npm run axe:walk` 0 violations @375px on the net-new `/documents` walk) ✓ · L8 (AC-13.1…13.8 enumerated in `docs/stories/S13.md` before coding) ✓. BRD traceability: AC-13.1–13.7 `@AC`-tagged; AC-13.8 cited via the L7 walk (doc-only precedent, same as AC-12.7/AC-11.7). |
| UX | 9 | RTL, `<bdi>` on the `نسخة N` version digit + the (possibly renamed) filename, ≥44px tap targets, replace disabled while the pipeline is active (can't race a second replace), version badge only renders from نسخة 2 up. Live axe-core 0 violations @375px across all 5 routes. −1: incremental UI on an existing surface, not a net-new visible surface (the S12 10s came from net-new surface + clean first-pass walk). |

**Composite: (9+9+9+9+9) × 2 = 90 ✅**

**Decision: Ship.**

This matches the planned honest target (~90 for a data/seam-heavy story — the tracker predicted "S13 versioning is data-heavy, expect ~90 unless it ships real UI"). No hat <8.

**No new lesson** — clean first-pass 90; S13 surfaced no recurring defect (9 active lessons L1–L9 all proactively satisfied at write-time).

Run `/7-eo-ship story-13` when ready → **STOP at the merge gate** (merge of PR #25 to `main` needs explicit founder authorization naming the PR).

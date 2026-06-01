---
SaaSfast: yes
SaaSfast mode: M3 — Core stack
Rationale: BRD is auth → dashboard → document tables → usage counters → admin activation (admin-heavy SaaS loop). Founder extends the bilingual RTL Q&A/RAG UI on top of the SaaSfast core shell.
Payment provider: stripe
Payment note: FOUNDER OVERRIDE (2026-06-01). The BRD originally specified manual bank-transfer/invoice for MVP and Tap for v2, "never Stripe (unavailable to JO merchants)". Founder elected Stripe. MVP money loop (S4) is now Stripe Checkout + webhook activation. CAVEAT: Stripe does not onboard Jordan-registered businesses and JOD is not a standard Stripe settlement currency — this assumes a Stripe entity in a supported country (e.g. US/UK LLC). Tap remains a fallback if Stripe onboarding is rejected.
Hosting: Contabo VPS (EU/Germany region) — replaces Hetzner CX21; preserves EU data residency. Caddy (auto-SSL) + PM2 + docker-compose, documented in deploy.sh.
Recorded: 2026-06-01
---

# LabBrain — Tech Stack Decision

**Version:** 1.1 | **Date:** 2026-06-01 | **Deploy lane:** Contabo VPS (Germany/EU)
**Founder profile:** Non-technical solo founder — Claude Code does the building
**Data residency:** MENA-required → EU (Contabo Germany + Supabase Frankfurt) for MVP; flag KSA migration path

---

## Stack Overview

| Layer | Choice | Justification |
|-------|--------|---------------|
| **Frontend** | Next.js 14 (App Router) + TypeScript | Industry default for RAG apps; App Router enables streaming AI responses; Claude Code knows it deeply |
| **Styling** | Tailwind CSS + RTL plugin (`tailwindcss-rtl`) | RTL Arabic layout mandatory from day 1; Tailwind + RTL plugin is the simplest path |
| **Data fetching** | React Query (TanStack) | Handles loading/error states for Q&A and document upload cleanly |
| **Validation** | Zod | End-to-end type safety; Claude Code uses it natively |
| **Backend** | Next.js API Routes + TypeScript | Same repo = one deploy, one codebase, zero context switch |
| **Database** | Supabase Postgres (Frankfurt region) | EU data residency; managed = no DBA work; Supabase MCP available for Claude Code |
| **Vector search** | pgvector (Supabase extension) | ⚠️ CHANGED from Pinecone — all document vectors stay in Frankfurt (data residency met); no extra vendor; handles 50K+ chunks at LabBrain scale comfortably |
| **Auth** | Supabase Auth (email + magic link) | Built-in, zero-config; email OTP for 2FA; multi-tenant isolation via RLS |
| **File storage** | Supabase Storage (Frankfurt) | Lab PDF/Word files stay in same EU region as DB |
| **Document parsing** | LlamaParse (cloud API) | Best-in-class PDF/table extraction with page numbers; no self-hosting needed |
| **AI** | OpenAI GPT-4o-mini (default) + GPT-4o (complex queries) | gpt-4o-mini: ~$0.15/1M tokens (cost-effective for 20 labs); gpt-4o: reserved for ambiguous queries |
| **AI fallback** | Anthropic Claude API | Fallback when OpenAI quota exceeded; also used for Arabic language quality check |
| **Payments (MVP)** | Stripe (Checkout + webhooks) | FOUNDER OVERRIDE. Card checkout from day 1. Assumes a Stripe entity in a supported country (Stripe does not onboard JO-registered businesses; JOD not a standard settlement currency). Pricing displayed in JOD; settlement currency per Stripe account. |
| **Payments (fallback)** | Tap Payments / bank transfer | If Stripe onboarding is rejected for the founder's entity, fall back to Tap or manual JOD bank transfer + invoice (original BRD plan). |
| **Email** | Resend (transactional) | Welcome emails, invoice requests, notifications; simple API + React Email templates |
| **Deploy** | Contabo VPS (Germany/EU) | FOUNDER OVERRIDE (replaces Hetzner CX21). EU region preserves data residency; runs app + Caddy proxy; PM2 manages processes; docker-compose |
| **Reverse proxy** | Caddy | Auto SSL, zero-config; ideal for non-technical founder |
| **Process manager** | PM2 | Auto-restarts app on crash; startup on server reboot |
| **Error monitoring** | Sentry (free tier) | Captures crashes with tenant context; 5K errors/month free |
| **Analytics** | PostHog (cloud, free tier) | Tracks: signup, doc_uploaded, question_asked, invoice_requested; GDPR-compliant |

---

## Key Design Decision: pgvector over Pinecone

The original planned stack included Pinecone for vector search. Changed to pgvector because:

1. **Data residency** — Pinecone has no MENA/EU region that satisfies the requirement. pgvector runs inside Supabase Frankfurt.
2. **Scale fit** — LabBrain at 20–200 labs × 30–100 documents each = ~10K–100K chunks. pgvector handles this with a simple HNSW index. Pinecone becomes worth it at 10M+ chunks.
3. **Cost** — Pinecone Starter is free but limited; paid is $70+/mo. pgvector: included in Supabase free tier.
4. **Complexity** — One fewer API key, one fewer vendor, one fewer failure point. Non-technical founder = simplicity wins.

**Migration path if needed:** If LabBrain reaches 500+ labs and query latency degrades, add Pinecone EU region at that point — pgvector schema maps directly.

---

## Monthly Cost Breakdown (MVP, 20 labs)

| Service | Cost |
|---------|------|
| Contabo VPS (Germany/EU) | ~€5–8/mo |
| Supabase (Pro plan — needed for pgvector + file storage) | $25/mo |
| LlamaParse (1,000 pages/mo free, then $0.003/page) | ~$5–15/mo |
| OpenAI API (GPT-4o-mini, ~500K tokens/mo for 20 labs) | ~$5/mo |
| Sentry (free) | $0 |
| PostHog (free tier) | $0 |
| Resend (free tier: 100 emails/day) | $0 |
| **Total** | **~$40–55/mo** |

Revenue at 20 labs (Starter): 20 × 35 JOD ≈ 700 JOD/mo ≈ $990/mo.
**Gross margin at MVP: ~94%.**

---

## Data Residency Map

| Data type | Where stored | Region | Compliance |
|-----------|-------------|--------|-----------|
| User accounts | Supabase Auth | Frankfurt (EU) | ✅ EU |
| Lab documents (files) | Supabase Storage | Frankfurt (EU) | ✅ EU |
| Document vectors | pgvector (Supabase) | Frankfurt (EU) | ✅ EU |
| Query logs | Supabase Postgres | Frankfurt (EU) | ✅ EU |
| LlamaParse processing | Cloud (US) | ⚠️ Transient | Files sent for parsing, not stored |
| OpenAI processing | Cloud (US) | ⚠️ Transient | Queries processed, not stored |

**Note for KSA expansion:** PDPL (Personal Data Protection Law) requires KSA-resident data for some categories. At KSA launch, migrate to AWS me-central-1 (Riyadh) or Oracle Cloud UAE North. Plan for this before the first KSA paying lab.

**Note for LlamaParse + OpenAI:** These are processing-only (transient). The raw documents and outputs are stored in Supabase Frankfurt. For labs with classified documents, offer an "air-gap mode" in v2 using local LlamaParse + self-hosted Ollama.

---

## MENA Quality Checklist

The `microsaas-dev-os` Claude Code plugin enforces these per-PR via `/eo-score`:

- `arabic-rtl-checker` — RTL layout, IBM Plex Arabic / Cairo font, BiDi isolation for inline English terms (ISO 17025, calibration, etc.)
- `mena-mobile-check` — 375px viewport (WhatsApp demo sharing), JOD currency, Fri/Sat weekend, DD/MM/YYYY dates
- `brd-traceability` — every `AC-N.N` must have a `@AC-N.N` tagged test

---

## What Claude Code Gets From This Stack

- **One repo** (Next.js monorepo) — no context-switching between frontend/backend repos
- **Supabase MCP** — Claude Code can query the DB, run migrations, check RLS during build
- **pgvector** — standard SQL operations, no proprietary SDK to learn
- **Railway alt** — if Contabo VPS setup hits a wall during build, Railway is the immediate fallback (same stack, different deploy)

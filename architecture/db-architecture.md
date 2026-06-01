# LabBrain — Database Architecture

**Version:** 1.0 | **Date:** 2026-05-30
**Database:** Supabase Postgres (Frankfurt region, eu-central-1)
**Extensions:** pgvector (vector similarity search)
**Multi-tenancy:** Row-Level Security (RLS) on every tenant-scoped table

---

## Schema Overview

```
tenants
  ├── users (tenant_id FK)
  │     └── invitations (tenant_id FK)
  ├── subscriptions (tenant_id FK)
  ├── documents (tenant_id FK)
  │     └── document_chunks (document_id FK, tenant_id FK)
  └── queries (tenant_id FK, user_id FK)
```

---

## Tables

### `tenants`

The root table. One row per lab organization.

```sql
CREATE TABLE tenants (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,                          -- "مختبر الأردن للمعايرة"
  slug          TEXT UNIQUE NOT NULL,                   -- "lab-jordan-calibration"
  plan          TEXT NOT NULL DEFAULT 'trial'           -- 'trial' | 'starter' | 'pro'
                  CHECK (plan IN ('trial', 'starter', 'pro')),
  status        TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'paused', 'cancelled')),
  trial_ends_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- No RLS on tenants (read via service role only)
-- Index: slug for subdomain routing
CREATE UNIQUE INDEX idx_tenants_slug ON tenants(slug);
```

**Plan limits enforced in application logic:**

| plan | max_users | max_documents |
|------|-----------|---------------|
| trial | 2 | 10 |
| starter | 5 | 50 |
| pro | 20 | 200 |

---

### `users`

Staff members within a tenant.

```sql
CREATE TABLE users (
  id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  full_name     TEXT,
  role          TEXT NOT NULL DEFAULT 'member'
                  CHECK (role IN ('admin', 'member')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_users ON users
  USING (tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()));
```

**Index:**
```sql
CREATE INDEX idx_users_tenant ON users(tenant_id);
```

---

### `invitations`

Pending team member invites.

```sql
CREATE TABLE invitations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email         TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'member',
  token         TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  invited_by    UUID REFERENCES users(id),
  expires_at    TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
  accepted_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_invitations ON invitations
  USING (tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()));
```

---

### `subscriptions`

Billing and plan history per tenant.

```sql
CREATE TABLE subscriptions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  plan                TEXT NOT NULL CHECK (plan IN ('starter', 'pro')),
  billing_cycle       TEXT NOT NULL DEFAULT 'monthly' CHECK (billing_cycle IN ('monthly', 'annual')),
  status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'active', 'expired', 'cancelled')),
  invoice_requested_at TIMESTAMPTZ,
  activated_at        TIMESTAMPTZ,
  expires_at          TIMESTAMPTZ,
  jod_amount          NUMERIC(10,3),                   -- 35.000 or 70.000
  notes               TEXT,                            -- founder notes on payment
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_subscriptions ON subscriptions
  USING (tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()));
```

---

### `documents`

Uploaded lab documents (PDF, DOCX, XLSX).

```sql
CREATE TABLE documents (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,                          -- original filename
  display_name  TEXT,                                   -- human-readable label
  file_type     TEXT NOT NULL,                          -- 'pdf' | 'docx' | 'xlsx'
  file_url      TEXT NOT NULL,                          -- Supabase Storage path
  file_size_kb  INTEGER,
  page_count    INTEGER,
  status        TEXT NOT NULL DEFAULT 'uploading'
                  CHECK (status IN ('uploading', 'parsing', 'indexing', 'ready', 'failed')),
  error_message TEXT,                                   -- populated if status = 'failed'
  uploaded_by   UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_documents ON documents
  USING (tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()));

CREATE INDEX idx_documents_tenant ON documents(tenant_id);
CREATE INDEX idx_documents_status ON documents(tenant_id, status);
```

---

### `document_chunks`

Text chunks with embeddings. The core of the RAG pipeline.

```sql
-- Requires: CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE document_chunks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id   UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  chunk_index   INTEGER NOT NULL,                       -- 0-based position in document
  page_num      INTEGER,                                -- page number from LlamaParse
  section_text  TEXT,                                   -- section heading if detected
  content       TEXT NOT NULL,                          -- raw chunk text
  embedding     VECTOR(1536) NOT NULL,                  -- OpenAI text-embedding-3-small
  token_count   INTEGER,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE document_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_chunks ON document_chunks
  USING (tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()));

-- HNSW index for fast approximate nearest-neighbor search
-- m=16, ef_construction=64 — good for <500K rows
CREATE INDEX idx_chunks_embedding ON document_chunks
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Filtering index: tenant + document for scoped searches
CREATE INDEX idx_chunks_tenant_doc ON document_chunks(tenant_id, document_id);
```

**Query pattern (tenant-scoped vector search):**
```sql
SELECT
  dc.content,
  dc.page_num,
  dc.section_text,
  d.name AS document_name,
  1 - (dc.embedding <=> $query_embedding) AS similarity
FROM document_chunks dc
JOIN documents d ON dc.document_id = d.id
WHERE dc.tenant_id = $tenant_id
  AND 1 - (dc.embedding <=> $query_embedding) >= 0.75
ORDER BY dc.embedding <=> $query_embedding
LIMIT 5;
```

---

### `queries`

Q&A history for each tenant.

```sql
CREATE TABLE queries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id         UUID REFERENCES users(id),
  question_text   TEXT NOT NULL,
  question_lang   TEXT NOT NULL CHECK (question_lang IN ('ar', 'en', 'mixed')),
  answer_text     TEXT,
  citations       JSONB,                                -- [{doc_name, page_num, section}]
  found_answer    BOOLEAN NOT NULL DEFAULT FALSE,
  model_used      TEXT,                                 -- 'gpt-4o-mini' | 'gpt-4o'
  tokens_used     INTEGER,
  latency_ms      INTEGER,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE queries ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_queries ON queries
  USING (tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()));

CREATE INDEX idx_queries_tenant ON queries(tenant_id, created_at DESC);
CREATE INDEX idx_queries_user ON queries(user_id, created_at DESC);
```

**Citations JSONB structure:**
```json
[
  {
    "document_name": "ISO 17025 Uncertainty Procedure v3.pdf",
    "page_num": 18,
    "section": "7.6 — Measurement Uncertainty",
    "similarity": 0.91
  }
]
```

---

## RLS Policy Summary

| Table | Policy Name | Rule |
|-------|-------------|------|
| users | tenant_isolation_users | `tenant_id = auth user's tenant_id` |
| invitations | tenant_isolation_invitations | `tenant_id = auth user's tenant_id` |
| subscriptions | tenant_isolation_subscriptions | `tenant_id = auth user's tenant_id` |
| documents | tenant_isolation_documents | `tenant_id = auth user's tenant_id` |
| document_chunks | tenant_isolation_chunks | `tenant_id = auth user's tenant_id` |
| queries | tenant_isolation_queries | `tenant_id = auth user's tenant_id` |
| tenants | (no user-facing RLS) | read via server-side service role only |

---

## Supabase Storage

```
Buckets:
  lab-documents/
    {tenant_id}/
      {document_id}/{original_filename}
```

Bucket policy: `lab-documents` is private. Access via signed URLs generated server-side (expire in 1 hour). Never expose public URLs for lab documents.

---

## Backup Strategy

- Supabase Pro: automatic daily backups, 7-day retention
- Weekly: `pg_dump` via cron job on the Contabo VPS → compress → upload to EU object storage (Germany)
- Restore test: monthly manual restore to staging environment

---

## Seed & Migration

```
supabase/
  migrations/
    001_create_extensions.sql    -- enable pgvector
    002_create_tenants.sql
    003_create_users.sql
    004_create_invitations.sql
    005_create_subscriptions.sql
    006_create_documents.sql
    007_create_document_chunks.sql
    008_create_queries.sql
    009_rls_policies.sql
    010_indexes.sql
  seed.sql                       -- test tenant + user + sample document
```

---

## Performance Notes at Scale

| Stage | Labs | Chunks | Query latency target |
|-------|------|--------|---------------------|
| MVP | 20 | ~60K | <800ms |
| Month 6 | 100 | ~300K | <800ms (HNSW) |
| Year 1 | 500 | ~1.5M | <1000ms (upgrade Supabase plan) |
| Scale limit | 2000+ | >5M | Migrate to dedicated Postgres + pgvector or add Pinecone |

-- LabBrain initial schema — multi-tenant, RTL-agnostic, pgvector for RAG.
-- AC-1.3 / AC-2.4 / AC-5.7: tenant isolation enforced via RLS (see 0002_rls_policies.sql).

create extension if not exists "uuid-ossp";
create extension if not exists vector;

-- ── Tenants (one row per lab) ────────────────────────────────────────────────
create table tenants (
  id            uuid primary key default uuid_generate_v4(),
  name          text not null,
  plan          text not null default 'starter' check (plan in ('starter', 'pro')),
  status        text not null default 'inactive'
                  check (status in ('inactive', 'active', 'past_due')),
  created_at    timestamptz not null default now()
);

-- ── Users (Supabase auth.users 1:1, scoped to a tenant) ──────────────────────
create table users (
  id            uuid primary key references auth.users(id) on delete cascade,
  tenant_id     uuid not null references tenants(id) on delete cascade,
  email         text not null,
  role          text not null default 'member' check (role in ('owner', 'admin', 'member')),
  created_at    timestamptz not null default now()
);
create index users_tenant_idx on users(tenant_id);

-- ── Documents (uploaded source files) ────────────────────────────────────────
create table documents (
  id            uuid primary key default uuid_generate_v4(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  filename      text not null,
  storage_path  text not null,
  status        text not null default 'pending'
                  check (status in ('pending', 'parsing', 'ready', 'failed')),
  page_count    int,
  created_at    timestamptz not null default now()
);
create index documents_tenant_idx on documents(tenant_id);

-- ── Document chunks (embeddings for retrieval; OpenAI text-embedding-3-small = 1536d) ─
create table document_chunks (
  id            uuid primary key default uuid_generate_v4(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  document_id   uuid not null references documents(id) on delete cascade,
  chunk_index   int not null,
  content       text not null,
  page_number   int,
  embedding     vector(1536),
  created_at    timestamptz not null default now()
);
create index chunks_tenant_idx on document_chunks(tenant_id);
create index chunks_document_idx on document_chunks(document_id);
create index chunks_embedding_idx on document_chunks
  using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- ── Queries (Q&A history with mandatory citation) ────────────────────────────
create table queries (
  id            uuid primary key default uuid_generate_v4(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  user_id       uuid references users(id) on delete set null,
  question      text not null,
  answer        text,
  citations     jsonb not null default '[]',
  created_at    timestamptz not null default now()
);
create index queries_tenant_idx on queries(tenant_id);

-- ── Subscriptions (Stripe — founder override) ────────────────────────────────
create table subscriptions (
  id                      uuid primary key default uuid_generate_v4(),
  tenant_id               uuid not null references tenants(id) on delete cascade,
  stripe_customer_id      text,
  stripe_subscription_id  text,
  status                  text not null default 'incomplete',
  current_period_end      timestamptz,
  created_at              timestamptz not null default now()
);
create index subscriptions_tenant_idx on subscriptions(tenant_id);
create unique index subscriptions_stripe_sub_idx
  on subscriptions(stripe_subscription_id) where stripe_subscription_id is not null;

-- ── Invitations (team onboarding) ────────────────────────────────────────────
create table invitations (
  id            uuid primary key default uuid_generate_v4(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  email         text not null,
  role          text not null default 'member' check (role in ('admin', 'member')),
  token         text not null unique,
  accepted_at   timestamptz,
  created_at    timestamptz not null default now()
);
create index invitations_tenant_idx on invitations(tenant_id);

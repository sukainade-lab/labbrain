# LabBrain — MCP Integration Plan

**Version:** 1.0 | **Date:** 2026-05-30
**Purpose:** Map GTM tools and product integrations to MCP connections for Claude Code + Cowork sessions.

---

## MCP Priority Matrix

| MCP | Phase | Purpose | Who uses it |
|-----|-------|---------|-------------|
| Supabase MCP | Weekend MVP | DB queries, migrations, RLS testing during build | Claude Code |
| Hetzner MCP | Weekend MVP | Server management, deploy, health checks | Claude Code |
| Resend MCP | Weekend MVP | Email template testing, send verification | Claude Code |
| PostHog MCP | Month 2 | Query analytics events, track funnel | Cowork (founder) |
| Tap Payments MCP | v2 | Payment reconciliation, subscription status | Claude Code |
| WhatsApp Business API | v2 | Automated follow-up sequences (not MVP) | n8n |

---

## Weekend MVP MCPs

### 1. Supabase MCP

**What it enables during build:**
- Claude Code queries the live DB schema during development (no copy-pasting schemas)
- Run migrations directly: `supabase migration new`, `supabase db push`
- Test RLS policies: verify tenant isolation with test users
- Inspect document_chunks and query tables during RAG pipeline debugging

**Setup:**
```bash
# In Claude Code (claude-code-guide uses this)
# MCP server: @supabase/mcp-server-supabase
# Config: ~/.claude/mcp.json

{
  "mcpServers": {
    "supabase": {
      "command": "npx",
      "args": ["-y", "@supabase/mcp-server-supabase@latest",
               "--supabase-url", "${SUPABASE_URL}",
               "--supabase-service-role-key", "${SUPABASE_SERVICE_ROLE_KEY}"]
    }
  }
}
```

**Key operations during build:**
- `list_tables` — verify schema matches BRD
- `execute_sql` — run RLS policy tests
- `apply_migration` — push schema changes
- `get_table_schema` — Claude Code reads column types before writing queries

---

### 2. Hetzner MCP

**What it enables:**
- Claude Code checks server health during deploy
- View server status, bandwidth, CPU during load testing
- Restart server processes if needed during build

**Setup:**
```bash
{
  "mcpServers": {
    "hetzner": {
      "command": "npx",
      "args": ["-y", "@hetzner/mcp-server@latest",
               "--api-token", "${HETZNER_API_TOKEN}"]
    }
  }
}
```

**Key operations:**
- `get_server_status` — confirm deploy landed
- `list_servers` — see running instances
- `get_server_metrics` — CPU/RAM during load tests

---

### 3. Resend MCP (Email)

**What it enables:**
- Test welcome email template during build without sending real emails
- Preview transactional emails (invoice request, activation confirmation)
- Send test emails to founder inbox during QA

**Setup:**
```bash
{
  "mcpServers": {
    "resend": {
      "command": "npx",
      "args": ["-y", "resend-mcp@latest",
               "--api-key", "${RESEND_API_KEY}"]
    }
  }
}
```

---

## Month 2 MCPs (Post-MVP)

### 4. PostHog MCP

**What it enables (Cowork founder use):**
- Query funnel: signup → document_uploaded → question_asked → invoice_requested
- Identify drop-off points in onboarding
- Compare Arabic vs English question volume
- Track found_answer rate (quality metric)

**Setup:**
```bash
{
  "mcpServers": {
    "posthog": {
      "command": "npx",
      "args": ["-y", "posthog-mcp@latest",
               "--api-key", "${POSTHOG_API_KEY}",
               "--project-id", "${POSTHOG_PROJECT_ID}"]
    }
  }
}
```

**Cowork queries (founder uses these weekly):**
```
"How many labs completed onboarding this week?"
"What's the question_asked → invoice_requested conversion rate?"
"Which documents are queried most across all tenants?"
"What % of questions return found_answer: false?"
```

---

## v2 MCPs

### 5. Tap Payments MCP

**What it enables:**
- Reconcile payments: match invoice_requested records to Tap payment confirmations
- Update subscription status automatically when payment confirmed
- Handle webhook events (payment.success, payment.failed)

**Integration flow:**
```
Lab clicks "Pay by Card" → Tap checkout → webhook → Next.js /api/webhooks/tap
→ update subscriptions.status = 'active' → send activation email
```

---

## GTM Tool Integration Map

The Dream 100 and AEE motions are currently manual (WhatsApp + LinkedIn). These skills connect them to Cowork:

| GTM Action | Current | Skill Created | Future MCP |
|-----------|---------|---------------|-----------|
| Draft WhatsApp DM | Manual 20 min | ✅ whatsapp-outreach-drafter | WhatsApp Business API (v2) |
| Draft LinkedIn post | Manual 50 min | ✅ linkedin-post-factory | LinkedIn API (v2, if available) |
| Track Dream 100 contacts | Spreadsheet | ❌ not yet | Notion or Airtable MCP (v2) |
| Invoice tracking | Email inbox | ❌ not yet | Resend MCP events |

**Recommended v2 addition:** Build a simple Dream 100 tracker as a Supabase table + Cowork skill. No external MCP needed — query via Supabase MCP.

```sql
-- Dream 100 tracker (add in v2 migration)
CREATE TABLE dream_100_contacts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lab_name    TEXT NOT NULL,
  contact_name TEXT,
  whatsapp    TEXT,
  linkedin_url TEXT,
  tier        INTEGER CHECK (tier IN (1, 2, 3)),
  stage       TEXT CHECK (stage IN ('identified', 'contacted', 'replied', 'demo_done', 'converted', 'passed')),
  last_contact_at TIMESTAMPTZ,
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## MCP Credential Checklist

All secrets go in `.env` (never git). Also add to `.env.example` with placeholder values.

```bash
# Supabase
SUPABASE_URL=https://[project].supabase.co
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...  # server-side only, never exposed to client

# OpenAI
OPENAI_API_KEY=...

# Anthropic (fallback)
ANTHROPIC_API_KEY=...

# LlamaParse
LLAMA_CLOUD_API_KEY=...

# Resend
RESEND_API_KEY=...
RESEND_FROM_EMAIL=noreply@labbrain.io

# Sentry
NEXT_PUBLIC_SENTRY_DSN=...

# PostHog
NEXT_PUBLIC_POSTHOG_KEY=...
NEXT_PUBLIC_POSTHOG_HOST=https://app.posthog.com

# Hetzner (for MCP, not app)
HETZNER_API_TOKEN=...

# Admin notification email
ADMIN_NOTIFY_EMAIL=yousef@labbrain.io
```

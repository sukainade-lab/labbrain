# LabBrain — MCP Setup Guide

**Version:** 1.0 | **Date:** 2026-05-30
**Deploy lane:** Contabo VPS (Germany/EU) + Supabase (Frankfurt) — founder override (replaces Hetzner)
**Audience:** This guide is for Claude Code, not for you. You hand it to Claude Code on Friday evening and it follows these steps.

---

## Before You Start (Friday Evening Checklist)

Complete these 8 steps before opening Claude Code. Each takes 5–10 minutes.

### 1. Create Supabase Project

1. Go to [supabase.com](https://supabase.com) → New project
2. Region: **eu-central-1 (Frankfurt)** — mandatory for data residency
3. Note down: Project URL, `anon` key, `service_role` key
4. Enable pgvector: Dashboard → Extensions → search "vector" → Enable

### 2. Create Contabo VPS (founder override — replaces Hetzner)

1. Go to [contabo.com](https://contabo.com) → Cloud VPS
2. Region: **European Union (Germany)** — mandatory for data residency
3. Image: **Ubuntu 22.04**
4. Type: **VPS S** or higher (4 vCPU / 8GB is comfortable for MVP)
5. Add SSH key (your local `~/.ssh/id_rsa.pub`)
6. Name: `labbrain-prod`
7. Note the server IP

### 3. Point Your Domain

In your DNS provider (Cloudflare recommended):
```
A    @        → [Contabo IP]
A    www      → [Contabo IP]
```
Wait for DNS propagation (~5 min with Cloudflare).

### 4. Get LlamaParse API Key

1. Go to [cloud.llamaindex.ai](https://cloud.llamaindex.ai)
2. Sign up → API Keys → Create key
3. Free tier = 1,000 pages/month

### 5. Get OpenAI API Key

1. Go to [platform.openai.com](https://platform.openai.com)
2. API Keys → Create secret key
3. Add billing: $20 credit covers MVP usage (20 labs = ~$3–5/mo)

### 6. Get Anthropic API Key (fallback AI)

1. Go to [console.anthropic.com](https://console.anthropic.com)
2. API Keys → Create key

### 7. Set Up Resend (email)

1. Go to [resend.com](https://resend.com) → Sign up
2. Add your domain → verify DNS records
3. Create API key

### 8. Set Up Sentry (errors)

1. Go to [sentry.io](https://sentry.io) → Create project → Next.js
2. Copy the DSN

---

## Contabo Server Setup

SSH into your server, then run these commands once:

```bash
ssh root@[your-contabo-ip]

# Update system
apt update && apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com | sh
apt install -y docker-compose-plugin

# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
npm install -g pm2

# Install Caddy (reverse proxy + auto SSL)
apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | \
  gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  > /etc/apt/sources.list.d/caddy-stable.list
apt update && apt install -y caddy

# Create app directory
mkdir -p /var/www/labbrain
```

**Caddyfile** — save to `/etc/caddy/Caddyfile`:
```caddy
labbrain.io {
    reverse_proxy localhost:3000
}

www.labbrain.io {
    redir https://labbrain.io{uri} permanent
}
```

---

## Environment File

Create `/var/www/labbrain/.env` on the server:

```bash
NODE_ENV=production
NEXT_PUBLIC_APP_URL=https://labbrain.io

NEXT_PUBLIC_SUPABASE_URL=https://[project-ref].supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=[anon-key]
SUPABASE_SERVICE_ROLE_KEY=[service-role-key]

OPENAI_API_KEY=[key]
ANTHROPIC_API_KEY=[key]
LLAMA_CLOUD_API_KEY=[key]

RESEND_API_KEY=[key]
RESEND_FROM_EMAIL=noreply@labbrain.io

NEXT_PUBLIC_SENTRY_DSN=[dsn]
NEXT_PUBLIC_POSTHOG_KEY=[key]
NEXT_PUBLIC_POSTHOG_HOST=https://app.posthog.com

ADMIN_NOTIFY_EMAIL=yousef@labbrain.io
```

---

## Deploy Script

Create `/var/www/labbrain/deploy.sh`:

```bash
#!/bin/bash
set -e
cd /var/www/labbrain

echo "Pulling latest code..."
git pull origin main

echo "Installing dependencies..."
npm ci

echo "Building..."
npm run build

echo "Restarting app..."
pm2 reload labbrain --update-env || pm2 start npm --name labbrain -- start

echo "Checking health..."
sleep 3
curl -f http://localhost:3000/api/health && echo "Health OK"
```

```bash
chmod +x deploy.sh
```

**First deploy:**
```bash
cd /var/www/labbrain
git clone https://github.com/[your-repo]/labbrain .
cp .env.example .env   # fill in values
bash deploy.sh
pm2 startup            # auto-start on server reboot
pm2 save
```

---

## Claude Code MCP Config

On your local machine, add to `~/.claude/mcp.json`:

```json
{
  "mcpServers": {
    "supabase": {
      "command": "npx",
      "args": [
        "-y", "@supabase/mcp-server-supabase@latest",
        "--supabase-url", "https://[project].supabase.co",
        "--supabase-service-role-key", "[service-role-key]"
      ]
    },
    "resend": {
      "command": "npx",
      "args": [
        "-y", "resend-mcp@latest",
        "--api-key", "[resend-api-key]"
      ]
    }
  }
}
```

---

## Bootstrap Prompt for Claude Code

On Friday evening, open Claude Code and paste this:

```
Build LabBrain — ISO 17025 document intelligence SaaS for Arabic-speaking labs in MENA.

Read these files before writing a single line of code:
  EO-Brain/4-Architecture/brd.md               (feature spec, 5 stories, 7-loop contract)
  EO-Brain/4-Architecture/tech-stack-decision.md (stack + why pgvector over Pinecone)
  EO-Brain/4-Architecture/db-architecture.md    (full Postgres schema + RLS policies)
  EO-Brain/4-Architecture/mcp-setup-guide.md    (deploy instructions)

Stack: Next.js 14 App Router + TypeScript + Tailwind RTL + Supabase + pgvector + OpenAI
Deploy: Contabo VPS (Germany/EU) — server IP [X.X.X.X], domain labbrain.io
Start: /1-eo-dev-start

Weekend MVP = all 7 loops wired (auth/domain/money/notify/deploy/observability/compliance).
Non-negotiable: Arabic RTL from day 1, IBM Plex Arabic font, Supabase RLS on every multi-tenant table.
```

---

## Health Check

After first deploy:

```bash
curl https://labbrain.io/api/health
# Expected: {"status":"ok","version":"1.0.0","uptime_seconds":42}
```

---

## Monthly Cost Summary

| Service | Monthly |
|---------|---------|
| Contabo VPS S | ~€6–8 |
| Supabase Pro | $25.00 |
| OpenAI API | ~$5–10 |
| LlamaParse | ~$0–15 |
| Resend (free) | $0 |
| Sentry (free) | $0 |
| PostHog (free) | $0 |
| **Total** | **~$40–55/mo** |

---

## KSA Expansion Migration Note

Before onboarding the first KSA lab:

1. Create Supabase project in **AWS me-central-1 (Riyadh)**
2. Export data: `pg_dump` from Frankfurt project
3. Import into Riyadh project
4. Add `region` field to `tenants` table for multi-region routing
5. Update environment variables for KSA routing

Do not onboard KSA labs on Frankfurt instance — PDPL requires KSA data to stay in KSA.

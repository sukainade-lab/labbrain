#!/usr/bin/env bash
# LabBrain — zero-downtime deploy to the Contabo VPS (AC-5.2).
# Run on the VPS from the repo root. Pulls latest, rebuilds the app image, and
# rolls it with no downtime (Caddy keeps serving the old container until the new
# one is healthy), then verifies the AC-5.1 health endpoint.
#
# Prereqs on the VPS: docker + docker-compose-plugin, a populated .env (see
# docs/env-contract.md), and LABBRAIN_DOMAIN exported (or set in .env).
set -euo pipefail

cd "$(dirname "$0")"

echo "▶ Pulling latest main…"
git pull --ff-only origin main

echo "▶ Building app image…"
docker compose build app

echo "▶ Rolling app with zero downtime…"
# --no-deps: don't restart caddy. The new app container must pass its healthcheck
# before compose swaps traffic to it.
docker compose up -d --no-deps --wait app

echo "▶ Reloading Caddy (picks up any Caddyfile change)…"
docker compose up -d --no-deps caddy

echo "▶ Verifying health…"
for i in $(seq 1 10); do
  if curl -fsS "http://127.0.0.1:3000/api/health" >/dev/null 2>&1 \
     || docker compose exec -T app wget -qO- http://127.0.0.1:3000/api/health >/dev/null 2>&1; then
    echo "✅ Healthy. Deploy complete."
    docker image prune -f >/dev/null 2>&1 || true
    exit 0
  fi
  echo "  …waiting for health ($i/10)"
  sleep 3
done

echo "❌ Health check failed after deploy — rolling back."
docker compose rollback app 2>/dev/null || echo "  (manual rollback may be required: docker compose up -d --no-deps app on the previous image)"
exit 1

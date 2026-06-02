#!/usr/bin/env bash
# LabBrain — zero-downtime deploy to the Contabo VPS (AC-5.2).
# Run on the VPS from the repo root. Pulls latest, rebuilds the app image, and
# rolls it with no downtime (Caddy keeps serving the old container until the new
# one is healthy), then verifies the AC-5.1 health endpoint. On failure it rolls
# back to the previous image so the lab is never left on a broken build.
#
# Prereqs on the VPS:
#   - docker + docker-compose-plugin
#   - a populated .env (see docs/env-contract.md) with LABBRAIN_DOMAIN set
#   - the Supabase prod schema already migrated to match this commit (see below)
set -euo pipefail

cd "$(dirname "$0")"

APP_IMAGE="labbrain-app:latest"
ROLLBACK_IMAGE="labbrain-app:rollback"

# ── Pre-deploy guard: prod DB schema must be migrated FIRST ───────────────────
# Supabase is hosted (Frankfurt), external to this compose stack, so migrations
# are NOT applied by this script. Apply them from a trusted machine BEFORE deploy:
#   supabase link --project-ref <ref>
#   supabase db push            # applies supabase/migrations/*.sql to prod
# Shipping code that expects a newer schema (e.g. 0007 rls_policy_report) against
# an un-migrated DB will break at runtime. Set MIGRATIONS_APPLIED=1 to confirm.
if [ "${MIGRATIONS_APPLIED:-0}" != "1" ]; then
  echo "⛔ Refusing to deploy: set MIGRATIONS_APPLIED=1 once 'supabase db push'"
  echo "   has applied supabase/migrations/* to the prod project. See the runbook."
  exit 1
fi

echo "▶ Pulling latest main…"
git pull --ff-only origin main

# Tag the currently-running image as the rollback target BEFORE we overwrite it.
PREV_IMAGE_ID="$(docker image inspect "$APP_IMAGE" --format '{{.Id}}' 2>/dev/null || true)"
if [ -n "$PREV_IMAGE_ID" ]; then
  docker tag "$PREV_IMAGE_ID" "$ROLLBACK_IMAGE"
  echo "▶ Tagged current image as $ROLLBACK_IMAGE for rollback."
else
  echo "▶ No existing image — first deploy, nothing to roll back to."
fi

echo "▶ Building app image…"
docker compose build app

echo "▶ Rolling app with zero downtime…"
# --no-deps: don't restart caddy. --wait: block until the new container is healthy
# (or fails). We disable set -e for this one call so a failed roll triggers our
# rollback instead of aborting the script mid-deploy.
set +e
docker compose up -d --no-deps --wait app
ROLL_RC=$?
set -e

if [ "$ROLL_RC" -eq 0 ]; then
  echo "▶ Reloading Caddy (picks up any Caddyfile change)…"
  docker compose up -d --no-deps caddy

  echo "▶ Verifying health…"
  for i in $(seq 1 10); do
    if docker compose exec -T app wget -qO- http://127.0.0.1:3000/api/health >/dev/null 2>&1; then
      echo "✅ Healthy. Deploy complete."
      docker image rm "$ROLLBACK_IMAGE" >/dev/null 2>&1 || true
      docker image prune -f >/dev/null 2>&1 || true
      exit 0
    fi
    echo "  …waiting for health ($i/10)"
    sleep 3
  done
fi

echo "❌ New build is unhealthy — rolling back."
if [ -n "$PREV_IMAGE_ID" ]; then
  docker tag "$ROLLBACK_IMAGE" "$APP_IMAGE"
  docker compose up -d --no-deps --wait app && {
    echo "↩️  Rolled back to the previous image. Investigate the failed build."
    exit 1
  }
  echo "‼️  Rollback attempt did not become healthy — manual intervention required."
else
  echo "‼️  No previous image to roll back to (first deploy). Fix and re-run."
fi
exit 1

# LabBrain — production image. Next 16 standalone output (see next.config.mjs:
# `output: "standalone"`) keeps the runtime image small and dependency-free.
# AC-5.2 — deployed to Contabo VPS (Germany/EU) via docker-compose.

# ── deps: install production node_modules against a clean lockfile ────────────
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ── builder: compile the Next app ────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1

# NEXT_PUBLIC_* are inlined into the CLIENT bundle at BUILD time, so they must be
# present here — not just in the runtime .env (which is .dockerignored to keep the
# service-role secret out of image layers). These are all PUBLIC values (publishable
# Supabase key, Sentry DSN, PostHog key) so baking them into the image is safe.
# docker-compose passes them as build args from the VPS .env; CI/local builds may
# omit them (they default empty and the build still succeeds).
ARG NEXT_PUBLIC_SUPABASE_URL=""
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY=""
ARG NEXT_PUBLIC_SENTRY_DSN=""
ARG NEXT_PUBLIC_POSTHOG_KEY=""
ARG NEXT_PUBLIC_POSTHOG_HOST=""
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN \
    NEXT_PUBLIC_POSTHOG_KEY=$NEXT_PUBLIC_POSTHOG_KEY \
    NEXT_PUBLIC_POSTHOG_HOST=$NEXT_PUBLIC_POSTHOG_HOST

RUN npm run build

# ── runner: minimal standalone runtime ───────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Audit-export PDF render (S9/AC-9.4): puppeteer-core drives the system Chromium —
# only a headless browser resolves Arabic shaping + bidi correctly. Ship the
# distro Chromium plus Noto Arabic/Latin fonts so the rendered PDF has glyphs
# (alpine has none by default). PUPPETEER_EXECUTABLE_PATH is the contract the
# render seam reads (CHROMIUM_PATH is an accepted alias); without it the route
# 500s with a clear message instead of a blank document.
RUN apk add --no-cache \
  chromium \
  font-noto \
  font-noto-arabic
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Run as non-root.
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

# Standalone bundle + static assets + public dir.
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000

# Built-in liveness probe hits the AC-5.1 health route.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "server.js"]

import { describe, it } from "vitest";

// Story 5 — Deploy, observability & compliance (founder override: Contabo VPS).
describe("Story 5 — Deploy & observability", () => {
  it.skip("@AC-5.1 GET /api/health returns 200 { status, version, uptime_seconds } within 200ms", () => {});
  it.skip("@AC-5.2 deploys to Contabo VPS (Germany/EU) via docker-compose; deploy.sh zero-downtime PM2 reload", () => {});
  it.skip("@AC-5.3 Caddy reverse proxy: auto Let's Encrypt SSL, routes to Next.js :3000, custom domain", () => {});
  it.skip("@AC-5.4 Sentry captures uncaught errors + rejections; each event scoped with tenant_id", () => {});
  it.skip("@AC-5.5 PostHog tracks signup_completed/document_uploaded/question_asked/invoice_requested; no PII", () => {});
  it.skip("@AC-5.6 .env.example ships all var names (no values); README documents each source", () => {});
  it.skip("@AC-5.7 RLS enabled on all 7 tables with named policies, tested in seed script", () => {});
});

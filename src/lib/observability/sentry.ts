import * as Sentry from "@sentry/nextjs";

// AC-5.4 — the Sentry seam. Init lives in instrumentation(-client).ts; this module
// is the report/scope surface the app calls. Everything is DSN-guarded so that
// with no DSN (local/CI/build) these are inert no-ops and pull in nothing at
// runtime.
function enabled(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN);
}

// Report a handled exception with the originating scope as a tag, so server-side
// catch blocks surface in Sentry instead of vanishing into an opaque 500.
export function reportException(scope: string, err: unknown): void {
  if (!enabled()) return;
  Sentry.captureException(err, { tags: { scope } });
}

// AC-5.4 — every error event carries tenant_id. Called once the request's tenant
// is resolved (post-auth) so anything captured afterwards is attributable to the
// right lab without leaking PII (the tenant UUID is not personal data).
export function setSentryTenant(tenantId: string): void {
  if (!enabled()) return;
  Sentry.setTag("tenant_id", tenantId);
}

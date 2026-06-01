import * as Sentry from "@sentry/nextjs";

// AC-5.4 — browser Sentry init. Next 16 loads this once on the client; with no
// DSN (local/CI) it returns immediately and Sentry stays inert. Default
// integrations capture unhandled errors and promise rejections in the browser.
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: 0.1,
    environment: process.env.NODE_ENV
  });
}

// Lets Sentry trace App Router client-side navigations (Next 16 hook).
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;

import * as Sentry from "@sentry/nextjs";

// AC-5.4 — server/edge Sentry init. Next runs register() once at startup; with no
// DSN (local/CI) it returns immediately and Sentry stays inert. Sentry's default
// integrations capture uncaught exceptions and unhandled promise rejections.
export async function register(): Promise<void> {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return;
  if (process.env.NEXT_RUNTIME === "nodejs" || process.env.NEXT_RUNTIME === "edge") {
    Sentry.init({
      dsn,
      tracesSampleRate: 0.1,
      environment: process.env.NODE_ENV
    });
  }
}

// Captures errors thrown in App Router server components / route handlers.
export const onRequestError = Sentry.captureRequestError;

import { reportException } from "./sentry";

// Single seam for server-side error reporting. It writes to stderr (PM2 on
// Contabo captures stdout/stderr) AND forwards to Sentry (AC-5.4) — one place to
// change, every API route catch block benefits. Sentry is DSN-guarded, so this
// stays a plain console.error locally / in CI.
export function captureError(scope: string, err: unknown): void {
  // Intentional server-side error log (captured by PM2 on Contabo).
  console.error(`[${scope}]`, err);
  reportException(scope, err);
}

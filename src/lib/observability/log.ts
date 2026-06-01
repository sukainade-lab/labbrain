// Single seam for server-side error reporting. Today it writes to stderr (PM2 on
// Contabo captures stdout/stderr), so failures in API route catch blocks are no
// longer swallowed into an opaque 500. S5 (Observability) wires Sentry in here —
// one place to change, every caller benefits.
export function captureError(scope: string, err: unknown): void {
  // Intentional server-side error log (captured by PM2 on Contabo).
  console.error(`[${scope}]`, err);
  // S5: import * as Sentry from "@sentry/nextjs"; Sentry.captureException(err, { tags: { scope } });
}

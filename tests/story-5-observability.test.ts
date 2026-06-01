import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Story 5 — AC-5.4. The Sentry seam is DSN-guarded: with no DSN (local/CI) it is
// an inert no-op; with a DSN it reports the exception tagged by scope and stamps
// tenant_id on the scope. @sentry/nextjs is mocked so nothing leaves the process.

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
  setTag: vi.fn()
}));

import * as Sentry from "@sentry/nextjs";
import { reportException, setSentryTenant } from "@/lib/observability/sentry";
import { captureError } from "@/lib/observability/log";

describe("@AC-5.4 Sentry seam", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.NEXT_PUBLIC_SENTRY_DSN;
  });
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_SENTRY_DSN;
  });

  it("no-ops entirely when no DSN is set", () => {
    reportException("qa", new Error("boom"));
    setSentryTenant("tenant-1");
    expect(Sentry.captureException).not.toHaveBeenCalled();
    expect(Sentry.setTag).not.toHaveBeenCalled();
  });

  it("reports a handled exception tagged with its scope when DSN is set", () => {
    process.env.NEXT_PUBLIC_SENTRY_DSN = "https://pub@o0.ingest.sentry.io/0";
    const err = new Error("retrieval failed");
    reportException("qa", err);
    expect(Sentry.captureException).toHaveBeenCalledWith(err, { tags: { scope: "qa" } });
  });

  it("stamps tenant_id on the scope when DSN is set", () => {
    process.env.NEXT_PUBLIC_SENTRY_DSN = "https://pub@o0.ingest.sentry.io/0";
    setSentryTenant("tenant-1");
    expect(Sentry.setTag).toHaveBeenCalledWith("tenant_id", "tenant-1");
  });

  it("captureError forwards to Sentry through the single log seam", () => {
    process.env.NEXT_PUBLIC_SENTRY_DSN = "https://pub@o0.ingest.sentry.io/0";
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const err = new Error("transport down");
    captureError("analytics", err);
    expect(Sentry.captureException).toHaveBeenCalledWith(err, { tags: { scope: "analytics" } });
    spy.mockRestore();
  });
});

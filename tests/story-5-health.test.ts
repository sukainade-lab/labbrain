import { describe, it, expect } from "vitest";
import { GET } from "@/app/api/health/route";

// Story 5 — AC-5.1. The health route is the post-deploy liveness probe (the
// /7-eo-ship runbook curls it). We test the handler seam directly (Lesson L1):
// exact JSON shape, 200, numeric uptime, and a fast synchronous response.
describe("@AC-5.1 GET /api/health", () => {
  it("returns 200 with { status, version, uptime_seconds }", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(typeof body.version).toBe("string");
    expect(body.version.length).toBeGreaterThan(0);
    expect(typeof body.uptime_seconds).toBe("number");
    expect(Number.isFinite(body.uptime_seconds)).toBe(true);
    expect(body.uptime_seconds).toBeGreaterThanOrEqual(0);
  });

  it("responds well within 200ms (cheap liveness probe)", async () => {
    const start = Date.now();
    await GET();
    expect(Date.now() - start).toBeLessThan(200);
  });
});

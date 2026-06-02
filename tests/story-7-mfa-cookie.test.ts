import { describe, it, expect } from "vitest";
import {
  MFA_COOKIE_NAME,
  MFA_COOKIE_TTL_MS,
  signMfaCookie,
  verifyMfaCookie
} from "@/lib/auth/mfa-cookie";

const SECRET = "test-cookie-secret-32-bytes-minimum-xx";

describe("mfa-cookie", () => {
  it("@AC-7.3 round-trips a userId through sign → verify", () => {
    const token = signMfaCookie("user-123", SECRET);
    expect(token).toContain(".");
    expect(verifyMfaCookie(token, SECRET)).toEqual({ userId: "user-123" });
  });

  it("@AC-7.4 rejects a tampered payload", () => {
    const token = signMfaCookie("user-123", SECRET);
    const [, sig] = token.split(".");
    // Forge a different user with the original signature.
    const forgedPayload = Buffer.from(
      JSON.stringify({ userId: "attacker", exp: Date.now() + MFA_COOKIE_TTL_MS })
    ).toString("base64url");
    expect(verifyMfaCookie(`${forgedPayload}.${sig}`, SECRET)).toBeNull();
  });

  it("@AC-7.4 rejects a wrong-secret signature", () => {
    const token = signMfaCookie("user-123", SECRET);
    expect(verifyMfaCookie(token, "different-secret")).toBeNull();
  });

  it("@AC-7.3 rejects an expired marker", () => {
    const past = Date.now() - 1000;
    const token = signMfaCookie("user-123", SECRET, past);
    expect(verifyMfaCookie(token, SECRET)).toBeNull();
  });

  it("@AC-7.4 rejects malformed tokens without throwing", () => {
    expect(verifyMfaCookie("", SECRET)).toBeNull();
    expect(verifyMfaCookie("nodot", SECRET)).toBeNull();
    expect(verifyMfaCookie("a.b.c", SECRET)).toBeNull();
    expect(verifyMfaCookie("!!!.???", SECRET)).toBeNull();
  });

  it("uses the lb_mfa cookie name", () => {
    expect(MFA_COOKIE_NAME).toBe("lb_mfa");
  });
});

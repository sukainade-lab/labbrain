import { describe, it, expect } from "vitest";
import {
  OTP_TTL_MS,
  MAX_VERIFY_ATTEMPTS,
  RESEND_COOLDOWN_MS,
  MAX_SENDS_PER_WINDOW,
  generateOtp,
  hashOtp,
  compareOtp,
  evaluateVerify,
  cooldownRemainingMs
} from "@/lib/auth/otp";

const SECRET = "test-mfa-secret-do-not-use-in-prod";

describe("generateOtp", () => {
  it("@AC-7.2 produces a 6-digit numeric code", () => {
    for (let i = 0; i < 50; i++) {
      const code = generateOtp();
      expect(code).toMatch(/^\d{6}$/);
    }
  });

  it("@AC-7.2 is not trivially constant across calls", () => {
    const codes = new Set(Array.from({ length: 20 }, () => generateOtp()));
    expect(codes.size).toBeGreaterThan(1);
  });
});

describe("hashOtp / compareOtp", () => {
  it("@AC-7.2 hash is not the plaintext and is stable for the same code+secret", () => {
    const h1 = hashOtp("123456", SECRET);
    const h2 = hashOtp("123456", SECRET);
    expect(h1).toBe(h2);
    expect(h1).not.toContain("123456");
    expect(h1).toMatch(/^[a-f0-9]{64}$/); // sha256 hex
  });

  it("@AC-7.3 compareOtp returns true only for the matching code", () => {
    const hash = hashOtp("654321", SECRET);
    expect(compareOtp("654321", hash, SECRET)).toBe(true);
    expect(compareOtp("654320", hash, SECRET)).toBe(false);
    expect(compareOtp("", hash, SECRET)).toBe(false);
  });

  it("@AC-7.5 a different secret never validates (constant-time compare, no throw on length)", () => {
    const hash = hashOtp("111111", SECRET);
    expect(compareOtp("111111", hash, "other-secret")).toBe(false);
    expect(compareOtp("short", hash, SECRET)).toBe(false);
  });
});

describe("evaluateVerify", () => {
  const now = Date.now();
  const fresh = { expiresAt: new Date(now + OTP_TTL_MS), attempts: 0, consumedAt: null };
  const codeHash = hashOtp("424242", SECRET);

  it("@AC-7.3 correct code within TTL and attempts → ok", () => {
    expect(evaluateVerify(fresh, "424242", codeHash, SECRET, now)).toBe("ok");
  });

  it("@AC-7.3 wrong code → wrong", () => {
    expect(evaluateVerify(fresh, "000000", codeHash, SECRET, now)).toBe("wrong");
  });

  it("@AC-7.3 expired challenge → expired (even with the right code)", () => {
    const expired = { expiresAt: new Date(now - 1000), attempts: 0, consumedAt: null };
    expect(evaluateVerify(expired, "424242", codeHash, SECRET, now)).toBe("expired");
  });

  it("@AC-7.3 already-consumed challenge → consumed (single-use)", () => {
    const used = { expiresAt: new Date(now + OTP_TTL_MS), attempts: 1, consumedAt: new Date(now) };
    expect(evaluateVerify(used, "424242", codeHash, SECRET, now)).toBe("consumed");
  });

  it("@AC-7.5 attempts at the cap → exhausted (fail-closed before compare)", () => {
    const maxed = {
      expiresAt: new Date(now + OTP_TTL_MS),
      attempts: MAX_VERIFY_ATTEMPTS,
      consumedAt: null
    };
    expect(evaluateVerify(maxed, "424242", codeHash, SECRET, now)).toBe("exhausted");
  });
});

describe("cooldownRemainingMs", () => {
  it("@AC-7.5 returns remaining ms inside the cooldown, 0 once elapsed", () => {
    const now = Date.now();
    expect(cooldownRemainingMs(new Date(now - 10_000), now)).toBeGreaterThan(0);
    expect(cooldownRemainingMs(new Date(now - RESEND_COOLDOWN_MS - 1), now)).toBe(0);
    expect(cooldownRemainingMs(null, now)).toBe(0);
  });
});

describe("anti-abuse constants", () => {
  it("@AC-7.5 sane defaults", () => {
    expect(OTP_TTL_MS).toBe(5 * 60 * 1000);
    expect(MAX_VERIFY_ATTEMPTS).toBeGreaterThanOrEqual(3);
    expect(RESEND_COOLDOWN_MS).toBeGreaterThanOrEqual(30 * 1000);
    expect(MAX_SENDS_PER_WINDOW).toBeGreaterThanOrEqual(3);
  });
});

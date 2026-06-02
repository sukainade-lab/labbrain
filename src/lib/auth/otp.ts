import { createHmac, randomInt, timingSafeEqual } from "node:crypto";

// OTP primitives + pure challenge-state rules (S7 AC-7.2 / AC-7.3 / AC-7.5).
//
// The plaintext code is shown to the user once (over SMS) and never persisted —
// the DB stores only hashOtp(code, secret). Verification is constant-time and
// fail-closed: expiry, single-use, and the attempt cap are all checked BEFORE the
// code comparison, so a guessing client burns its budget and learns nothing.

export const OTP_LENGTH = 6;
export const OTP_TTL_MS = 5 * 60 * 1000; // 5-minute code lifetime
export const MAX_VERIFY_ATTEMPTS = 5; // wrong guesses per challenge before lockout
export const RESEND_COOLDOWN_MS = 60 * 1000; // min gap between sends to one number
export const MAX_SENDS_PER_WINDOW = 5; // sends per number per window
export const SEND_WINDOW_MS = 60 * 60 * 1000; // 1-hour send window

/** Cryptographically-random zero-padded 6-digit code. */
export function generateOtp(): string {
  return String(randomInt(0, 1_000_000)).padStart(OTP_LENGTH, "0");
}

/** HMAC-SHA256(code, secret) as lowercase hex — what we store, never the code. */
export function hashOtp(code: string, secret: string): string {
  return createHmac("sha256", secret).update(code).digest("hex");
}

/** Constant-time compare of a submitted code against a stored hash. */
export function compareOtp(code: string, storedHash: string, secret: string): boolean {
  const candidate = Buffer.from(hashOtp(code, secret), "hex");
  let expected: Buffer;
  try {
    expected = Buffer.from(storedHash, "hex");
  } catch {
    return false;
  }
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}

export type ChallengeState = {
  expiresAt: string | Date;
  attempts: number;
  consumedAt: string | Date | null;
};

export type VerifyDecision = "ok" | "consumed" | "expired" | "exhausted" | "wrong";

/**
 * Decide the outcome of a verify attempt against a challenge row. Order matters:
 * single-use → attempt cap → expiry are all enforced before the code is compared,
 * so the function fails closed and never leaks timing on a dead challenge.
 */
export function evaluateVerify(
  state: ChallengeState,
  submittedCode: string,
  codeHash: string,
  secret: string,
  now: number = Date.now()
): VerifyDecision {
  if (state.consumedAt) return "consumed";
  if (state.attempts >= MAX_VERIFY_ATTEMPTS) return "exhausted";
  if (new Date(state.expiresAt).getTime() <= now) return "expired";
  return compareOtp(submittedCode, codeHash, secret) ? "ok" : "wrong";
}

/** ms left on the resend cooldown given the last send time; 0 when clear. */
export function cooldownRemainingMs(
  lastSentAt: string | Date | null,
  now: number = Date.now()
): number {
  if (!lastSentAt) return 0;
  const elapsed = now - new Date(lastSentAt).getTime();
  return Math.max(0, RESEND_COOLDOWN_MS - elapsed);
}

import { createHmac, timingSafeEqual } from "node:crypto";

// App-level session-elevation marker (S7 AC-7.3 / AC-7.4).
//
// After a 2FA-enabled user passes the OTP step we set a signed httpOnly `lb_mfa`
// cookie carrying {userId, exp}. Middleware requires it before letting that user
// into the (app) group. This is stateless and provider-agnostic — no Supabase AAL2
// dashboard config — and verifies entirely from MFA_COOKIE_SECRET. Tampering with
// the payload or replaying past `exp` fails verification.

export const MFA_COOKIE_NAME = "lb_mfa";
export const MFA_COOKIE_TTL_MS = 12 * 60 * 60 * 1000; // 12-hour elevation

/** httpOnly cookie options for the lb_mfa marker (secure outside dev). */
export function mfaCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.floor(MFA_COOKIE_TTL_MS / 1000)
  };
}

type Payload = { userId: string; exp: number };

function sign(payloadB64: string, secret: string): string {
  return createHmac("sha256", secret).update(payloadB64).digest("base64url");
}

/**
 * Sign an elevation marker for `userId`. `expiresAt` defaults to now + TTL; pass an
 * explicit timestamp (e.g. a past one) to mint a marker with a chosen expiry.
 */
export function signMfaCookie(
  userId: string,
  secret: string,
  expiresAt: number = Date.now() + MFA_COOKIE_TTL_MS
): string {
  const payload: Payload = { userId, exp: expiresAt };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${payloadB64}.${sign(payloadB64, secret)}`;
}

/**
 * Verify a marker and return its userId, or null if the token is malformed, the
 * signature doesn't match, or it has expired. Never throws.
 */
export function verifyMfaCookie(
  token: string | null | undefined,
  secret: string,
  now: number = Date.now()
): { userId: string } | null {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, sig] = parts;

  const expected = sign(payloadB64, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString()) as Payload;
    if (!payload?.userId || typeof payload.exp !== "number") return null;
    if (payload.exp <= now) return null;
    return { userId: payload.userId };
  } catch {
    return null;
  }
}

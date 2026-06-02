import { createAdminClient } from "@/lib/supabase/admin";
import {
  generateOtp,
  hashOtp,
  evaluateVerify,
  cooldownRemainingMs,
  type VerifyDecision,
  OTP_TTL_MS,
  MAX_SENDS_PER_WINDOW,
  SEND_WINDOW_MS
} from "@/lib/auth/otp";
import { sendOtpSms } from "@/lib/sms/unifonic";

// 2FA service layer (S7). Challenges are SERVICE-ROLE managed — the table has RLS on
// with no policies, so only this server-side code (via the admin client) can issue,
// read, and consume them (AC-7.5 fail-closed). Routes stay thin; all the OTP/DB
// orchestration lives here so the live DB suite (L2) can exercise it directly.

export type Purpose = "login" | "enroll" | "disable";
type Admin = ReturnType<typeof createAdminClient>;

/** Single server secret — HMAC key for both the OTP hash and the lb_mfa cookie. */
export function mfaSecret(): string {
  const s = process.env.MFA_COOKIE_SECRET;
  if (!s) throw new Error("MFA_COOKIE_SECRET is not set — cannot run 2FA.");
  return s;
}

export type UserMfa = {
  phone: string | null;
  mfa_enabled: boolean;
  phone_verified_at: string | null;
};

export async function getUserMfa(admin: Admin, userId: string): Promise<UserMfa | null> {
  const { data } = await admin
    .from("users")
    .select("phone, mfa_enabled, phone_verified_at")
    .eq("id", userId)
    .maybeSingle();
  return (data as UserMfa) ?? null;
}

export type IssueResult =
  | { ok: true; messageId: string | null }
  | { ok: false; reason: "cooldown" | "rate_limited"; retryAfterMs: number };

/**
 * Issue an OTP challenge for (userId, purpose) and SMS it to `recipient` (Unifonic
 * international form, no +). Enforces a per-purpose resend cooldown and a per-user
 * send budget per window before generating anything. On a send failure the freshly
 * inserted row is removed and the error propagates (fail closed — no dead challenge).
 */
export async function issueChallenge(
  admin: Admin,
  opts: { userId: string; recipient: string; purpose: Purpose },
  now: number = Date.now()
): Promise<IssueResult> {
  // Resend cooldown — newest challenge for this purpose.
  const { data: last } = await admin
    .from("mfa_challenges")
    .select("created_at")
    .eq("user_id", opts.userId)
    .eq("purpose", opts.purpose)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const remaining = cooldownRemainingMs(last?.created_at ?? null, now);
  if (remaining > 0) return { ok: false, reason: "cooldown", retryAfterMs: remaining };

  // Per-user send budget across the window (all purposes).
  const sinceIso = new Date(now - SEND_WINDOW_MS).toISOString();
  const { count } = await admin
    .from("mfa_challenges")
    .select("id", { count: "exact", head: true })
    .eq("user_id", opts.userId)
    .gte("created_at", sinceIso);
  if ((count ?? 0) >= MAX_SENDS_PER_WINDOW) {
    return { ok: false, reason: "rate_limited", retryAfterMs: SEND_WINDOW_MS };
  }

  const code = generateOtp();
  const { data: inserted, error } = await admin
    .from("mfa_challenges")
    .insert({
      user_id: opts.userId,
      purpose: opts.purpose,
      code_hash: hashOtp(code, mfaSecret()),
      expires_at: new Date(now + OTP_TTL_MS).toISOString()
    })
    .select("id")
    .single();
  if (error || !inserted) throw new Error("Failed to create MFA challenge.");

  try {
    const { messageId } = await sendOtpSms(opts.recipient, code);
    return { ok: true, messageId };
  } catch (e) {
    // Don't leave an unsendable challenge lying around.
    await admin.from("mfa_challenges").delete().eq("id", inserted.id);
    throw e;
  }
}

/**
 * Verify a submitted code against the newest live challenge for (userId, purpose).
 * Wrong guesses bump the attempt counter; a correct code burns the challenge
 * (single-use). Returns the decision; the caller maps it to a response + side effect.
 */
export async function verifyChallenge(
  admin: Admin,
  opts: { userId: string; purpose: Purpose; code: string },
  now: number = Date.now()
): Promise<VerifyDecision> {
  const { data: challenge } = await admin
    .from("mfa_challenges")
    .select("id, code_hash, expires_at, attempts, consumed_at")
    .eq("user_id", opts.userId)
    .eq("purpose", opts.purpose)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!challenge) return "expired"; // nothing to verify against → treat as expired

  const decision = evaluateVerify(
    {
      expiresAt: challenge.expires_at,
      attempts: challenge.attempts,
      consumedAt: challenge.consumed_at
    },
    opts.code,
    challenge.code_hash,
    mfaSecret(),
    now
  );

  if (decision === "ok") {
    await admin
      .from("mfa_challenges")
      .update({ consumed_at: new Date(now).toISOString() })
      .eq("id", challenge.id);
  } else if (decision === "wrong") {
    await admin
      .from("mfa_challenges")
      .update({ attempts: challenge.attempts + 1 })
      .eq("id", challenge.id);
  }

  return decision;
}

/** Localized (Arabic) message for a non-ok verify decision. */
export function verifyErrorMessage(decision: Exclude<VerifyDecision, "ok">): string {
  switch (decision) {
    case "wrong":
      return "الرمز غير صحيح. حاول مرة أخرى.";
    case "expired":
      return "انتهت صلاحية الرمز. اطلب رمزاً جديداً.";
    case "exhausted":
      return "تجاوزت عدد المحاولات المسموح بها. اطلب رمزاً جديداً.";
    case "consumed":
      return "تم استخدام هذا الرمز مسبقاً. اطلب رمزاً جديداً.";
  }
}

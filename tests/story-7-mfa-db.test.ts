import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// S7 — live DB suite for mfa_challenges (lesson L2: serialized + unique-user scoped,
// cleans up in afterAll; CI runs the live job with --no-file-parallelism). Exercises
// the real table, its RLS posture, and the issue/verify lifecycle against Supabase.
//
// The Unifonic seam is mocked so no real SMS is sent — and the mock CAPTURES the
// generated plaintext code (issueChallenge hashes it before storing), which is the
// only way to then drive a real verify round-trip.

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const hasLiveSupabase = Boolean(url && anonKey && serviceKey);

let captured = "";
vi.mock("@/lib/sms/unifonic", () => ({
  sendOtpSms: vi.fn(async (_recipient: string, code: string) => {
    captured = code;
    return { messageId: "TEST-MSG" };
  }),
  sendSms: vi.fn(async () => ({ messageId: "TEST-MSG" })),
  otpSmsBody: (c: string) => c
}));

import { issueChallenge, verifyChallenge } from "@/lib/auth/mfa";

const PASSWORD = "Test-Passw0rd!";
const uniq = (p: string) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2)}@labbrain.test`;
const RECIPIENT = "962791234567";

describe.skipIf(!hasLiveSupabase).sequential("Story 7 — mfa_challenges (live DB)", () => {
  let admin: SupabaseClient;
  let tenantId: string;
  let userId: string;
  let userEmail: string;

  beforeAll(async () => {
    process.env.MFA_COOKIE_SECRET ||= "live-db-test-mfa-secret-32-bytes-min";
    admin = createClient(url!, serviceKey!, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
    const { data: tenant } = await admin
      .from("tenants")
      .insert({ name: `MFA DB Lab ${Date.now()}` })
      .select("id")
      .single();
    tenantId = tenant!.id;
    userEmail = uniq("mfa");
    const { data: created } = await admin.auth.admin.createUser({
      email: userEmail,
      password: PASSWORD,
      email_confirm: true
    });
    userId = created!.user!.id;
    await admin
      .from("users")
      .insert({ id: userId, tenant_id: tenantId, email: userEmail, role: "owner" });
  });

  afterAll(async () => {
    if (!admin) return;
    await admin.from("mfa_challenges").delete().eq("user_id", userId);
    await admin.from("tenants").delete().eq("id", tenantId);
    try {
      await admin.auth.admin.deleteUser(userId);
    } catch {
      /* best-effort */
    }
  });

  beforeEach(async () => {
    await admin.from("mfa_challenges").delete().eq("user_id", userId);
    captured = "";
  });

  it("@AC-7.2 issueChallenge stores a HASHED code (never plaintext), 5-min TTL, attempts 0", async () => {
    const now = Date.now();
    const res = await issueChallenge(admin, { userId, recipient: RECIPIENT, purpose: "enroll" }, now);
    expect(res.ok).toBe(true);
    expect(captured).toMatch(/^\d{6}$/);

    const { data: rows } = await admin
      .from("mfa_challenges")
      .select("code_hash, purpose, attempts, consumed_at, expires_at")
      .eq("user_id", userId);
    expect(rows).toHaveLength(1);
    const row = rows![0];
    expect(row.code_hash).not.toContain(captured); // hashed, not the plaintext
    expect(row.code_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(row.purpose).toBe("enroll");
    expect(row.attempts).toBe(0);
    expect(row.consumed_at).toBeNull();
    const ttlMs = new Date(row.expires_at).getTime() - now;
    expect(ttlMs).toBeGreaterThan(4 * 60 * 1000);
    expect(ttlMs).toBeLessThanOrEqual(5 * 60 * 1000 + 1000);
  });

  it("@AC-7.5 a client (even the owner's session) cannot read mfa_challenges — RLS", async () => {
    await issueChallenge(admin, { userId, recipient: RECIPIENT, purpose: "login" });

    const userClient = createClient(url!, anonKey!, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
    await userClient.auth.signInWithPassword({ email: userEmail, password: PASSWORD });
    const { data: clientRows } = await userClient.from("mfa_challenges").select("*");
    expect(clientRows ?? []).toHaveLength(0); // RLS (no policies) hides every row

    // ...while the service role sees it.
    const { data: adminRows } = await admin
      .from("mfa_challenges")
      .select("id")
      .eq("user_id", userId);
    expect(adminRows!.length).toBeGreaterThan(0);
  });

  it("@AC-7.3 correct code → ok, then single-use (consumed)", async () => {
    await issueChallenge(admin, { userId, recipient: RECIPIENT, purpose: "login" });
    const code = captured;

    expect(await verifyChallenge(admin, { userId, purpose: "login", code })).toBe("ok");
    const { data: rows } = await admin
      .from("mfa_challenges")
      .select("consumed_at")
      .eq("user_id", userId);
    expect(rows![0].consumed_at).not.toBeNull();

    // Re-using the same code now fails — single-use.
    expect(await verifyChallenge(admin, { userId, purpose: "login", code })).toBe("consumed");
  });

  it("@AC-7.3 wrong code → wrong + attempt counter increments", async () => {
    await issueChallenge(admin, { userId, recipient: RECIPIENT, purpose: "login" });
    expect(await verifyChallenge(admin, { userId, purpose: "login", code: "000000" })).toBe("wrong");
    const { data: rows } = await admin
      .from("mfa_challenges")
      .select("attempts")
      .eq("user_id", userId);
    expect(rows![0].attempts).toBe(1);
  });

  it("@AC-7.5 an immediate resend is blocked by the cooldown", async () => {
    const first = await issueChallenge(admin, { userId, recipient: RECIPIENT, purpose: "login" });
    expect(first.ok).toBe(true);
    const second = await issueChallenge(admin, { userId, recipient: RECIPIENT, purpose: "login" });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe("cooldown");
  });

  it("@AC-7.3 verify with no live challenge → expired", async () => {
    expect(await verifyChallenge(admin, { userId, purpose: "login", code: "123456" })).toBe("expired");
  });
});

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Story 1 — HTTP route-handler integration tests (the seam unit tests bypass).
// Lesson L1: the invite-mode `labName` bug reached review because every test
// called the logic layer directly. These tests POST to the actual route handlers.
//
// The signup route runs fully live against local Supabase. The invitations route
// imports @/lib/supabase/server (which pulls next/headers + a cookie-bound
// session) — we mock only the auth/role resolution; createInvitation still hits
// live Supabase, so seat-limit + insert behaviour is exercised for real.

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const hasLiveSupabase = Boolean(url && anonKey && serviceKey);

const PASSWORD = "Test-Passw0rd!";
const uniq = (p: string) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2)}@labbrain.test`;

// Fake server client state — set per test; referenced by the hoisted mock below.
// `anon` is a real anon-key client wired up in beforeAll: the login/forgot/logout
// routes go through the actual Supabase auth seam (signInWithPassword, etc.), so
// these tests exercise real credential checks, not a stubbed happy path.
const h = vi.hoisted(() => ({
  state: {
    user: null as { id: string } | null,
    me: null as { tenant_id: string; role: string } | null,
    anon: null as SupabaseClient | null
  }
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: h.state.user } }),
      signInWithPassword: (input: { email: string; password: string }) =>
        h.state.anon!.auth.signInWithPassword(input),
      resetPasswordForEmail: (email: string, opts: { redirectTo: string }) =>
        h.state.anon!.auth.resetPasswordForEmail(email, opts),
      signOut: () => h.state.anon!.auth.signOut()
    },
    from: () => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: h.state.me }) }) })
    })
  })
}));

// Imported after the mock is declared (vi.mock is hoisted above imports).
import { POST as signupPOST } from "@/app/api/auth/signup/route";
import { POST as invitePOST } from "@/app/api/invitations/route";
import { POST as loginPOST } from "@/app/api/auth/login/route";
import { POST as forgotPOST } from "@/app/api/auth/forgot/route";
import { POST as logoutPOST } from "@/app/api/auth/logout/route";
import { createInvitation } from "@/lib/auth/invitations";

function postJson(handler: (req: Request) => Promise<Response>, body: unknown) {
  return handler(
    new Request("http://localhost/x", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    })
  );
}

describe.skipIf(!hasLiveSupabase)("Story 1 — route handlers", () => {
  let admin: SupabaseClient;
  const tenantsToReap: string[] = [];
  const authUsersToReap: string[] = [];

  // A bare confirmed auth user (no tenant row) — enough to exercise the login seam.
  async function makeConfirmedUser() {
    const email = uniq("login");
    const { data: created } = await admin.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true
    });
    authUsersToReap.push(created!.user.id);
    return { email };
  }

  // Reap a tenant: capture its auth user ids, drop the tenant (cascades users,
  // invitations, etc.), then delete the orphaned auth.users rows.
  async function reapTenant(tenantId: string) {
    const { data: us } = await admin.from("users").select("id").eq("tenant_id", tenantId);
    await admin.from("tenants").delete().eq("id", tenantId);
    for (const u of us ?? []) {
      try {
        await admin.auth.admin.deleteUser(u.id);
      } catch {
        /* best-effort */
      }
    }
  }

  async function makeOwnerTenant(name: string, plan: "starter" | "pro" = "starter") {
    const { data: tenant } = await admin
      .from("tenants")
      .insert({ name, plan })
      .select("id")
      .single();
    const email = uniq("owner");
    const { data: created } = await admin.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true
    });
    const ownerId = created!.user.id;
    await admin.from("users").insert({ id: ownerId, tenant_id: tenant!.id, email, role: "owner" });
    tenantsToReap.push(tenant!.id);
    return { tenantId: tenant!.id as string, ownerId, ownerEmail: email };
  }

  async function addUser(tenantId: string) {
    const email = uniq("filler");
    const { data: created } = await admin.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true
    });
    await admin
      .from("users")
      .insert({ id: created!.user.id, tenant_id: tenantId, email, role: "member" });
  }

  beforeAll(() => {
    admin = createClient(url!, serviceKey!, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
    // The login/forgot/logout routes call this through the mocked server client.
    h.state.anon = createClient(url!, anonKey!, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
  });

  afterAll(async () => {
    for (const id of tenantsToReap) await reapTenant(id);
    for (const id of authUsersToReap) {
      try {
        await admin.auth.admin.deleteUser(id);
      } catch {
        /* best-effort */
      }
    }
  });

  // ── /api/auth/signup ───────────────────────────────────────────────────────

  it("@AC-1.1 POST /api/auth/signup with a malformed body → 400", async () => {
    const res = await postJson(signupPOST, { email: "not-an-email", password: "x" });
    expect(res.status).toBe(400);
  });

  it("@AC-1.1 POST /api/auth/signup new lab → 201 + onboarding next", async () => {
    const res = await postJson(signupPOST, {
      labName: "Route New Lab",
      adminName: "Owner One",
      email: uniq("newlab"),
      password: PASSWORD
    });
    const data = await res.json();
    expect(res.status).toBe(201);
    expect(data.ok).toBe(true);
    expect(data.next).toBe("/onboarding");
    expect(data.tenantId).toBeTruthy();
    tenantsToReap.push(data.tenantId);
  });

  // AC-4.2 — a logged-out plan pick rides in on the signup body; the response
  // `next` (and the confirmation email's redirect) must carry it so checkout
  // resumes after the account is confirmed instead of dead-ending.
  it("@AC-4.2 POST /api/auth/signup with a carried plan → 201 + resume next", async () => {
    const res = await postJson(signupPOST, {
      labName: "Resume Lab",
      adminName: "Owner Resume",
      email: uniq("resume"),
      password: PASSWORD,
      plan: "pro",
      interval: "year"
    });
    const data = await res.json();
    expect(res.status).toBe(201);
    expect(data.next).toBe("/onboarding?plan=pro&interval=year");
    tenantsToReap.push(data.tenantId);
  });

  it("@AC-4.2 POST /api/auth/signup with an off-list plan → falls back to plain onboarding", async () => {
    const res = await postJson(signupPOST, {
      labName: "Bad Plan Lab",
      adminName: "Owner Bad",
      email: uniq("badplan"),
      password: PASSWORD,
      plan: "enterprise",
      interval: "year"
    });
    const data = await res.json();
    expect(res.status).toBe(201);
    expect(data.next).toBe("/onboarding");
    tenantsToReap.push(data.tenantId);
  });

  it("@AC-1.1 POST /api/auth/signup duplicate email → 409", async () => {
    const email = uniq("dup");
    const first = await postJson(signupPOST, {
      labName: "Dup Lab",
      adminName: "Owner",
      email,
      password: PASSWORD
    });
    const firstData = await first.json();
    expect(first.status).toBe(201);
    tenantsToReap.push(firstData.tenantId);

    const second = await postJson(signupPOST, {
      labName: "Dup Lab 2",
      adminName: "Owner",
      email,
      password: PASSWORD
    });
    const secondData = await second.json();
    expect(second.status).toBe(409);
    expect(secondData.code).toBe("duplicate");
  });

  it("@AC-1.4 POST /api/auth/signup with a valid invite → 201 + joins inviter tenant", async () => {
    const { tenantId } = await makeOwnerTenant("Invite Target Lab");
    const inviteEmail = uniq("invitee");
    const invite = await createInvitation(admin, { tenantId, email: inviteEmail, role: "member" });

    const res = await postJson(signupPOST, {
      adminName: "Invited Member",
      email: inviteEmail,
      password: PASSWORD,
      inviteToken: invite.token
    });
    const data = await res.json();
    expect(res.status).toBe(201);
    expect(data.tenantId).toBe(tenantId); // joined the inviter's tenant, no new one
  });

  it("@AC-1.4 POST /api/auth/signup with an invite for a different email → 400", async () => {
    const { tenantId } = await makeOwnerTenant("Mismatch Lab");
    const invite = await createInvitation(admin, {
      tenantId,
      email: uniq("intended"),
      role: "member"
    });

    const res = await postJson(signupPOST, {
      adminName: "Wrong Person",
      email: uniq("attacker"),
      password: PASSWORD,
      inviteToken: invite.token
    });
    const data = await res.json();
    expect(res.status).toBe(400);
    expect(data.code).toBe("invalid_invite");
  });

  it("@AC-1.6 POST /api/auth/signup against a full tenant → 402 seat_limit", async () => {
    const { tenantId } = await makeOwnerTenant("Full Signup Lab"); // 1 user
    const inviteEmail = uniq("late-invitee");
    // Create the invite while there's still room (1 user + 1 pending = 2 < 5)...
    const invite = await createInvitation(admin, { tenantId, email: inviteEmail, role: "member" });
    // ...then fill the tenant to the Starter cap of 5 *users* before acceptance.
    await addUser(tenantId);
    await addUser(tenantId);
    await addUser(tenantId);
    await addUser(tenantId); // now 5 users

    const res = await postJson(signupPOST, {
      adminName: "Too Late",
      email: inviteEmail,
      password: PASSWORD,
      inviteToken: invite.token
    });
    const data = await res.json();
    expect(res.status).toBe(402);
    expect(data.code).toBe("seat_limit");
  });

  // ── /api/invitations ─────────────────────────────────────────────────────────

  it("@AC-1.4 POST /api/invitations unauthenticated → 401", async () => {
    h.state.user = null;
    h.state.me = null;
    const res = await postJson(invitePOST, { email: uniq("x"), role: "member" });
    expect(res.status).toBe(401);
  });

  it("@AC-1.4 POST /api/invitations as a member → 403", async () => {
    const { tenantId } = await makeOwnerTenant("Member Authz Lab");
    h.state.user = { id: "anyone" };
    h.state.me = { tenant_id: tenantId, role: "member" };
    const res = await postJson(invitePOST, { email: uniq("x"), role: "member" });
    expect(res.status).toBe(403);
  });

  it("@AC-1.4 POST /api/invitations as owner → 201", async () => {
    const { tenantId, ownerId } = await makeOwnerTenant("Owner Invites Lab");
    h.state.user = { id: ownerId };
    h.state.me = { tenant_id: tenantId, role: "owner" };
    const res = await postJson(invitePOST, { email: uniq("teammate"), role: "member" });
    expect(res.status).toBe(201);
  });

  it("@AC-1.6 POST /api/invitations on a full tenant → 402 seat_limit", async () => {
    const { tenantId, ownerId } = await makeOwnerTenant("Full Invite Lab"); // 1 user
    await addUser(tenantId);
    await addUser(tenantId);
    await addUser(tenantId);
    await addUser(tenantId); // 5 users, cap reached
    h.state.user = { id: ownerId };
    h.state.me = { tenant_id: tenantId, role: "owner" };
    const res = await postJson(invitePOST, { email: uniq("overflow"), role: "member" });
    const data = await res.json();
    expect(res.status).toBe(402);
    expect(data.code).toBe("seat_limit");
  });

  // ── /api/auth/login ──────────────────────────────────────────────────────────

  it("@AC-1.5 POST /api/auth/login with a malformed body → 400", async () => {
    const res = await postJson(loginPOST, { email: "not-an-email" });
    expect(res.status).toBe(400);
  });

  it("@AC-1.5 POST /api/auth/login with correct credentials → 200 + dashboard next", async () => {
    const { email } = await makeConfirmedUser();
    const res = await postJson(loginPOST, { email, password: PASSWORD });
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.next).toBe("/dashboard");
  });

  it("@AC-1.5 POST /api/auth/login with a wrong password → 401", async () => {
    const { email } = await makeConfirmedUser();
    const res = await postJson(loginPOST, { email, password: "WrongPassw0rd!" });
    const data = await res.json();
    expect(res.status).toBe(401);
    expect(data.error).toBeTruthy(); // Arabic credential-error message
  });

  // ── /api/auth/forgot ─────────────────────────────────────────────────────────

  it("@AC-1.5 POST /api/auth/forgot for a registered email → 200 (no enumeration)", async () => {
    const { email } = await makeConfirmedUser();
    const res = await postJson(forgotPOST, { email });
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
  });

  it("@AC-1.5 POST /api/auth/forgot for an unknown email → 200 (same response)", async () => {
    const res = await postJson(forgotPOST, { email: uniq("ghost") });
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
  });

  // ── /api/auth/logout ─────────────────────────────────────────────────────────

  it("@AC-1.5 POST /api/auth/logout → 200 + login next", async () => {
    const res = await postJson(logoutPOST, {});
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.next).toBe("/login");
  });
});

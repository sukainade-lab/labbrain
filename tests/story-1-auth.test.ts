import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { provisionSignup, SignupError } from "@/lib/auth/provision";
import { safeNext } from "@/lib/auth/redirect";
import { attemptLogin, mapAuthError } from "@/lib/auth/login";
import { loginSchema, forgotSchema, signupSchema } from "@/lib/validation/auth";
import { createInvitation, getSeatUsage } from "@/lib/auth/invitations";

// Story 1 — Authentication, tenancy & team management.
// AC-1.3 runs against a live Supabase (local CLI) — tenant isolation is a P0
// compliance guarantee and is never mocked. Remaining ACs land as built.

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const hasLiveSupabase = Boolean(url && anonKey && serviceKey);

const PASSWORD = "Test-Passw0rd!";

async function makeTenant(admin: SupabaseClient, name: string, emailPrefix: string) {
  const { data: tenant, error: tErr } = await admin
    .from("tenants")
    .insert({ name })
    .select()
    .single();
  if (tErr) throw tErr;

  const email = `${emailPrefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@labbrain.test`;
  const { data: created, error: uErr } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true
  });
  if (uErr) throw uErr;
  const authUserId = created.user.id;

  const { error: linkErr } = await admin
    .from("users")
    .insert({ id: authUserId, tenant_id: tenant.id, email, role: "owner" });
  if (linkErr) throw linkErr;

  const { data: doc, error: dErr } = await admin
    .from("documents")
    .insert({ tenant_id: tenant.id, filename: `${name}.pdf`, storage_path: `${tenant.id}/${name}.pdf` })
    .select()
    .single();
  if (dErr) throw dErr;

  const { error: cErr } = await admin.from("document_chunks").insert({
    tenant_id: tenant.id,
    document_id: doc.id,
    chunk_index: 0,
    content: `${name} chunk content`,
    page_number: 1
  });
  if (cErr) throw cErr;

  const { error: qErr } = await admin
    .from("queries")
    .insert({ tenant_id: tenant.id, user_id: authUserId, question: `${name} question?` });
  if (qErr) throw qErr;

  return { tenantId: tenant.id as string, email, docId: doc.id as string };
}

describe.skipIf(!hasLiveSupabase)("Story 1 — Auth & tenancy", () => {
  let admin: SupabaseClient;
  let labA: { tenantId: string; email: string; docId: string };
  let labB: { tenantId: string; email: string; docId: string };
  let clientA: SupabaseClient;

  beforeAll(async () => {
    admin = createClient(url!, serviceKey!, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
    labA = await makeTenant(admin, "LabA", "owner-a");
    labB = await makeTenant(admin, "LabB", "owner-b");

    clientA = createClient(url!, anonKey!, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
    const { error } = await clientA.auth.signInWithPassword({
      email: labA.email,
      password: PASSWORD
    });
    if (error) throw error;
  });

  afterAll(async () => {
    // Cascade-deletes users, documents, chunks, queries for both tenants.
    if (admin && labA) await admin.from("tenants").delete().eq("id", labA.tenantId);
    if (admin && labB) await admin.from("tenants").delete().eq("id", labB.tenantId);
  });

  it("@AC-1.3 Lab A token sees only its own documents", async () => {
    const { data, error } = await clientA.from("documents").select("id, tenant_id");
    expect(error).toBeNull();
    expect(data).not.toBeNull();
    expect(data!.length).toBeGreaterThan(0);
    expect(data!.every((row) => row.tenant_id === labA.tenantId)).toBe(true);
    expect(data!.some((row) => row.id === labB.docId)).toBe(false);
  });

  it("@AC-1.3 Lab A token cannot read a specific Lab B document by id", async () => {
    const { data, error } = await clientA
      .from("documents")
      .select("id")
      .eq("id", labB.docId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("@AC-1.3 Lab A token sees only its own document_chunks", async () => {
    const { data, error } = await clientA.from("document_chunks").select("tenant_id");
    expect(error).toBeNull();
    expect(data!.every((row) => row.tenant_id === labA.tenantId)).toBe(true);
  });

  it("@AC-1.3 Lab A token sees only its own queries", async () => {
    const { data, error } = await clientA.from("queries").select("tenant_id");
    expect(error).toBeNull();
    expect(data!.every((row) => row.tenant_id === labA.tenantId)).toBe(true);
  });

  it("@AC-1.3 Lab A token sees only users in its own tenant", async () => {
    const { data, error } = await clientA.from("users").select("tenant_id");
    expect(error).toBeNull();
    expect(data!.every((row) => row.tenant_id === labA.tenantId)).toBe(true);
  });

  it("@AC-1.1 signup provisions a tenant + owner user from lab/admin/email/password", async () => {
    const email = `signup-${Date.now()}-${Math.random().toString(36).slice(2)}@labbrain.test`;
    const result = await provisionSignup({
      labName: "Acme Calibration Lab",
      adminName: "Ahmad Khatib",
      email,
      password: "Test-Passw0rd!"
    });
    try {
      expect(result.role).toBe("owner");
      expect(result.tenantId).toBeTruthy();

      const { data: tenant } = await admin
        .from("tenants")
        .select("name, plan, status")
        .eq("id", result.tenantId)
        .single();
      expect(tenant?.name).toBe("Acme Calibration Lab");
      expect(tenant?.plan).toBe("starter");

      const { data: userRow } = await admin
        .from("users")
        .select("email, role, tenant_id")
        .eq("id", result.userId)
        .single();
      expect(userRow?.email).toBe(email);
      expect(userRow?.role).toBe("owner");
      expect(userRow?.tenant_id).toBe(result.tenantId);

      const { data: authUser } = await admin.auth.admin.getUserById(result.userId);
      expect(authUser.user?.email).toBe(email);
    } finally {
      await admin.from("tenants").delete().eq("id", result.tenantId);
      await admin.auth.admin.deleteUser(result.userId);
    }
  });

  it("@AC-1.1 duplicate email is rejected and leaves no orphan tenant", async () => {
    const email = `dup-${Date.now()}-${Math.random().toString(36).slice(2)}@labbrain.test`;
    const first = await provisionSignup({
      labName: "First Lab",
      adminName: "First Owner",
      email,
      password: "Test-Passw0rd!"
    });
    // Unique name for the doomed second attempt, so the orphan check is immune to
    // tenants created concurrently by other test files (no global row count).
    const secondLabName = `Second Lab ${Math.random().toString(36).slice(2)}`;
    try {
      await expect(
        provisionSignup({
          labName: secondLabName,
          adminName: "Second Owner",
          email,
          password: "Test-Passw0rd!"
        })
      ).rejects.toBeInstanceOf(SignupError);
      const { count: orphans } = await admin
        .from("tenants")
        .select("id", { count: "exact", head: true })
        .eq("name", secondLabName);
      expect(orphans ?? 0).toBe(0); // failed signup rolled back its tenant
    } finally {
      await admin.from("tenants").delete().eq("id", first.tenantId);
      await admin.auth.admin.deleteUser(first.userId);
    }
  });

  it("@AC-1.5 login succeeds with correct credentials", async () => {
    const fresh = createClient(url!, anonKey!, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
    const result = await attemptLogin(fresh, { email: labA.email, password: PASSWORD });
    expect(result.ok).toBe(true);
  });

  it("@AC-1.5 login with wrong credentials returns a friendly error", async () => {
    const fresh = createClient(url!, anonKey!, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
    const result = await attemptLogin(fresh, {
      email: labA.email,
      password: "wrong-password"
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("البريد الإلكتروني أو كلمة المرور غير صحيحة");
  });

  it("@AC-1.4 invited user signs up via token and joins the same tenant", async () => {
    const inviteEmail = `invitee-${Date.now()}-${Math.random().toString(36).slice(2)}@labbrain.test`;
    const invite = await createInvitation(admin, {
      tenantId: labA.tenantId,
      email: inviteEmail,
      role: "member"
    });

    const result = await provisionSignup({
      labName: "ignored-for-invite",
      adminName: "Invited Member",
      email: inviteEmail,
      password: PASSWORD,
      inviteToken: invite.token
    });
    try {
      expect(result.tenantId).toBe(labA.tenantId);
      expect(result.role).toBe("member");

      const { data: inviteRow } = await admin
        .from("invitations")
        .select("accepted_at")
        .eq("id", invite.id)
        .single();
      expect(inviteRow?.accepted_at).not.toBeNull();
    } finally {
      await admin.from("users").delete().eq("id", result.userId);
      await admin.auth.admin.deleteUser(result.userId);
      await admin.from("invitations").delete().eq("id", invite.id);
    }
  });

  it("@AC-1.6 seat limits: Starter=5, Pro=20", async () => {
    const starter = await getSeatUsage(admin, labA.tenantId); // labA is starter
    expect(starter.limit).toBe(5);

    const { data: proTenant } = await admin
      .from("tenants")
      .insert({ name: "ProLab", plan: "pro" })
      .select("id")
      .single();
    try {
      const pro = await getSeatUsage(admin, proTenant!.id);
      expect(pro.limit).toBe(20);
    } finally {
      await admin.from("tenants").delete().eq("id", proTenant!.id);
    }
  });

  it("@AC-1.6 over-limit invite is rejected with a seat_limit upgrade prompt", async () => {
    const { data: tenant } = await admin
      .from("tenants")
      .insert({ name: "FullStarterLab", plan: "starter" })
      .select("id")
      .single();
    const tenantId = tenant!.id as string;
    try {
      // Fill all 5 starter seats with pending invitations.
      for (let i = 0; i < 5; i++) {
        await createInvitation(admin, { tenantId, email: `seat${i}@labbrain.test`, role: "member" });
      }
      const usage = await getSeatUsage(admin, tenantId);
      expect(usage.used).toBe(5);
      expect(usage.available).toBe(0);

      await expect(
        createInvitation(admin, { tenantId, email: "overflow@labbrain.test" })
      ).rejects.toMatchObject({ code: "seat_limit" });
    } finally {
      await admin.from("tenants").delete().eq("id", tenantId);
    }
  });
});

// AC-1.5 — pure validation + error mapping (no network) → always runs.
describe("Story 1 — auth input validation (AC-1.5)", () => {
  it("@AC-1.5 login schema rejects bad email and empty password", () => {
    expect(loginSchema.safeParse({ email: "nope", password: "x" }).success).toBe(false);
    expect(loginSchema.safeParse({ email: "a@b.co", password: "" }).success).toBe(false);
    expect(loginSchema.safeParse({ email: "a@b.co", password: "ok" }).success).toBe(true);
  });

  it("@AC-1.5 forgot schema rejects malformed email", () => {
    expect(forgotSchema.safeParse({ email: "bad" }).success).toBe(false);
    expect(forgotSchema.safeParse({ email: "ok@lab.jo" }).success).toBe(true);
  });

  it("@AC-1.5 maps known Supabase errors to Arabic messages", () => {
    expect(mapAuthError("Invalid login credentials")).toContain("غير صحيحة");
    expect(mapAuthError("Email not confirmed")).toContain("تأكيد");
    expect(mapAuthError("something weird")).toBeTruthy();
  });

  // Regression: invite-mode signup carries no lab name (field hidden in UI), so
  // the schema must accept a missing labName when inviteToken is present, but
  // still require it for the new-lab path (AC-1.1 / AC-1.4).
  it("@AC-1.4 signup schema accepts an invite with no lab name", () => {
    expect(
      signupSchema.safeParse({
        adminName: "Invited Member",
        email: "invitee@lab.jo",
        password: "supersecret",
        inviteToken: "abc123"
      }).success
    ).toBe(true);
  });

  it("@AC-1.1 signup schema requires a lab name for a new lab (no invite)", () => {
    expect(
      signupSchema.safeParse({
        adminName: "Owner",
        email: "owner@lab.jo",
        password: "supersecret"
      }).success
    ).toBe(false);
    expect(
      signupSchema.safeParse({
        labName: "Jordan Calibration Lab",
        adminName: "Owner",
        email: "owner@lab.jo",
        password: "supersecret"
      }).success
    ).toBe(true);
  });
});

// AC-1.2 — the verification link's 24h expiry is Supabase Auth config; the app's
// job is to send confirmed users to onboarding. safeNext is pure → always runs.
describe("Story 1 — email confirmation redirect (AC-1.2)", () => {
  it("@AC-1.2 defaults to /onboarding when no next is given", () => {
    expect(safeNext(null)).toBe("/onboarding");
    expect(safeNext("")).toBe("/onboarding");
  });

  it("@AC-1.2 preserves a safe same-origin next path", () => {
    expect(safeNext("/dashboard")).toBe("/dashboard");
  });

  it("@AC-1.2 rejects open-redirect targets", () => {
    expect(safeNext("//evil.com")).toBe("/onboarding");
    expect(safeNext("https://evil.com")).toBe("/onboarding");
  });
});

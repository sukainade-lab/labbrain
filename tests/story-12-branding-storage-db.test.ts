import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { BRANDING_BUCKET, logoStoragePath } from "@/lib/branding/logo";

// S12 — live storage suite for the `branding` bucket (lesson L2: serialized,
// unique-tenant scoped, cleans up in afterAll; CI runs the live job with
// --no-file-parallelism). This is the AC-12.2 isolation contract: an authenticated
// user can write/read ONLY under their own {tenant_id}/ prefix. Lab A can never
// overwrite or read Lab B's logo object via the storage API.
//
// The bucket is PUBLIC-READ (AC-12.6) — anonymous download via the public URL is
// intentional and not what this tests. What's security-critical, and what the RLS
// policy (migration 0013) enforces, is the WRITE/object-table access: a signed-in
// user's insert/update/delete is rejected outside their own tenant prefix.

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const hasLiveSupabase = Boolean(url && anonKey && serviceKey);

const PASSWORD = "Test-Passw0rd!";
const uniq = (p: string) =>
  `${p}-${Date.now()}-${Math.random().toString(36).slice(2)}@labbrain.test`;
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); // PNG magic

describe.skipIf(!hasLiveSupabase).sequential("Story 12 — branding storage isolation (live DB)", () => {
  let admin: SupabaseClient;
  let labA: SupabaseClient; // signed-in user of tenant A
  const ids = { a: "", b: "", ua: "", ub: "" };
  const emails = { a: "", b: "" };

  beforeAll(async () => {
    admin = createClient(url!, serviceKey!, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    for (const k of ["a", "b"] as const) {
      const { data: t } = await admin
        .from("tenants")
        .insert({ name: `Branding Lab ${k} ${Date.now()}` })
        .select("id")
        .single();
      const email = uniq(`brand-${k}`);
      const { data: created } = await admin.auth.admin.createUser({
        email,
        password: PASSWORD,
        email_confirm: true
      });
      const uid = created!.user!.id;
      await admin.from("users").insert({ id: uid, tenant_id: t!.id, email, role: "owner" });
      ids[k] = t!.id;
      ids[k === "a" ? "ua" : "ub"] = uid;
      emails[k] = email;
    }

    labA = createClient(url!, anonKey!, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
    await labA.auth.signInWithPassword({ email: emails.a, password: PASSWORD });
  });

  afterAll(async () => {
    if (!admin) return;
    // Remove any objects either tenant may have written, then the seed rows.
    await admin.storage
      .from(BRANDING_BUCKET)
      .remove([logoStoragePath(ids.a, "png"), logoStoragePath(ids.b, "png")]);
    await admin.from("tenants").delete().in("id", [ids.a, ids.b]);
    for (const uid of [ids.ua, ids.ub]) {
      try {
        await admin.auth.admin.deleteUser(uid);
      } catch {
        /* best-effort */
      }
    }
  });

  it("@AC-12.2 a user can upload a logo under their OWN tenant prefix", async () => {
    const { error } = await labA.storage
      .from(BRANDING_BUCKET)
      .upload(logoStoragePath(ids.a, "png"), PNG, { contentType: "image/png", upsert: true });
    expect(error).toBeNull();
  });

  it("@AC-12.2 a user CANNOT upload under another tenant's prefix — RLS rejects it", async () => {
    const { error } = await labA.storage
      .from(BRANDING_BUCKET)
      .upload(logoStoragePath(ids.b, "png"), PNG, { contentType: "image/png", upsert: true });
    expect(error).not.toBeNull(); // row-level security violation

    // ...and nothing landed under tenant B's prefix.
    const { data: leaked } = await admin.storage.from(BRANDING_BUCKET).list(ids.b);
    expect(leaked ?? []).toHaveLength(0);
  });

  it("@AC-12.2 a user CANNOT list another tenant's objects via the storage API", async () => {
    // Seed an object under tenant B with the service role.
    await admin.storage
      .from(BRANDING_BUCKET)
      .upload(logoStoragePath(ids.b, "png"), PNG, { contentType: "image/png", upsert: true });

    const { data: rows } = await labA.storage.from(BRANDING_BUCKET).list(ids.b);
    expect(rows ?? []).toHaveLength(0); // RLS hides tenant B's objects from user A
  });

  it("@AC-12.2 a user CANNOT delete another tenant's logo object", async () => {
    const { error } = await labA.storage
      .from(BRANDING_BUCKET)
      .remove([logoStoragePath(ids.b, "png")]);
    // remove() of a non-permitted path is a no-op/denied — object must survive.
    const { data: stillThere } = await admin.storage.from(BRANDING_BUCKET).list(ids.b);
    expect(stillThere?.some((o) => o.name === "logo.png")).toBe(true);
    // (error may be null with an empty data array depending on storage version;
    //  the surviving object is the authoritative assertion.)
    void error;
  });
});

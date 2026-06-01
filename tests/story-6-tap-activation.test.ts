import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Story 6 — Tap activation through the SHARED reducer (AC-6.3). LIVE DB test: it
// drives applyOutcome (the same path the Tap webhook route uses) against the real
// local Supabase via the service-role admin client, and asserts the access gate
// (tenants.status) plus the provider='tap' subscription mirror row. Only the
// activation email seam is mocked. Lesson L2: each test scopes a unique tenant.

vi.mock("@/lib/email/resend", () => ({
  sendActivationEmail: vi.fn().mockResolvedValue(undefined)
}));

import { applyOutcome } from "@/lib/payment/activation-core";
import { sendActivationEmail } from "@/lib/email/resend";
import type { WebhookOutcome } from "@/lib/payment/types";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const hasLiveSupabase = Boolean(url && serviceKey);

const PASSWORD = "Test-Passw0rd!";

function tapActivate(opts: {
  tenantId: string;
  chargeId: string;
  plan?: string;
  interval?: string;
  currency?: string;
  customerId?: string | null;
}): WebhookOutcome {
  return {
    kind: "activate",
    tenantId: opts.tenantId,
    plan: opts.plan ?? null,
    record: {
      tenantId: opts.tenantId,
      provider: "tap",
      providerCustomerId: opts.customerId ?? null,
      providerSubscriptionId: opts.chargeId,
      currency: opts.currency ?? "JOD",
      plan: opts.plan ?? null,
      interval: opts.interval ?? null,
      status: "active"
    }
  };
}

describe.skipIf(!hasLiveSupabase)("Story 6 — Tap activation (live)", () => {
  let admin: SupabaseClient;
  const tenantIds: string[] = [];

  async function seedTenant(): Promise<{ tenantId: string; email: string }> {
    const { data: tenant, error: tErr } = await admin
      .from("tenants")
      .insert({ name: `Tap-Lab-${Date.now()}-${Math.random().toString(36).slice(2)}` })
      .select()
      .single();
    if (tErr) throw tErr;
    const tenantId = tenant.id as string;
    tenantIds.push(tenantId);

    const email = `tap-owner-${Date.now()}-${Math.random().toString(36).slice(2)}@labbrain.test`;
    const { data: created, error: uErr } = await admin.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true
    });
    if (uErr) throw uErr;
    const { error: linkErr } = await admin
      .from("users")
      .insert({ id: created.user.id, tenant_id: tenantId, email, role: "owner" });
    if (linkErr) throw linkErr;

    return { tenantId, email };
  }

  beforeAll(() => {
    admin = createClient(url!, serviceKey!, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
  });

  afterAll(async () => {
    for (const id of tenantIds) {
      await admin.from("tenants").delete().eq("id", id);
    }
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("@AC-6.3 a captured Tap charge → tenant active, provider='tap' row, owner emailed", async () => {
    const { tenantId } = await seedTenant();
    const chargeId = `chg_${Math.random().toString(36).slice(2)}`;

    await applyOutcome(
      admin,
      tapActivate({ tenantId, chargeId, plan: "pro", interval: "year", customerId: "cus_tap1" })
    );

    const { data: tenant } = await admin
      .from("tenants")
      .select("status, plan")
      .eq("id", tenantId)
      .single();
    expect(tenant).toMatchObject({ status: "active", plan: "pro" });

    const { data: sub } = await admin
      .from("subscriptions")
      .select("tenant_id, provider, provider_subscription_id, provider_customer_id, currency, plan, price_interval, status")
      .eq("provider", "tap")
      .eq("provider_subscription_id", chargeId)
      .single();
    expect(sub).toMatchObject({
      tenant_id: tenantId,
      provider: "tap",
      provider_subscription_id: chargeId,
      provider_customer_id: "cus_tap1",
      currency: "JOD",
      plan: "pro",
      price_interval: "year",
      status: "active"
    });
    // Tap rows must NOT pollute the legacy stripe_* columns (dual-write is
    // stripe-only) — keeps the two rails cleanly separable.
    const { data: stripeCols } = await admin
      .from("subscriptions")
      .select("stripe_subscription_id, stripe_customer_id")
      .eq("provider", "tap")
      .eq("provider_subscription_id", chargeId)
      .single();
    expect(stripeCols).toMatchObject({ stripe_subscription_id: null, stripe_customer_id: null });

    expect(sendActivationEmail).toHaveBeenCalledTimes(1);
  });

  it("@AC-6.3 replaying the same captured charge is idempotent → exactly one row", async () => {
    const { tenantId } = await seedTenant();
    const chargeId = `chg_${Math.random().toString(36).slice(2)}`;
    const outcome = tapActivate({ tenantId, chargeId, plan: "starter", interval: "month" });

    await applyOutcome(admin, outcome);
    await applyOutcome(admin, outcome);

    const { data: rows } = await admin
      .from("subscriptions")
      .select("id")
      .eq("provider", "tap")
      .eq("provider_subscription_id", chargeId);
    expect(rows).toHaveLength(1);
  });

  it("@AC-6.4 a Tap charge id never collides with the same id on the Stripe rail", async () => {
    // (provider, provider_subscription_id) is the uniqueness key from migration 0008
    // — the same raw id under two providers is two distinct rows, never a conflicting
    // upsert. This is the provider-neutral schema contract (AC-6.4) the shared
    // upsert_provider_subscription RPC relies on.
    const { tenantId } = await seedTenant();
    const sharedId = `id_${Math.random().toString(36).slice(2)}`;

    await applyOutcome(admin, tapActivate({ tenantId, chargeId: sharedId, plan: "pro", interval: "month" }));
    await applyOutcome(admin, {
      kind: "activate",
      tenantId,
      plan: "pro",
      record: {
        tenantId,
        provider: "stripe",
        providerCustomerId: "cus_s",
        providerSubscriptionId: sharedId,
        currency: "JOD",
        plan: "pro",
        interval: "month",
        status: "active"
      }
    });

    const { data: rows } = await admin
      .from("subscriptions")
      .select("provider")
      .eq("provider_subscription_id", sharedId);
    expect(rows).toHaveLength(2);
    expect(new Set((rows ?? []).map((r) => r.provider))).toEqual(new Set(["tap", "stripe"]));
  });
});

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";

// Story 4 — Stripe webhook activation (AC-4.3). This is the LIVE DB test: it
// drives handleStripeEvent against the real local Supabase via the service-role
// admin client (the same path the route uses), and asserts the access gate
// (tenants.status) plus the subscription mirror row. Only the activation email
// seam is mocked — DB writes and idempotency are the contract under test.
//   - Route seam (signature gate + dispatch, L1) → tests/story-4-webhook-routes.test.ts

vi.mock("@/lib/email/resend", () => ({
  sendActivationEmail: vi.fn().mockResolvedValue(undefined)
}));

import { handleStripeEvent } from "@/lib/payment/stripe/activation";
import { sendActivationEmail } from "@/lib/email/resend";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const hasLiveSupabase = Boolean(url && serviceKey);

const PASSWORD = "Test-Passw0rd!";

// Minimal Stripe event factories — only the fields the handlers read. Casting
// through unknown keeps us honest about which fields actually matter.
function checkoutCompleted(opts: {
  tenantId: string;
  plan?: string;
  interval?: string;
  customerId?: string;
  subscriptionId?: string;
}): Stripe.Event {
  return {
    type: "checkout.session.completed",
    data: {
      object: {
        client_reference_id: opts.tenantId,
        metadata: { tenant_id: opts.tenantId, plan: opts.plan, interval: opts.interval },
        customer: opts.customerId ?? null,
        subscription: opts.subscriptionId ?? null
      }
    }
  } as unknown as Stripe.Event;
}

function subscriptionDeleted(subscriptionId: string): Stripe.Event {
  return {
    type: "customer.subscription.deleted",
    data: { object: { id: subscriptionId } }
  } as unknown as Stripe.Event;
}

function paymentFailed(subscriptionId: string): Stripe.Event {
  return {
    type: "invoice.payment_failed",
    data: { object: { subscription: subscriptionId } }
  } as unknown as Stripe.Event;
}

describe.skipIf(!hasLiveSupabase)("Story 4 — Stripe webhook activation (live)", () => {
  let admin: SupabaseClient;
  const tenantIds: string[] = [];

  // Each test seeds its own tenant + owner (Lesson L2: live suites share one DB,
  // so scope every fixture to a unique tenant and never rely on global state).
  async function seedTenant(): Promise<{ tenantId: string; email: string }> {
    const { data: tenant, error: tErr } = await admin
      .from("tenants")
      .insert({ name: `Webhook-Lab-${Date.now()}-${Math.random().toString(36).slice(2)}` })
      .select()
      .single();
    if (tErr) throw tErr;
    const tenantId = tenant.id as string;
    tenantIds.push(tenantId);

    const email = `wh-owner-${Date.now()}-${Math.random().toString(36).slice(2)}@labbrain.test`;
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

  it("@AC-4.3 checkout.session.completed → tenant active, subscription mirrored, owner emailed", async () => {
    const { tenantId } = await seedTenant();
    const subId = `sub_${Math.random().toString(36).slice(2)}`;

    await handleStripeEvent(
      admin,
      checkoutCompleted({
        tenantId,
        plan: "pro",
        interval: "year",
        customerId: "cus_test123",
        subscriptionId: subId
      })
    );

    // Access gate flipped + plan recorded.
    const { data: tenant } = await admin
      .from("tenants")
      .select("status, plan")
      .eq("id", tenantId)
      .single();
    expect(tenant).toMatchObject({ status: "active", plan: "pro" });

    // Subscription mirror row written with the Stripe lifecycle fields.
    const { data: sub } = await admin
      .from("subscriptions")
      .select("tenant_id, stripe_customer_id, stripe_subscription_id, plan, price_interval, status")
      .eq("stripe_subscription_id", subId)
      .single();
    expect(sub).toMatchObject({
      tenant_id: tenantId,
      stripe_customer_id: "cus_test123",
      stripe_subscription_id: subId,
      plan: "pro",
      price_interval: "year",
      status: "active"
    });

    expect(sendActivationEmail).toHaveBeenCalledTimes(1);
  });

  it("@AC-4.3 the same checkout event twice is idempotent → exactly one subscription row", async () => {
    const { tenantId } = await seedTenant();
    const subId = `sub_${Math.random().toString(36).slice(2)}`;
    const event = checkoutCompleted({
      tenantId,
      plan: "starter",
      interval: "month",
      customerId: "cus_dup",
      subscriptionId: subId
    });

    // Stripe retries deliveries; replaying the same event must never duplicate.
    await handleStripeEvent(admin, event);
    await handleStripeEvent(admin, event);

    const { data: rows } = await admin
      .from("subscriptions")
      .select("id")
      .eq("stripe_subscription_id", subId);
    expect(rows).toHaveLength(1);
  });

  it("@AC-4.3 customer.subscription.deleted → tenant inactive, subscription canceled", async () => {
    const { tenantId } = await seedTenant();
    const subId = `sub_${Math.random().toString(36).slice(2)}`;
    await handleStripeEvent(
      admin,
      checkoutCompleted({ tenantId, plan: "pro", interval: "month", subscriptionId: subId })
    );

    await handleStripeEvent(admin, subscriptionDeleted(subId));

    const { data: tenant } = await admin
      .from("tenants")
      .select("status")
      .eq("id", tenantId)
      .single();
    expect(tenant!.status).toBe("inactive");

    const { data: sub } = await admin
      .from("subscriptions")
      .select("status")
      .eq("stripe_subscription_id", subId)
      .single();
    expect(sub!.status).toBe("canceled");
  });

  it("@AC-4.3 invoice.payment_failed → tenant past_due, subscription past_due", async () => {
    const { tenantId } = await seedTenant();
    const subId = `sub_${Math.random().toString(36).slice(2)}`;
    await handleStripeEvent(
      admin,
      checkoutCompleted({ tenantId, plan: "pro", interval: "month", subscriptionId: subId })
    );

    await handleStripeEvent(admin, paymentFailed(subId));

    const { data: tenant } = await admin
      .from("tenants")
      .select("status")
      .eq("id", tenantId)
      .single();
    expect(tenant!.status).toBe("past_due");

    const { data: sub } = await admin
      .from("subscriptions")
      .select("status")
      .eq("stripe_subscription_id", subId)
      .single();
    expect(sub!.status).toBe("past_due");
  });

  it("@AC-4.3 an unknown subscription id is a no-op, never throws", async () => {
    // A lifecycle event for a subscription we never recorded (e.g. created out of
    // band) must be acknowledged without error and without touching any tenant.
    await expect(
      handleStripeEvent(admin, subscriptionDeleted("sub_does_not_exist"))
    ).resolves.toBeUndefined();
    await expect(
      handleStripeEvent(admin, paymentFailed("sub_also_missing"))
    ).resolves.toBeUndefined();
  });

  it("@AC-4.3 checkout without a tenant id throws (so Stripe retries, never silently drops)", async () => {
    const bad = {
      type: "checkout.session.completed",
      data: { object: { client_reference_id: null, metadata: {}, customer: null, subscription: null } }
    } as unknown as Stripe.Event;
    await expect(handleStripeEvent(admin, bad)).rejects.toThrow(/tenant id/i);
  });
});

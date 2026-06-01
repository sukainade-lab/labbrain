import type Stripe from "stripe";
import type { createAdminClient } from "@/lib/supabase/admin";
import { sendActivationEmail } from "@/lib/email/resend";

type Admin = ReturnType<typeof createAdminClient>;

// Stripe's generated Invoice type doesn't always surface `subscription` on the
// version we pin, though the API sends it. Narrow it once here instead of an
// inline cast at the call site.
type InvoiceWithSubscription = Stripe.Invoice & {
  subscription?: string | { id: string } | null;
};

// AC-4.3 — apply a verified Stripe event to our DB.
//   • tenants.status       — the ACCESS GATE (active / inactive / past_due)
//   • subscriptions.status — a MIRROR of the Stripe lifecycle (audit trail)
// All writes go through the service-role admin client (bypasses RLS). Handlers
// are idempotent: Stripe retries deliveries, so the same event must never create
// a duplicate subscription row or double-activate.
export async function handleStripeEvent(admin: Admin, event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed":
      await onCheckoutCompleted(admin, event.data.object as Stripe.Checkout.Session);
      break;
    case "customer.subscription.deleted":
      await onSubscriptionDeleted(admin, event.data.object as Stripe.Subscription);
      break;
    case "invoice.payment_failed":
      await onPaymentFailed(admin, event.data.object as Stripe.Invoice);
      break;
    default:
      // Unhandled event types are acknowledged (200) but do nothing.
      break;
  }
}

function idOf(ref: string | { id: string } | null | undefined): string | null {
  if (!ref) return null;
  return typeof ref === "string" ? ref : ref.id;
}

async function onCheckoutCompleted(admin: Admin, session: Stripe.Checkout.Session) {
  const tenantId = session.client_reference_id ?? session.metadata?.tenant_id ?? null;
  if (!tenantId) throw new Error("checkout.session.completed without a tenant id");

  const plan = session.metadata?.plan ?? null;
  const interval = session.metadata?.interval ?? null;
  const stripeCustomerId = idOf(session.customer);
  const stripeSubscriptionId = idOf(session.subscription);

  // 1) Activate the tenant (access gate) + record the chosen plan.
  await update(admin, "tenants", { plan: plan ?? undefined, status: "active" }, "id", tenantId);

  // 2) Idempotent upsert of the subscription row keyed by stripe_subscription_id.
  //    Atomic via the upsert_subscription RPC (migration 0006): it runs INSERT …
  //    ON CONFLICT against the PARTIAL unique index, which PostgREST's on-conflict
  //    can't target — so concurrent Stripe retries can't race a duplicate row.
  if (stripeSubscriptionId) {
    await upsertSubscription(admin, {
      tenant_id: tenantId,
      stripe_customer_id: stripeCustomerId,
      stripe_subscription_id: stripeSubscriptionId,
      plan,
      price_interval: interval,
      status: "active"
    });
  }

  // 3) Activation email to the lab owner (best-effort within the handler).
  const { data: tenant } = await admin
    .from("tenants")
    .select("name")
    .eq("id", tenantId)
    .single();
  const { data: owner } = await admin
    .from("users")
    .select("email")
    .eq("tenant_id", tenantId)
    .eq("role", "owner")
    .limit(1)
    .maybeSingle();
  if (owner?.email) {
    await sendActivationEmail(owner.email, tenant?.name ?? "");
  }
}

async function onSubscriptionDeleted(admin: Admin, sub: Stripe.Subscription) {
  const subId = sub.id;
  const tenantId = await tenantForSubscription(admin, subId);
  if (!tenantId) return; // unknown subscription — nothing to deactivate
  await update(admin, "subscriptions", { status: "canceled" }, "stripe_subscription_id", subId);
  await update(admin, "tenants", { status: "inactive" }, "id", tenantId);
}

async function onPaymentFailed(admin: Admin, invoice: Stripe.Invoice) {
  const subId = idOf((invoice as InvoiceWithSubscription).subscription);
  if (!subId) return;
  const tenantId = await tenantForSubscription(admin, subId);
  if (!tenantId) return;
  await update(admin, "subscriptions", { status: "past_due" }, "stripe_subscription_id", subId);
  await update(admin, "tenants", { status: "past_due" }, "id", tenantId);
}

// ── helpers ──────────────────────────────────────────────────────────────────

async function tenantForSubscription(admin: Admin, subId: string): Promise<string | null> {
  const { data } = await admin
    .from("subscriptions")
    .select("tenant_id")
    .eq("stripe_subscription_id", subId)
    .maybeSingle();
  return data?.tenant_id ?? null;
}

async function upsertSubscription(
  admin: Admin,
  row: {
    tenant_id: string;
    stripe_customer_id: string | null;
    stripe_subscription_id: string;
    plan: string | null;
    price_interval: string | null;
    status: string;
  }
) {
  // Atomic INSERT … ON CONFLICT on the partial unique index (migration 0006).
  const { error } = await admin.rpc("upsert_subscription", {
    p_tenant_id: row.tenant_id,
    p_stripe_customer_id: row.stripe_customer_id,
    p_stripe_subscription_id: row.stripe_subscription_id,
    p_plan: row.plan,
    p_price_interval: row.price_interval,
    p_status: row.status
  });
  if (error) throw error;
}

async function update(
  admin: Admin,
  table: string,
  patch: Record<string, unknown>,
  col: string,
  val: string
) {
  const { error } = await admin.from(table).update(patch).eq(col, val);
  if (error) throw error;
}

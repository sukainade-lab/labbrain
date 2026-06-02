import type { createAdminClient } from "@/lib/supabase/admin";
import { sendActivationEmail } from "@/lib/email/resend";
import type { SubscriptionRecord, WebhookOutcome } from "./types";

type Admin = ReturnType<typeof createAdminClient>;

// AC-6.1 — the provider-neutral activation reducer. BOTH rails (Stripe, Tap) turn
// their own verified webhook payloads into a `WebhookOutcome`, and `applyOutcome`
// maps that outcome to the SAME set of DB effects:
//   • tenants.status       — the ACCESS GATE (active / inactive / past_due)
//   • subscriptions.status — a MIRROR of the provider lifecycle (audit trail)
// All writes go through the service-role admin client (bypasses RLS). Effects are
// idempotent: providers retry deliveries, so the same outcome must never create a
// duplicate subscription row or double-activate.
export async function applyOutcome(admin: Admin, outcome: WebhookOutcome): Promise<void> {
  switch (outcome.kind) {
    case "ignore":
      return;
    case "activate": {
      // 1) Activate the tenant (access gate) + record the chosen plan. Returns
      //    whether THIS call actually flipped the tenant into 'active' (vs it
      //    already being active) so we don't re-notify on webhook redelivery.
      const transitioned = await activateTenant(admin, outcome.tenantId, outcome.plan);
      // 2) Idempotent upsert of the subscription row (only when the provider gave
      //    us a subscription id to key on — a bare activation still flips access).
      if (outcome.record) await recordSubscription(admin, outcome.record);
      // 3) Activation email to the lab owner — ONLY on a real activation. Providers
      //    retry deliveries (and the route 500s→retries on any later error), so
      //    sending unconditionally would spam the owner with duplicate "you're
      //    active" emails on every redelivery. Gating on the state transition keeps
      //    the whole outcome idempotent end-to-end (best-effort within the handler).
      if (transitioned) await sendActivation(admin, outcome.tenantId);
      return;
    }
    case "deactivate":
      await deactivate(admin, outcome.provider, outcome.providerSubscriptionId);
      return;
    case "past_due":
      await markPastDue(admin, outcome.provider, outcome.providerSubscriptionId);
      return;
  }
}

// Flip the tenant to 'active' and return TRUE iff this call performed the
// transition (i.e. the tenant was not already active). The conditional update
// (`status != 'active'`) is the dedup primitive: on webhook redelivery the row is
// already active, so zero rows match and we report no transition — and because the
// flip is a single atomic UPDATE, concurrent redeliveries can't both "win".
async function activateTenant(admin: Admin, tenantId: string, plan: string | null): Promise<boolean> {
  const { data, error } = await admin
    .from("tenants")
    .update({ plan: plan ?? undefined, status: "active" })
    .eq("id", tenantId)
    .neq("status", "active")
    .select("id");
  if (error) throw error;
  const transitioned = (data?.length ?? 0) > 0;
  // Already active: still keep the plan current (idempotent), but no transition.
  if (!transitioned && plan) await update(admin, "tenants", { plan }, "id", tenantId);
  return transitioned;
}

async function recordSubscription(admin: Admin, r: SubscriptionRecord) {
  // Atomic INSERT … ON CONFLICT (provider, provider_subscription_id) via the
  // provider-aware RPC (migration 0008). For provider='stripe' the RPC also keeps
  // the legacy stripe_* columns populated so existing readers still resolve.
  const { error } = await admin.rpc("upsert_provider_subscription", {
    p_tenant_id: r.tenantId,
    p_provider: r.provider,
    p_provider_customer_id: r.providerCustomerId,
    p_provider_subscription_id: r.providerSubscriptionId,
    p_currency: r.currency,
    p_plan: r.plan,
    p_price_interval: r.interval,
    p_status: r.status
  });
  if (error) throw error;
}

async function deactivate(admin: Admin, provider: string, providerSubscriptionId: string) {
  const tenantId = await tenantForProviderSub(admin, provider, providerSubscriptionId);
  if (!tenantId) return; // unknown subscription — nothing to deactivate
  await updateProviderSub(admin, provider, providerSubscriptionId, { status: "canceled" });
  await update(admin, "tenants", { status: "inactive" }, "id", tenantId);
}

async function markPastDue(admin: Admin, provider: string, providerSubscriptionId: string) {
  const tenantId = await tenantForProviderSub(admin, provider, providerSubscriptionId);
  if (!tenantId) return;
  await updateProviderSub(admin, provider, providerSubscriptionId, { status: "past_due" });
  await update(admin, "tenants", { status: "past_due" }, "id", tenantId);
}

async function sendActivation(admin: Admin, tenantId: string) {
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

// ── helpers ──────────────────────────────────────────────────────────────────

async function tenantForProviderSub(
  admin: Admin,
  provider: string,
  providerSubscriptionId: string
): Promise<string | null> {
  const { data } = await admin
    .from("subscriptions")
    .select("tenant_id")
    .eq("provider", provider)
    .eq("provider_subscription_id", providerSubscriptionId)
    .maybeSingle();
  return data?.tenant_id ?? null;
}

async function updateProviderSub(
  admin: Admin,
  provider: string,
  providerSubscriptionId: string,
  patch: Record<string, unknown>
) {
  const { error } = await admin
    .from("subscriptions")
    .update(patch)
    .eq("provider", provider)
    .eq("provider_subscription_id", providerSubscriptionId);
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

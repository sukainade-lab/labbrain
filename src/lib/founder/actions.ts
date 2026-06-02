import type { createAdminClient } from "@/lib/supabase/admin";
import { applyOutcome } from "@/lib/payment/activation-core";
import type { Interval, PlanId } from "@/lib/pricing/plans";

type Admin = ReturnType<typeof createAdminClient>;

// S8 — the three founder mutations. All run through the service-role admin client
// (bypasses RLS) and MUST be called only behind the PLATFORM_ADMIN_EMAILS gate.

// AC-8.4 — pause: a founder-initiated access freeze. The proxy blocks the (app)
// group for any non-'active' status, so the lab's users are locked out until the
// founder unpauses. Distinct from 'inactive' (never activated) and 'past_due'
// (provider lifecycle).
export async function pauseTenant(admin: Admin, tenantId: string): Promise<void> {
  await setStatus(admin, tenantId, "paused");
}

// AC-8.4 — unpause: restore access for a paused (or past_due) lab.
export async function unpauseTenant(admin: Admin, tenantId: string): Promise<void> {
  await setStatus(admin, tenantId, "active");
}

// AC-8.5 — mark invoice paid: the BRD's primary buying path is bank transfer +
// official JOD invoice, which has NO provider webhook. The founder records the
// payment manually here. Rather than re-implement activation, we build the SAME
// provider-neutral 'activate' outcome a webhook would and run it through
// activation-core.applyOutcome — identical DB effects: flip tenants.status to
// active, upsert a subscription (provider 'manual'), send the activation email.
// The subscription is keyed on a stable id (`manual:<tenantId>`) so re-marking a
// lab paid updates the one row instead of duplicating it (idempotent).
export async function activateInvoice(
  admin: Admin,
  tenantId: string,
  opts: { interval?: Interval } = {}
): Promise<void> {
  const { data: tenant, error } = await admin
    .from("tenants")
    .select("plan")
    .eq("id", tenantId)
    .single();
  if (error) throw error;

  const plan = (tenant?.plan ?? "starter") as PlanId;
  await applyOutcome(admin, {
    kind: "activate",
    tenantId,
    plan,
    record: {
      tenantId,
      provider: "manual",
      providerCustomerId: null,
      providerSubscriptionId: `manual:${tenantId}`,
      currency: "JOD",
      plan,
      interval: opts.interval ?? "month",
      status: "active"
    }
  });
}

async function setStatus(admin: Admin, tenantId: string, status: string): Promise<void> {
  const { error } = await admin.from("tenants").update({ status }).eq("id", tenantId);
  if (error) throw error;
}

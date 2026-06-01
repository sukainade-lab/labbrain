-- S4 — Pricing, Stripe Checkout & Account Activation.
-- Record WHAT the tenant bought so the dashboard and admin can show it. The
-- Stripe webhook (service role) writes these; the tenant reads its own row via
-- the `subscriptions_select_own` RLS policy already created in 0002.

-- ── Record plan + billing interval on the subscription ───────────────────────
-- 0001 created `subscriptions` with stripe ids + status but no record of which
-- plan/interval the customer chose. The webhook resolves these from the Stripe
-- line item and writes them on `checkout.session.completed`. Nullable: a row may
-- exist in `incomplete` state before the first paid event lands. No prod data.
alter table subscriptions
  add column plan text check (plan in ('starter', 'pro'));

alter table subscriptions
  add column price_interval text check (price_interval in ('month', 'year'));

-- Note on access control (no schema change, documented here):
--   • tenants.status        — the ACCESS GATE. 'active' lets the lab use the app.
--   • subscriptions.status  — a MIRROR of the Stripe subscription lifecycle.
-- The webhook flips tenants.status; subscriptions.status is the audit trail.
-- Tenant self-read is already granted by `subscriptions_select_own` (0002);
-- all writes are server-side via the service role, which bypasses RLS.

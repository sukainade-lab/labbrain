-- S6 — Tap Payments card integration (JOD + KWD + SAR).
--
-- Makes the `subscriptions` table provider-neutral so the same row shape records
-- a charge from EITHER rail (Stripe or Tap), and replaces the Stripe-only upsert
-- (0006) with a provider-aware one. The access-control model is unchanged:
--   • tenants.status        — the ACCESS GATE (active / inactive / past_due)
--   • subscriptions.status  — a MIRROR of the provider's lifecycle (audit trail)
-- All writes remain server-side via the service role; RLS is untouched (tenants
-- still self-read their own subscription via `subscriptions_select_own` from 0002).

-- ── 1. Provider-neutral columns ──────────────────────────────────────────────
-- `provider` defaults to 'stripe' so existing rows (all Stripe) classify correctly.
-- `currency` defaults to 'JOD' (the beachhead currency); Stripe rows keep JOD.
alter table subscriptions
  add column provider text not null default 'stripe'
    check (provider in ('stripe', 'tap'));

alter table subscriptions add column provider_customer_id text;
alter table subscriptions add column provider_subscription_id text;
alter table subscriptions add column currency text not null default 'JOD';

-- ── 2. Backfill existing Stripe rows into the neutral columns ─────────────────
-- The provider columns are the new source of truth; mirror the legacy stripe_*
-- values across so lookups by (provider, provider_subscription_id) resolve.
update subscriptions
  set provider_customer_id     = stripe_customer_id,
      provider_subscription_id = stripe_subscription_id
  where provider_subscription_id is null;

-- ── 3. Re-key uniqueness on (provider, provider_subscription_id) ──────────────
-- The legacy single-column partial unique index (0001) is subsumed by the new
-- provider-scoped one. Drop it so an INSERT … ON CONFLICT can name a single,
-- unambiguous arbiter index (a second unique index on stripe_subscription_id
-- would otherwise raise a non-arbiter unique_violation on a Stripe retry).
drop index if exists subscriptions_stripe_sub_idx;

create unique index subscriptions_provider_sub_idx
  on subscriptions (provider, provider_subscription_id)
  where provider_subscription_id is not null;

-- ── 4. Provider-aware atomic upsert (replaces 0006's Stripe-only upsert) ──────
-- Idempotent on (provider, provider_subscription_id): a provider may redeliver
-- the same charge/event, so a replay must update — never duplicate — the row.
-- For the 'stripe' provider we also keep the legacy stripe_* columns populated so
-- existing readers continue to resolve (back-compat; a later migration can drop
-- those columns once nothing reads them).
create or replace function public.upsert_provider_subscription(
  p_tenant_id                uuid,
  p_provider                 text,
  p_provider_customer_id     text,
  p_provider_subscription_id text,
  p_currency                 text,
  p_plan                     text,
  p_price_interval           text,
  p_status                   text
) returns void
language sql
security definer
set search_path = public
as $$
  insert into subscriptions (
    tenant_id, provider, provider_customer_id, provider_subscription_id,
    currency, plan, price_interval, status,
    stripe_customer_id, stripe_subscription_id
  )
  values (
    p_tenant_id, p_provider, p_provider_customer_id, p_provider_subscription_id,
    coalesce(p_currency, 'JOD'), p_plan, p_price_interval, p_status,
    case when p_provider = 'stripe' then p_provider_customer_id end,
    case when p_provider = 'stripe' then p_provider_subscription_id end
  )
  on conflict (provider, provider_subscription_id) where provider_subscription_id is not null
  do update set
    tenant_id              = excluded.tenant_id,
    provider_customer_id   = excluded.provider_customer_id,
    currency               = excluded.currency,
    plan                   = excluded.plan,
    price_interval         = excluded.price_interval,
    status                 = excluded.status,
    stripe_customer_id     = excluded.stripe_customer_id,
    stripe_subscription_id = excluded.stripe_subscription_id;
$$;

-- Only the service role (the webhooks) calls this. Grant explicitly rather than
-- relying on the PUBLIC execute default (lesson from migration 0004).
revoke all on function public.upsert_provider_subscription(uuid, text, text, text, text, text, text, text) from public;
grant execute on function public.upsert_provider_subscription(uuid, text, text, text, text, text, text, text) to service_role;

-- ── 5. Retire the Stripe-only upsert from 0006 ───────────────────────────────
-- Its ON CONFLICT inferred the now-dropped stripe_subscription_id index, and all
-- call sites move to upsert_provider_subscription. Drop it to avoid a dormant
-- function referencing a missing index.
drop function if exists public.upsert_subscription(uuid, text, text, text, text, text);

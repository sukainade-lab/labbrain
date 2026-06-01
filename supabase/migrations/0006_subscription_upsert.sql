-- S4 bridge — atomic subscription upsert (replaces find-then-write in activation.ts).
--
-- The Stripe webhook may be delivered more than once (Stripe retries), and two
-- retries of the SAME event can race. The previous find-then-write (SELECT then
-- INSERT/UPDATE) left a window where two concurrent inserts could interleave; it
-- only held together because the partial unique index below would reject the
-- second insert (correct-by-accident, not by design). PostgREST's on-conflict
-- can't target a PARTIAL unique index, so we do the upsert in SQL where we can
-- name the index predicate explicitly — making it atomic.
--
-- Index (from 0001): subscriptions_stripe_sub_idx
--   unique (stripe_subscription_id) where stripe_subscription_id is not null

create or replace function public.upsert_subscription(
  p_tenant_id              uuid,
  p_stripe_customer_id     text,
  p_stripe_subscription_id text,
  p_plan                   text,
  p_price_interval         text,
  p_status                 text
) returns void
language sql
security definer
set search_path = public
as $$
  insert into subscriptions (
    tenant_id, stripe_customer_id, stripe_subscription_id, plan, price_interval, status
  )
  values (
    p_tenant_id, p_stripe_customer_id, p_stripe_subscription_id, p_plan, p_price_interval, p_status
  )
  on conflict (stripe_subscription_id) where stripe_subscription_id is not null
  do update set
    tenant_id          = excluded.tenant_id,
    stripe_customer_id = excluded.stripe_customer_id,
    plan               = excluded.plan,
    price_interval     = excluded.price_interval,
    status             = excluded.status;
$$;

-- Only the service role (the webhook) calls this. Grant explicitly rather than
-- relying on the PUBLIC execute default (lesson from S3 migration 0004).
revoke all on function public.upsert_subscription(uuid, text, text, text, text, text) from public;
grant execute on function public.upsert_subscription(uuid, text, text, text, text, text) to service_role;

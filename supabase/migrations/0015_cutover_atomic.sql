-- S10 hardening — make the residency cutover ATOMIC.
--
-- cutoverMigration (src/lib/migration/run.ts) previously did two separate writes:
--   1) flip tenants.data_region → target region
--   2) update the tenant_migrations run-log row → status='cutover'
-- The Supabase JS client can't span both in one transaction, so a crash (or an
-- error on the second write) between them left the tenant physically pointed at the
-- new region while the run-log still said 'verified'. That mismatch is dangerous:
-- the cutover guard keys on status, so a retried cutover would pass the guard and
-- re-run, and runMigration (also gated only on status='cutover') could re-import
-- into a region that is already live. The run-log would never reach the terminal
-- 'cutover' PDPL-evidence state either.
--
-- Fix: both writes inside one plpgsql function body = one transaction. Either the
-- region flip and the 'cutover' status land together, or neither does. Mirrors the
-- replace_document_chunks atomic-swap precedent (migration 0014).
create or replace function public.cutover_tenant_migration(
  p_migration_id uuid,
  p_tenant_id    uuid,
  p_region       text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
begin
  -- Guard: the run-log row must exist and belong to the named tenant. Without this
  -- an attacker with execute rights could flip an unrelated tenant's residency.
  select tenant_id into v_owner from tenant_migrations where id = p_migration_id;
  if v_owner is null then
    raise exception 'migration % not found', p_migration_id;
  end if;
  if v_owner <> p_tenant_id then
    raise exception 'tenant mismatch for migration %', p_migration_id;
  end if;

  -- Atomic: residency pointer + run-log terminal state share this transaction, so
  -- the two can never disagree (no "region flipped but status still verified" gap).
  update tenants set data_region = p_region where id = p_tenant_id;
  update tenant_migrations
     set status = 'cutover', finished_at = now()
   where id = p_migration_id;
end;
$$;

-- Only the service role (the founder-gated migration pipeline) calls this. Grant
-- explicitly rather than relying on the PUBLIC execute default (lesson, 0004/0014).
revoke all on function public.cutover_tenant_migration(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.cutover_tenant_migration(uuid, uuid, text) to service_role;

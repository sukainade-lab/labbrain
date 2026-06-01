-- AC-5.7 — RLS compliance introspection helper.
-- Tenant isolation is a P0 compliance guarantee (Lab A must never see Lab B's
-- data). This SECURITY DEFINER function reports, per public table, whether RLS
-- is enabled and how many named policies guard it — the seed/test script asserts
-- every multi-tenant table is locked down. It returns metadata only (table
-- names + counts), never row data, and is callable by the service role only.

create or replace function public.rls_policy_report()
returns table(table_name text, rls_enabled boolean, policy_count bigint)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select c.relname::text as table_name,
         c.relrowsecurity as rls_enabled,
         count(p.polname) as policy_count
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  left join pg_policy p on p.polrelid = c.oid
  where n.nspname = 'public'
    and c.relkind = 'r'
  group by c.relname, c.relrowsecurity;
$$;

-- Metadata-only, but keep it off the public PostgREST surface anyway: the
-- compliance test calls it with the service role.
revoke all on function public.rls_policy_report() from public, anon, authenticated;
grant execute on function public.rls_policy_report() to service_role;

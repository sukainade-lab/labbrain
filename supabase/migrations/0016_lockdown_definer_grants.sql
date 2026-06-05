-- Hardening — revoke anon/authenticated EXECUTE on two service-role-only RPCs.
--
-- Supabase grants EXECUTE on public functions to `anon` + `authenticated` by
-- DEFAULT (default privileges). A bare `revoke all ... from public` does NOT
-- remove those role-specific grants, so two functions that were meant to be
-- service-role-only stayed callable by any signed-in user (and `anon`):
--
--   • upsert_provider_subscription (0008) — SECURITY DEFINER, bypasses RLS. A
--     signed-in user could POST /rest/v1/rpc/upsert_provider_subscription with
--     their own tenant_id and status='active' to activate a paid plan for free.
--     This is a billing-gate bypass (P1).
--   • replace_document_chunks (0014) — SECURITY DEFINER; deletes+reinserts a
--     document's chunks. Guarded by a tenant-match check, but still must never
--     be on the public PostgREST surface.
--
-- 0010/0012/0015 already got this right by revoking from `public, anon,
-- authenticated` explicitly. This migration retrofits the same to 0008 and 0014.
-- (current_tenant_id and match_document_chunks stay callable by authenticated on
-- purpose: RLS policies call the former, and the latter is internally
-- tenant-filtered — both are intentional and not touched here.)

revoke execute on function public.upsert_provider_subscription(
  uuid, text, text, text, text, text, text, text
) from anon, authenticated;

revoke execute on function public.replace_document_chunks(
  uuid, uuid, jsonb
) from anon, authenticated;

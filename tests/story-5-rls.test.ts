import { describe, it, expect, beforeAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Story 5 — AC-5.7. Runs against a live Supabase (local CLI). Tenant isolation is
// a P0 compliance guarantee, so this is never mocked: for every multi-tenant
// table we assert RLS is enabled AND at least one named policy guards it, read
// straight from the Postgres catalog via the rls_policy_report() helper.

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const hasLiveSupabase = Boolean(url && serviceKey);

// The 7 multi-tenant tables named in CLAUDE.md / the compliance loop.
const TENANT_TABLES = [
  "tenants",
  "users",
  "documents",
  "document_chunks",
  "queries",
  "subscriptions",
  "invitations"
] as const;

type PolicyRow = { table_name: string; rls_enabled: boolean; policy_count: number };

describe.skipIf(!hasLiveSupabase)("@AC-5.7 RLS on every multi-tenant table", () => {
  let report: Map<string, PolicyRow>;

  beforeAll(async () => {
    const admin: SupabaseClient = createClient(url!, serviceKey!, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
    const { data, error } = await admin.rpc("rls_policy_report");
    if (error) throw error;
    report = new Map((data as PolicyRow[]).map((r) => [r.table_name, r]));
  });

  it.each(TENANT_TABLES)("%s has RLS enabled", (table) => {
    const row = report.get(table);
    expect(row, `${table} missing from catalog`).toBeDefined();
    expect(row!.rls_enabled, `${table} RLS not enabled`).toBe(true);
  });

  it.each(TENANT_TABLES)("%s has at least one named policy", (table) => {
    const row = report.get(table);
    expect(row, `${table} missing from catalog`).toBeDefined();
    expect(Number(row!.policy_count), `${table} has no RLS policy`).toBeGreaterThanOrEqual(1);
  });
});

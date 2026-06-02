import { notFound } from "next/navigation";
import { getPlatformAdmin } from "@/lib/founder/guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTenantOverview, summarizeOverview } from "@/lib/founder/stats";
import { FounderPanel } from "@/components/founder/founder-panel";

// AC-8.1 / AC-8.2 / AC-8.3 — the founder super-admin panel. Gated by
// getPlatformAdmin (PLATFORM_ADMIN_EMAILS allowlist): a non-admin — signed in or
// not — gets notFound() so the route's existence never leaks. This is the ONLY
// place the cross-tenant (RLS-bypassing) overview surfaces in the UI.
//
// Not in the proxy matcher on purpose: the allowlist gate here is stricter than
// the proxy's "any authenticated user" check, and this route is for the founder,
// not a tenant member, so it must not flow through the (app) tenant shell.
export const dynamic = "force-dynamic";

export default async function FounderPage() {
  const admin = await getPlatformAdmin();
  if (!admin) notFound();

  // Behind the gate → safe to use the service-role client (bypasses RLS).
  const db = createAdminClient();
  const rows = await getTenantOverview(db);
  const stats = summarizeOverview(rows);

  return <FounderPanel rows={rows} stats={stats} founderEmail={admin.email} />;
}

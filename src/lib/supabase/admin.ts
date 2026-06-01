import { createClient } from "@supabase/supabase-js";

// Service-role client — bypasses RLS. Used only for server-side tenant/user
// provisioning that no client policy can perform (no INSERT policy on tenants
// by design). The key name has no NEXT_PUBLIC_ prefix, so Next never bundles it
// into client output — keep all imports of this module on the server.
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set for admin operations."
    );
  }
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
}

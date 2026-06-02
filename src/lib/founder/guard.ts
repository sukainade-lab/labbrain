import { createClient } from "@/lib/supabase/server";
import { isPlatformAdmin } from "@/lib/auth/platform-admin";

// AC-8.1 — the server-side founder gate, evaluated on every founder route AND the
// /founder page. Returns the authenticated platform-admin, or null when the caller
// is not signed in OR not on the PLATFORM_ADMIN_EMAILS allowlist. Callers treat
// null as 404 — a non-admin must never learn the route exists. This is the entire
// security boundary for the cross-tenant (RLS-bypassing) founder surface.
export async function getPlatformAdmin(): Promise<{ id: string; email: string } | null> {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user?.email) return null;
  if (!isPlatformAdmin(user.email)) return null;
  return { id: user.id, email: user.email };
}

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { publicLogoUrl } from "@/lib/branding/logo";
import { MfaSettings } from "@/components/auth/mfa-settings";
import { BrandingSettings } from "@/components/branding/branding-settings";

// AC-7.1 / AC-7.6 / AC-12.7 — account settings. Server component: reads the
// signed-in user's 2FA state (phone, mfa_enabled) and role/tenant via the
// RLS-bound session client (self-read is allowed), then hands them to the client
// sections. The Branding section is admin-only — rendered only for owner/admin so
// the visible surface mirrors the API's 403 gate (L4).
export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  // proxy.ts already gates this route, but guard anyway so the page never renders
  // without a user (and TS narrows the id below).
  if (!user) redirect("/login");

  const { data: me } = await supabase
    .from("users")
    .select("phone, mfa_enabled, role, tenant_id")
    .eq("id", user.id)
    .maybeSingle();

  const isAdmin = me?.role === "owner" || me?.role === "admin";

  // Branding section needs the lab name + current logo URL. Read via the
  // service-role client so it's independent of tenants-table RLS shape.
  let labName = "LabBrain";
  let logoUrl: string | null = null;
  if (isAdmin && me?.tenant_id) {
    const admin = createAdminClient();
    const { data: tenant } = await admin
      .from("tenants")
      .select("name, logo_path")
      .eq("id", me.tenant_id)
      .single();
    labName = tenant?.name?.trim() || "LabBrain";
    logoUrl = publicLogoUrl(admin, tenant?.logo_path ?? null);
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-navy">الإعدادات</h1>
      <p className="mt-2 text-muted">إدارة حسابك وأمانه.</p>

      <div className="mt-8 max-w-xl space-y-8">
        <MfaSettings
          initialEnabled={Boolean(me?.mfa_enabled)}
          initialPhone={me?.phone ?? null}
        />

        {isAdmin && <BrandingSettings initialLogoUrl={logoUrl} labName={labName} />}
      </div>
    </div>
  );
}

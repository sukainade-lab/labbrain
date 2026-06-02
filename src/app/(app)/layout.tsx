import { LogoutButton } from "@/components/layout/logout-button";
import { NavLinks } from "@/components/layout/nav-links";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { publicLogoUrl } from "@/lib/branding/logo";

// Shell layout for authenticated app routes. Route protection is enforced in
// proxy.ts (gates the (app) group behind a Supabase session).
//
// AC-12.4 — the sidebar shows the tenant's own branding: its logo + lab name,
// replacing the static "LabBrain" wordmark. Graceful fallback chain:
//   logo + name  →  name only  →  "LabBrain" wordmark (no name).
// The lab name is <bdi>-wrapped so a Latin lab name never reorders inside the RTL
// sidebar (L5). The logo <img> carries an Arabic alt + explicit dims (AC-12.6).
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  let labName: string | null = null;
  let logoUrl: string | null = null;
  if (user) {
    const { data: me } = await supabase
      .from("users")
      .select("tenant_id")
      .eq("id", user.id)
      .maybeSingle();
    if (me?.tenant_id) {
      const admin = createAdminClient();
      const { data: tenant } = await admin
        .from("tenants")
        .select("name, logo_path")
        .eq("id", me.tenant_id)
        .single();
      labName = tenant?.name?.trim() || null;
      logoUrl = publicLogoUrl(admin, tenant?.logo_path ?? null);
    }
  }

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 flex-col border-l border-slate-800 bg-slate-900/40 p-6">
        <div className="flex items-center gap-2">
          {logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoUrl}
              alt={labName ? `شعار ${labName}` : "شعار المختبر"}
              width={28}
              height={28}
              className="h-7 w-7 shrink-0 object-contain"
            />
          )}
          {labName ? (
            <bdi dir="auto" className="text-lg font-bold text-amber-500">
              {labName}
            </bdi>
          ) : (
            <span className="text-lg font-bold text-amber-500">LabBrain</span>
          )}
        </div>
        <NavLinks />
        <div className="mt-auto pt-8">
          <LogoutButton />
        </div>
      </aside>
      <main className="flex-1 px-8 py-10">{children}</main>
    </div>
  );
}

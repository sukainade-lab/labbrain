import { LogoutButton } from "@/components/layout/logout-button";
import { NavLinks } from "@/components/layout/nav-links";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { publicLogoUrl, resolveSidebarBrand } from "@/lib/branding/logo";

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
      labName = tenant?.name ?? null;
      logoUrl = publicLogoUrl(admin, tenant?.logo_path ?? null);
    }
  }

  const brand = resolveSidebarBrand(labName, logoUrl);

  return (
    <div className="flex min-h-screen bg-canvas">
      <aside className="flex w-60 flex-col border-e border-line bg-card p-6 shadow-soft">
        <div className="flex items-center gap-3">
          {brand.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={brand.logoUrl}
              alt={brand.logoAlt}
              width={36}
              height={36}
              className="h-9 w-9 shrink-0 rounded-control object-contain"
            />
          ) : (
            // Amber brand square (accent-only bright amber on navy glyph) when no
            // custom logo — mirrors the reference's brand mark.
            <span
              aria-hidden="true"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-amber-bright font-bold text-navy"
            >
              L
            </span>
          )}
          {brand.showWordmark ? (
            <span className="text-lg font-bold text-navy">LabBrain</span>
          ) : (
            <bdi dir="auto" className="text-lg font-bold text-navy">
              {brand.labName}
            </bdi>
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

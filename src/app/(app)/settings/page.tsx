import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { MfaSettings } from "@/components/auth/mfa-settings";

// AC-7.1 / AC-7.6 — account settings. Server component: reads the signed-in user's
// 2FA state (phone, mfa_enabled) via the RLS-bound session client (self-read is
// allowed), then hands it to the client section that drives enroll/disable.
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
    .select("phone, mfa_enabled")
    .eq("id", user.id)
    .maybeSingle();

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-100">الإعدادات</h1>
      <p className="mt-2 text-slate-400">إدارة حسابك وأمانه.</p>

      <div className="mt-8 max-w-xl">
        <MfaSettings
          initialEnabled={Boolean(me?.mfa_enabled)}
          initialPhone={me?.phone ?? null}
        />
      </div>
    </div>
  );
}

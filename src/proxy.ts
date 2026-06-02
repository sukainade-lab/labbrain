import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { MFA_COOKIE_NAME, verifyMfaCookie } from "@/lib/auth/mfa-cookie";

// Gates the (app) route group behind a Supabase session and refreshes the
// auth cookie on every request. Unauthenticated users are sent to /login.
//
// AC-7.4 — second-factor gate: a user who has opted into 2FA (users.mfa_enabled)
// must ALSO carry a valid lb_mfa elevation cookie. Password auth alone (a valid
// Supabase session) is not enough — without the cookie they're redirected to the
// verify screen. Users without 2FA are unaffected. This middleware addition is the
// entire security value of S7: it proves a 2FA user can't reach (app) on the
// Supabase cookie alone.
export async function proxy(req: NextRequest) {
  const res = NextResponse.next();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options?: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value, options }) =>
            res.cookies.set(name, value, options)
          );
        }
      }
    }
  );

  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // Second-factor gate. Read the user's own row (RLS allows self-read) to see if
  // they've enrolled; if so, require a valid, matching lb_mfa cookie.
  const { data: me } = await supabase
    .from("users")
    .select("mfa_enabled")
    .eq("id", user.id)
    .maybeSingle();

  if (me?.mfa_enabled) {
    const secret = process.env.MFA_COOKIE_SECRET ?? "";
    const marker = verifyMfaCookie(req.cookies.get(MFA_COOKIE_NAME)?.value, secret);
    if (!marker || marker.userId !== user.id) {
      const url = req.nextUrl.clone();
      url.pathname = "/login/verify";
      return NextResponse.redirect(url);
    }
  }

  return res;
}

// Protect every member of the (app) group (dashboard, documents, qa, admin, settings).
// Public routes are unaffected. Keep this in sync when adding (app) routes.
// In Next 16 the Proxy always runs on the Node.js runtime, so the HMAC cookie check
// (node:crypto) works without a runtime config key (which is now disallowed here).
export const config = {
  matcher: [
    "/dashboard/:path*",
    "/documents/:path*",
    "/qa/:path*",
    "/admin/:path*",
    "/settings/:path*"
  ]
};

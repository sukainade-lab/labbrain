import type { SupabaseClient } from "@supabase/supabase-js";

// Maps Supabase auth error messages to user-facing Arabic (Jordanian register).
// AC-1.5: every flow returns an appropriate message for invalid input.
export function mapAuthError(message: string | undefined): string {
  const m = (message ?? "").toLowerCase();
  if (m.includes("invalid login credentials")) return "البريد الإلكتروني أو كلمة المرور غير صحيحة";
  if (m.includes("email not confirmed")) return "لم يتم تأكيد بريدك الإلكتروني بعد";
  if (m.includes("rate limit") || m.includes("too many")) return "محاولات كثيرة، حاول بعد قليل";
  if (m.includes("user already registered") || m.includes("already")) return "هذا البريد مسجّل مسبقاً";
  return "تعذّر إتمام العملية، تأكد من البيانات وحاول مجدداً";
}

export type AuthActionResult = { ok: boolean; error?: string; userId?: string };

export async function attemptLogin(
  supabase: SupabaseClient,
  input: { email: string; password: string }
): Promise<AuthActionResult> {
  const { data, error } = await supabase.auth.signInWithPassword(input);
  if (error) return { ok: false, error: mapAuthError(error.message) };
  return { ok: true, userId: data.user?.id };
}

export async function requestPasswordReset(
  supabase: SupabaseClient,
  email: string,
  redirectTo: string
): Promise<AuthActionResult> {
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
  // Do not leak whether the email exists — report success regardless of lookup.
  if (error && !error.message.toLowerCase().includes("not found")) {
    return { ok: false, error: mapAuthError(error.message) };
  }
  return { ok: true };
}

import { ONBOARDING_PATH } from "@/lib/auth/provision";

// Only allow same-origin relative paths to prevent open-redirect via ?next.
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return ONBOARDING_PATH;
  return next;
}

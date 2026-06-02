import { VerifyForm } from "@/components/auth/verify-form";

// AC-7.3 / AC-7.4 — the login second-factor step. A 2FA-enabled user lands here after
// password auth (and the proxy keeps them here until they elevate). Public route
// group, so it's reachable without the lb_mfa cookie they're about to earn.
export default function LoginVerifyPage() {
  return <VerifyForm />;
}

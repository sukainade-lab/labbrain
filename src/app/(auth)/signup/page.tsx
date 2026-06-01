import { SignupForm } from "@/components/auth/signup-form";

// AC-1.1 / AC-1.4 — signup page. Reads ?token= for invite-join flow (renders the
// invite variant of the form that hides the lab-name field).
export default async function SignupPage({
  searchParams
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return <SignupForm token={token} />;
}

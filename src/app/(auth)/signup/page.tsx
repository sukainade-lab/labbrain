import { SignupForm } from "@/components/auth/signup-form";

// AC-1.1 / AC-1.4 — signup page. Reads ?token= for invite-join flow (renders the
// invite variant of the form that hides the lab-name field). AC-4.2: ?plan=/
// ?interval= ride in from a logged-out plan pick so checkout resumes after the
// account is confirmed (validated downstream by parseResume).
export default async function SignupPage({
  searchParams
}: {
  searchParams: Promise<{ token?: string; plan?: string; interval?: string }>;
}) {
  const { token, plan, interval } = await searchParams;
  return <SignupForm token={token} plan={plan} interval={interval} />;
}

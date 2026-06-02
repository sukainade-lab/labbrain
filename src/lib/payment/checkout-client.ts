// AC-4.2 — client-side checkout starter. Pure decision logic, extracted from the
// pricing page so the wiring (the seam the /5-eo-score caught as a dead-end) is
// unit-testable without a DOM. The page passes real `redirect`/`onError` impls.
//
// Contract mirrors /api/checkout:
//   • 200 { url }  → an authenticated tenant: redirect to the provider's page
//                    (AC-6.1 router picks Tap for JOD/Gulf, Stripe otherwise).
//   • 401          → not signed in: send them to /signup carrying plan+interval,
//                    then onboarding → /pricing resumes the purchase.
//   • anything else → surface a localized error (never a silent no-op).
export interface StartCheckoutDeps {
  /** Defaults to global fetch; injectable for tests. */
  fetchFn?: typeof fetch;
  /** Navigate the browser (e.g. (u) => { window.location.href = u; }). */
  redirect: (url: string) => void;
  /** Show a user-facing error message. */
  onError: (message: string) => void;
}

export async function startCheckout(
  plan: string,
  interval: string,
  deps: StartCheckoutDeps,
  // The user-facing currency. When provided it picks the rail server-side (JOD →
  // Tap). Omitted (the S4 contract) → Stripe, so the shipped loop is unchanged.
  currency?: string
): Promise<void> {
  const fetchFn = deps.fetchFn ?? fetch;
  try {
    const res = await fetchFn("/api/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(currency ? { plan, interval, currency } : { plan, interval })
    });

    // Not signed in → create an account first, carrying the chosen plan.
    if (res.status === 401) {
      deps.redirect(`/signup?plan=${plan}&interval=${interval}`);
      return;
    }

    const data = (await res.json().catch(() => null)) as { url?: string } | null;
    if (res.ok && data?.url) {
      deps.redirect(data.url);
      return;
    }

    deps.onError("تعذّر بدء عملية الدفع. حاول مرة أخرى.");
  } catch {
    deps.onError("تعذّر الاتصال. تحقق من اتصالك بالإنترنت وحاول مجدداً.");
  }
}

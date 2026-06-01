import { InvoiceRequestForm } from "@/components/billing/invoice-request-form";

// AC-4.2 fallback — bank-transfer / invoice request page. `?plan=` pre-selects
// the plan when arriving from the pricing page.
export default async function InvoiceRequestPage({
  searchParams
}: {
  searchParams: Promise<{ plan?: string }>;
}) {
  const { plan } = await searchParams;
  return <InvoiceRequestForm defaultPlan={plan} />;
}

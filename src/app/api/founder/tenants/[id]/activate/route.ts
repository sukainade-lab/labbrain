import { runFounderMutation } from "@/lib/founder/route-helpers";
import { activateInvoice } from "@/lib/founder/actions";

// POST /api/founder/tenants/[id]/activate — mark a bank-transfer/invoice payment
// as paid: manual tenant activation reusing activation-core (AC-8.5).
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return runFounderMutation(id, activateInvoice);
}

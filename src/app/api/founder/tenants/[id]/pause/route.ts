import { runFounderMutation } from "@/lib/founder/route-helpers";
import { pauseTenant } from "@/lib/founder/actions";

// POST /api/founder/tenants/[id]/pause — founder-only access freeze (AC-8.4).
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return runFounderMutation(id, pauseTenant);
}

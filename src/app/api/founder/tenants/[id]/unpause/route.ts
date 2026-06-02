import { runFounderMutation } from "@/lib/founder/route-helpers";
import { unpauseTenant } from "@/lib/founder/actions";

// POST /api/founder/tenants/[id]/unpause — restore access for a paused lab (AC-8.4).
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return runFounderMutation(id, unpauseTenant);
}

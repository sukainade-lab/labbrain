import { handleCutover } from "@/lib/migration/route-core";

// POST /api/founder/tenants/[id]/migrate/cutover — the distinct, confirmed
// residency flip for a VERIFIED migration (AC-10.5). Platform-admin only; 409 if
// not verified or already cut over.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleCutover(id);
}

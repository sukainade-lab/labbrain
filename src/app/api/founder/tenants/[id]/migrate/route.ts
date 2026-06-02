import { handleMigrate, handleStatus } from "@/lib/migration/route-core";

// POST /api/founder/tenants/[id]/migrate — run export→import→verify for a tenant
// (KSA PDPL migration). Platform-admin only; does NOT cut over (AC-10.1/10.4).
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleMigrate(id);
}

// GET /api/founder/tenants/[id]/migrate — current migration status (AC-10.1).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleStatus(id);
}

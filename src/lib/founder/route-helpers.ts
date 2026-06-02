import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPlatformAdmin } from "./guard";

type Admin = ReturnType<typeof createAdminClient>;
type Mutation = (admin: Admin, tenantId: string) => Promise<void>;

const tenantIdSchema = z.string().uuid();

// AC-8.6 — the shared founder-mutation handler. Centralizes the branch shape so
// every founder route behaves identically and the gate can never be forgotten:
//   • not a platform admin → 404 (never reveal the route to a non-admin)
//   • bad tenant id        → 400
//   • success              → 200, mutation run via the service role
// The gate is enforced HERE on every mutation, not only on the page — the page
// gate alone would leave the APIs open.
export async function runFounderMutation(tenantId: string, mutate: Mutation): Promise<Response> {
  const caller = await getPlatformAdmin();
  if (!caller) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const parsed = tenantIdSchema.safeParse(tenantId);
  if (!parsed.success) {
    return NextResponse.json({ error: "معرّف غير صالح" }, { status: 400 });
  }

  await mutate(createAdminClient(), parsed.data);
  return NextResponse.json({ ok: true });
}

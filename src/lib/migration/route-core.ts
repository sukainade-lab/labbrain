import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPlatformAdmin } from "@/lib/founder/guard";
import { captureError } from "@/lib/observability/log";
import { createKsaTarget } from "./target";
import {
  runMigration,
  cutoverMigration,
  createSourceReader,
  createSupabaseStore,
  MigrationError
} from "./run";

// S10 — shared handlers for the founder migration routes (AC-10.1). Centralizes
// the platform-admin gate + tenant-id validation + MigrationError→HTTP mapping so
// every migration route behaves identically and the gate can never be forgotten
// (sibling to founder/route-helpers.ts). The gate fails CLOSED to 404 — a
// non-admin must never learn the route exists.

const idSchema = z.string().uuid();

const notFound = () => NextResponse.json({ error: "Not found" }, { status: 404 });
const badId = () => NextResponse.json({ error: "معرّف غير صالح" }, { status: 400 });

// Typed migration failures → HTTP. Unexpected errors are logged and surfaced as
// 500 (never leak internals). verify_failed → 422 (cutover refused, AC-10.4);
// already_cutover / not_verified → 409 (wrong state).
function mapError(scope: string, err: unknown): Response {
  if (err instanceof MigrationError) {
    if (err.code === "verify_failed") {
      return NextResponse.json({ error: err.message, diff: err.diff }, { status: 422 });
    }
    return NextResponse.json({ error: err.message }, { status: 409 });
  }
  captureError(scope, err);
  return NextResponse.json({ error: "تعذّر تنفيذ عملية النقل." }, { status: 500 });
}

// POST — run export → import → verify (does NOT cut over; AC-10.4).
export async function handleMigrate(tenantId: string): Promise<Response> {
  const caller = await getPlatformAdmin();
  if (!caller) return notFound();
  const parsed = idSchema.safeParse(tenantId);
  if (!parsed.success) return badId();

  const admin = createAdminClient();
  try {
    const migration = await runMigration(
      { source: createSourceReader(admin), target: createKsaTarget(), store: createSupabaseStore(admin) },
      { tenantId: parsed.data, startedBy: caller.email }
    );
    return NextResponse.json({ ok: true, migration });
  } catch (err) {
    return mapError("migration-run", err);
  }
}

// POST — cutover: flip the residency pointer for a verified run (AC-10.5).
export async function handleCutover(tenantId: string): Promise<Response> {
  const caller = await getPlatformAdmin();
  if (!caller) return notFound();
  const parsed = idSchema.safeParse(tenantId);
  if (!parsed.success) return badId();

  const admin = createAdminClient();
  try {
    const migration = await cutoverMigration({ store: createSupabaseStore(admin) }, {
      tenantId: parsed.data
    });
    return NextResponse.json({ ok: true, migration });
  } catch (err) {
    return mapError("migration-cutover", err);
  }
}

// GET — current migration status for the tenant (AC-10.1 status route).
export async function handleStatus(tenantId: string): Promise<Response> {
  const caller = await getPlatformAdmin();
  if (!caller) return notFound();
  const parsed = idSchema.safeParse(tenantId);
  if (!parsed.success) return badId();

  const admin = createAdminClient();
  try {
    const migration = await createSupabaseStore(admin).get(parsed.data);
    return NextResponse.json({ ok: true, migration });
  } catch (err) {
    return mapError("migration-status", err);
  }
}

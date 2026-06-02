import type { SupabaseClient } from "@supabase/supabase-js";
import { buildBundle, type BundleReader } from "./bundle";
import { compareParity } from "./verify";
import type { MigrationStatus } from "./state";
import { supabaseBundleReader, type MigrationTarget } from "./target";

// S10 — the migration orchestrator. Drives export → import → verify (runMigration)
// and the distinct, confirmed residency flip (cutoverMigration), enforcing the
// AC-10.6 state machine and the AC-10.4 "verify before cutover, never destructive"
// rule. Depends only on injected ports (source reader, target seam, store), so it
// unit-tests without a DB; the Supabase adapters at the bottom wire it to live EU.

export interface MigrationRecord {
  id?: string; // present once persisted; drives update-vs-insert in the live store
  tenantId: string;
  status: MigrationStatus;
  sourceRegion: string;
  targetRegion: string;
  startedBy: string;
  rowCounts?: Record<string, number>;
  verificationHash?: string;
  error?: string;
}

// Persistence port for the tenant_migrations run-log + the tenants.data_region
// pointer. The EU service-role adapter implements it; tests inject an in-memory fake.
export interface MigrationStore {
  get(tenantId: string): Promise<MigrationRecord | null>;
  upsert(record: MigrationRecord): Promise<void>;
  // ATOMIC cutover: flip tenants.data_region AND mark the run 'cutover' in a single
  // transaction. Split writes risk a "region flipped but status still verified" gap
  // that would let a retried cutover re-run / re-import (see migration 0015).
  commitCutover(record: MigrationRecord, region: string): Promise<void>;
}

export interface RunDeps {
  source: BundleReader;
  target: MigrationTarget;
  store: MigrationStore;
}

export type MigrationErrorCode = "already_cutover" | "not_verified" | "verify_failed";

// Typed failures so routes can map each to its HTTP status (AC-10.1) without
// string-matching messages.
export class MigrationError extends Error {
  constructor(
    public readonly code: MigrationErrorCode,
    message: string,
    public readonly diff?: string[]
  ) {
    super(message);
    this.name = "MigrationError";
  }
}

const EU = "eu-frankfurt";
const KSA = "ksa-me-central-1";

// AC-10.2/10.3/10.4 — export the tenant, import it into the target, verify parity.
// On match → record 'verified' (eligible for cutover). On mismatch → record
// 'failed' and throw; the source stays authoritative (zero data loss). Re-running
// is safe: import is upsert-idempotent and a verified re-run simply re-verifies.
export async function runMigration(
  deps: RunDeps,
  opts: { tenantId: string; startedBy: string }
): Promise<MigrationRecord> {
  const { tenantId, startedBy } = opts;

  const existing = await deps.store.get(tenantId);
  if (existing?.status === "cutover") {
    throw new MigrationError("already_cutover", "tenant already migrated to the KSA region");
  }

  const base: MigrationRecord = existing ?? {
    tenantId,
    status: "pending",
    sourceRegion: EU,
    targetRegion: KSA,
    startedBy
  };

  const bundle = await buildBundle(deps.source, tenantId);
  await deps.target.importBundle(bundle);

  const parity = compareParity({
    source: { checksum: bundle.checksum, rowCounts: bundle.rowCounts },
    target: await deps.target.summarize(tenantId)
  });

  if (!parity.match) {
    const failed: MigrationRecord = {
      ...base,
      status: "failed",
      rowCounts: bundle.rowCounts,
      error: parity.diff.join("; ")
    };
    await deps.store.upsert(failed);
    throw new MigrationError("verify_failed", "parity check failed", parity.diff);
  }

  const verified: MigrationRecord = {
    ...base,
    status: "verified",
    rowCounts: bundle.rowCounts,
    verificationHash: bundle.checksum,
    error: undefined
  };
  await deps.store.upsert(verified);
  return verified;
}

// AC-10.5 — cutover: a separate, confirmed action. Flips tenants.data_region to
// the target region ONLY for a 'verified' run; refuses otherwise and never on a
// run already at 'cutover' (no double-migration). Rollback-safe: before this runs
// the source is authoritative; this story never deletes source data.
export async function cutoverMigration(
  deps: Pick<RunDeps, "store">,
  opts: { tenantId: string }
): Promise<MigrationRecord> {
  const rec = await deps.store.get(opts.tenantId);
  if (!rec) throw new MigrationError("not_verified", "no migration to cut over");
  if (rec.status === "cutover") {
    throw new MigrationError("already_cutover", "tenant already migrated to the KSA region");
  }
  if (rec.status !== "verified") {
    throw new MigrationError("not_verified", "migration must pass verification before cutover");
  }

  const done: MigrationRecord = { ...rec, status: "cutover" };
  // Single atomic write: residency flip + 'cutover' run-log state together, so a
  // crash can't leave the tenant pointed at the new region while the log still
  // reads 'verified' (which would let this cutover be re-run / re-imported).
  await deps.store.commitCutover(done, rec.targetRegion);
  return done;
}

// ── Live adapters (EU service-role side) ─────────────────────────────────────

export function createSourceReader(admin: SupabaseClient): BundleReader {
  return supabaseBundleReader(admin);
}

// Maps the tenant_migrations table rows ⇄ MigrationRecord and flips
// tenants.data_region. One in-flight run per tenant is enforced by the partial
// unique index (migration 0012), so a single-row upsert keyed on tenant is correct.
export function createSupabaseStore(admin: SupabaseClient): MigrationStore {
  return {
    async get(tenantId) {
      const { data, error } = await admin
        .from("tenant_migrations")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return {
        id: data.id,
        tenantId: data.tenant_id,
        status: data.status,
        sourceRegion: data.source_region,
        targetRegion: data.target_region,
        startedBy: data.started_by,
        rowCounts: data.row_counts ?? undefined,
        verificationHash: data.verification_hash ?? undefined,
        error: data.error ?? undefined
      };
    },
    async upsert(record) {
      const terminal = record.status === "cutover" || record.status === "failed";
      // No unique key on tenant_id (only the partial one-active index), so update
      // the existing row by id when resuming a run, else insert a fresh one.
      const payload = {
        tenant_id: record.tenantId,
        status: record.status,
        source_region: record.sourceRegion,
        target_region: record.targetRegion,
        started_by: record.startedBy,
        row_counts: record.rowCounts ?? null,
        verification_hash: record.verificationHash ?? null,
        error: record.error ?? null,
        finished_at: terminal ? new Date().toISOString() : null
      };
      const { error } = record.id
        ? await admin.from("tenant_migrations").update(payload).eq("id", record.id)
        : await admin.from("tenant_migrations").insert(payload);
      if (error) throw error;
    },
    async commitCutover(record, region) {
      // One transaction (migration 0015): flips tenants.data_region AND sets the
      // run-log row to 'cutover'/finished_at together. record.id is always present
      // here — cutoverMigration reads the row (with its id) before committing.
      if (!record.id) throw new Error("commitCutover requires a persisted migration id");
      const { error } = await admin.rpc("cutover_tenant_migration", {
        p_migration_id: record.id,
        p_tenant_id: record.tenantId,
        p_region: region
      });
      if (error) throw error;
    }
  };
}

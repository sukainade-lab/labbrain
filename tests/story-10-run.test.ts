import { describe, it, expect } from "vitest";
import {
  buildBundle,
  TENANT_TABLES,
  type BundleReader,
  type Row,
  type StorageObject,
  type TableName
} from "@/lib/migration/bundle";
import type { MigrationTarget } from "@/lib/migration/target";
import {
  runMigration,
  cutoverMigration,
  MigrationError,
  type MigrationRecord,
  type MigrationStore
} from "@/lib/migration/run";

// S10 — orchestrator unit tests (AC-10.3 idempotent import, AC-10.4
// verify-before-cutover, AC-10.5 cutover + residency flip, AC-10.6 state machine).
// Everything is injected: a fake source reader, a fake in-memory MigrationTarget,
// and a fake store. No DB / no network.

const TENANT = "11111111-1111-1111-1111-111111111111";

function sourceReader(data: Partial<Record<string, Row[]>>, storage: StorageObject[] = []): BundleReader {
  return {
    async fetchRows(table) {
      return (data[table] ?? []).map((r) => ({ ...r }));
    },
    async listStorageObjects() {
      return storage.map((s) => ({ ...s }));
    }
  };
}

// In-memory target that faithfully (or, with dropTable, lossily) stores the bundle
// and recomputes its summary through the SAME buildBundle hashing the source uses.
function fakeTarget(opts: { dropTable?: TableName } = {}) {
  let tables: Record<TableName, Row[]> | null = null;
  let storage: StorageObject[] = [];
  let importCount = 0;
  const target: MigrationTarget = {
    async importBundle(bundle) {
      importCount++;
      tables = {} as Record<TableName, Row[]>;
      for (const t of TENANT_TABLES) {
        const rows = bundle.tables[t];
        tables[t] = opts.dropTable === t ? rows.slice(1) : rows.map((r) => ({ ...r }));
      }
      storage = bundle.storage.map((s) => ({ ...s }));
    },
    async summarize(tenantId) {
      const reader: BundleReader = {
        async fetchRows(table) {
          return tables![table];
        },
        async listStorageObjects() {
          return storage;
        }
      };
      const b = await buildBundle(reader, tenantId);
      return { checksum: b.checksum, rowCounts: b.rowCounts };
    }
  };
  return { target, get importCount() { return importCount; }, get tables() { return tables; } };
}

function fakeStore(initial: MigrationRecord | null = null) {
  let rec = initial;
  let region = "eu-frankfurt";
  const store: MigrationStore = {
    async get() {
      return rec;
    },
    async upsert(r) {
      rec = r;
    },
    async commitCutover(r, reg) {
      // Fake mirrors the live RPC: both effects land together (in-memory = atomic).
      rec = r;
      region = reg;
    }
  };
  return {
    store,
    get rec() {
      return rec;
    },
    get region() {
      return region;
    }
  };
}

const seed = { tenants: [{ id: TENANT }], users: [{ id: "u1" }, { id: "u2" }], queries: [{ id: "q1" }] };

describe("S10 runMigration (export → import → verify)", () => {
  it("@AC-10.4 faithful import → status 'verified', verification hash recorded", async () => {
    const t = fakeTarget();
    const s = fakeStore();
    const rec = await runMigration(
      { source: sourceReader(seed), target: t.target, store: s.store },
      { tenantId: TENANT, startedBy: "founder@lab.com" }
    );
    expect(rec.status).toBe("verified");
    expect(rec.verificationHash).toBeTruthy();
    expect(rec.rowCounts!.users).toBe(2);
    expect(s.rec!.status).toBe("verified");
    expect(s.region).toBe("eu-frankfurt"); // run does NOT cut over
  });

  it("@AC-10.4 parity mismatch → throws verify_failed, record 'failed', region NOT flipped", async () => {
    const t = fakeTarget({ dropTable: "queries" });
    const s = fakeStore();
    await expect(
      runMigration(
        { source: sourceReader(seed), target: t.target, store: s.store },
        { tenantId: TENANT, startedBy: "founder@lab.com" }
      )
    ).rejects.toMatchObject({ code: "verify_failed" });
    expect(s.rec!.status).toBe("failed");
    expect(s.rec!.error).toContain("queries");
    expect(s.region).toBe("eu-frankfurt");
  });

  it("@AC-10.3 re-running a verified migration is idempotent — converges, no duplicate record", async () => {
    const t = fakeTarget();
    const s = fakeStore();
    const deps = { source: sourceReader(seed), target: t.target, store: s.store };
    await runMigration(deps, { tenantId: TENANT, startedBy: "f@lab.com" });
    const second = await runMigration(deps, { tenantId: TENANT, startedBy: "f@lab.com" });
    expect(second.status).toBe("verified");
    expect(t.importCount).toBe(2); // re-import is safe (upsert semantics)
    expect(s.rec!.status).toBe("verified");
  });

  it("@AC-10.6 refuses to re-run a tenant already cut over", async () => {
    const s = fakeStore({
      tenantId: TENANT,
      status: "cutover",
      sourceRegion: "eu-frankfurt",
      targetRegion: "ksa-me-central-1",
      startedBy: "f@lab.com"
    });
    await expect(
      runMigration(
        { source: sourceReader(seed), target: fakeTarget().target, store: s.store },
        { tenantId: TENANT, startedBy: "f@lab.com" }
      )
    ).rejects.toMatchObject({ code: "already_cutover" });
  });
});

describe("S10 cutoverMigration (residency flip)", () => {
  it("@AC-10.5 verified → cutover flips data_region to ksa-me-central-1", async () => {
    const s = fakeStore({
      tenantId: TENANT,
      status: "verified",
      sourceRegion: "eu-frankfurt",
      targetRegion: "ksa-me-central-1",
      startedBy: "f@lab.com",
      verificationHash: "h1"
    });
    const rec = await cutoverMigration({ store: s.store }, { tenantId: TENANT });
    expect(rec.status).toBe("cutover");
    expect(s.region).toBe("ksa-me-central-1");
  });

  it("@AC-10.5 refuses cutover when not yet verified", async () => {
    const s = fakeStore({
      tenantId: TENANT,
      status: "imported",
      sourceRegion: "eu-frankfurt",
      targetRegion: "ksa-me-central-1",
      startedBy: "f@lab.com"
    });
    await expect(cutoverMigration({ store: s.store }, { tenantId: TENANT })).rejects.toMatchObject({
      code: "not_verified"
    });
    expect(s.region).toBe("eu-frankfurt");
  });

  it("@AC-10.6 refuses a second cutover (no double-migration)", async () => {
    const s = fakeStore({
      tenantId: TENANT,
      status: "cutover",
      sourceRegion: "eu-frankfurt",
      targetRegion: "ksa-me-central-1",
      startedBy: "f@lab.com"
    });
    await expect(cutoverMigration({ store: s.store }, { tenantId: TENANT })).rejects.toMatchObject({
      code: "already_cutover"
    });
  });

  it("@AC-10.5 refuses cutover when there is no migration record", async () => {
    const s = fakeStore(null);
    await expect(cutoverMigration({ store: s.store }, { tenantId: TENANT })).rejects.toBeInstanceOf(
      MigrationError
    );
  });
});

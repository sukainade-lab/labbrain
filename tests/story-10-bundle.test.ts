import { describe, it, expect } from "vitest";
import {
  TENANT_TABLES,
  buildBundle,
  bundleChecksum,
  type BundleReader,
  type Row,
  type StorageObject
} from "@/lib/migration/bundle";

// S10 — pure unit tests for the export-bundle builder (AC-10.2). No DB: a fake
// BundleReader feeds rows so we can assert FK ordering, tenant-scoping shape,
// deterministic ordering, content-hash stability, and embedding round-trip.

const TENANT = "11111111-1111-1111-1111-111111111111";

function reader(
  data: Partial<Record<string, Row[]>>,
  storage: StorageObject[] = []
): BundleReader {
  return {
    async fetchRows(table, tenantId) {
      expect(tenantId).toBe(TENANT); // scope is always passed through
      return (data[table] ?? []).map((r) => ({ ...r }));
    },
    async listStorageObjects() {
      return storage.map((s) => ({ ...s }));
    }
  };
}

describe("S10 export bundle builder", () => {
  it("@AC-10.2 covers every tenant-scoped table in FK dependency order", async () => {
    const bundle = await buildBundle(reader({}), TENANT);
    expect(Object.keys(bundle.tables)).toEqual([...TENANT_TABLES]);
    // tenants must precede users which must precede documents/chunks/queries.
    expect(TENANT_TABLES.indexOf("tenants")).toBeLessThan(TENANT_TABLES.indexOf("users"));
    expect(TENANT_TABLES.indexOf("documents")).toBeLessThan(
      TENANT_TABLES.indexOf("document_chunks")
    );
    expect(TENANT_TABLES.indexOf("users")).toBeLessThan(TENANT_TABLES.indexOf("queries"));
  });

  it("@AC-10.2 records per-table row counts and the storage manifest", async () => {
    const bundle = await buildBundle(
      reader(
        {
          tenants: [{ id: TENANT, name: "مختبر ألفا" }],
          users: [{ id: "u1", tenant_id: TENANT }, { id: "u2", tenant_id: TENANT }],
          queries: [{ id: "q1", tenant_id: TENANT }]
        },
        [{ path: `${TENANT}/iso.pdf`, size: 1024, checksum: "abc" }]
      ),
      TENANT
    );
    expect(bundle.rowCounts.tenants).toBe(1);
    expect(bundle.rowCounts.users).toBe(2);
    expect(bundle.rowCounts.queries).toBe(1);
    expect(bundle.rowCounts.documents).toBe(0);
    expect(bundle.storage).toHaveLength(1);
    expect(bundle.storage[0].path).toBe(`${TENANT}/iso.pdf`);
  });

  it("@AC-10.2 orders rows deterministically — same data, different input order → identical checksum", async () => {
    const a = await buildBundle(
      reader({ users: [{ id: "u2", tenant_id: TENANT }, { id: "u1", tenant_id: TENANT }] }),
      TENANT
    );
    const b = await buildBundle(
      reader({ users: [{ id: "u1", tenant_id: TENANT }, { id: "u2", tenant_id: TENANT }] }),
      TENANT
    );
    expect(a.checksum).toBe(b.checksum);
    // and key order inside rows must not matter for the hash
    const c = await buildBundle(
      reader({ users: [{ tenant_id: TENANT, id: "u1" }, { tenant_id: TENANT, id: "u2" }] }),
      TENANT
    );
    expect(c.checksum).toBe(a.checksum);
  });

  it("@AC-10.2 different content → different checksum", async () => {
    const a = await buildBundle(reader({ queries: [{ id: "q1", tenant_id: TENANT }] }), TENANT);
    const b = await buildBundle(reader({ queries: [{ id: "q2", tenant_id: TENANT }] }), TENANT);
    expect(a.checksum).not.toBe(b.checksum);
  });

  it("@AC-10.3 round-trips document_chunks embedding vectors without truncation", async () => {
    const embedding = Array.from({ length: 1536 }, (_, i) => i * 0.0001);
    const bundle = await buildBundle(
      reader({ document_chunks: [{ id: "c1", tenant_id: TENANT, embedding }] }),
      TENANT
    );
    const chunk = bundle.tables.document_chunks[0];
    expect((chunk.embedding as number[]).length).toBe(1536);
    expect(chunk.embedding).toEqual(embedding);
  });

  it("@AC-10.2 bundleChecksum is stable and recomputes the embedded checksum", async () => {
    const bundle = await buildBundle(reader({ tenants: [{ id: TENANT }] }), TENANT);
    expect(bundleChecksum(bundle)).toBe(bundle.checksum);
  });
});

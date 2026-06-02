import { createHash } from "crypto";

// S10 — the export-bundle builder (AC-10.2). Pulls one tenant's complete data set
// across every tenant-scoped table, in FK dependency order, with a deterministic
// content hash so source↔target parity (AC-10.4) reduces to a single comparison.
// Pure: it depends only on an injected BundleReader, so it tests without a DB and
// the same code runs against live Supabase in the orchestrator.

// FK dependency order — parents before children. The import (AC-10.3) replays in
// this order so foreign keys resolve; the export uses it for stable table order.
export const TENANT_TABLES = [
  "tenants",
  "users",
  "documents",
  "document_chunks",
  "queries",
  "subscriptions",
  "invitations",
  "audit_exports"
] as const;

export type TableName = (typeof TENANT_TABLES)[number];
export type Row = Record<string, unknown>;

export interface StorageObject {
  path: string;
  size: number;
  checksum: string;
}

export interface ExportBundle {
  tenantId: string;
  tables: Record<TableName, Row[]>;
  storage: StorageObject[];
  rowCounts: Record<TableName, number>;
  checksum: string;
}

// The data source. The live impl (target.ts / orchestrator) wraps a Supabase
// client; tests inject a fake. fetchRows MUST already be tenant-scoped.
export interface BundleReader {
  fetchRows(table: TableName, tenantId: string): Promise<Row[]>;
  listStorageObjects(tenantId: string): Promise<StorageObject[]>;
}

// Canonical JSON: object keys sorted recursively so row property order can't
// change the hash. Arrays keep their order (vector element order is significant).
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = canonical((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

// Stable per-row sort key: prefer `id`, fall back to canonical JSON of the row.
function sortKey(row: Row): string {
  if (typeof row.id === "string") return row.id;
  return JSON.stringify(canonical(row));
}

function sortRows(rows: Row[]): Row[] {
  return [...rows].sort((a, b) => (sortKey(a) < sortKey(b) ? -1 : sortKey(a) > sortKey(b) ? 1 : 0));
}

// Content hash over the tenant id + every table's sorted rows + the storage
// manifest (sorted by path). Deterministic: identical content → identical hash,
// regardless of fetch order or row key order. This is the value compared in
// verification (AC-10.4) and stored as the PDPL verification_hash (AC-10.5).
export function bundleChecksum(bundle: ExportBundle): string {
  const tables: Record<string, unknown> = {};
  for (const table of TENANT_TABLES) tables[table] = sortRows(bundle.tables[table]);
  const storage = [...bundle.storage].sort((a, b) => (a.path < b.path ? -1 : 1));
  const payload = canonical({ tenantId: bundle.tenantId, tables, storage });
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export async function buildBundle(reader: BundleReader, tenantId: string): Promise<ExportBundle> {
  const tables = {} as Record<TableName, Row[]>;
  const rowCounts = {} as Record<TableName, number>;

  for (const table of TENANT_TABLES) {
    const rows = sortRows(await reader.fetchRows(table, tenantId));
    tables[table] = rows;
    rowCounts[table] = rows.length;
  }

  const storage = [...(await reader.listStorageObjects(tenantId))].sort((a, b) =>
    a.path < b.path ? -1 : 1
  );

  const bundle: ExportBundle = { tenantId, tables, storage, rowCounts, checksum: "" };
  bundle.checksum = bundleChecksum(bundle);
  return bundle;
}

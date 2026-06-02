import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { DOCUMENTS_BUCKET } from "@/lib/documents/ingest";
import {
  buildBundle,
  TENANT_TABLES,
  type BundleReader,
  type ExportBundle,
  type Row,
  type StorageObject,
  type TableName
} from "./bundle";
import type { ParitySide } from "./verify";

// S10 — the MigrationTarget seam (AC-10.3). The orchestrator talks ONLY to this
// interface, so CI/tests inject an in-memory fake while production drives a live
// AWS me-central-1 Supabase via service-role. Mirrors S9's renderPdfFromHtml seam
// and S6's PaymentProvider — the un-mockable cross-region resource lives behind a
// boundary the rest of the code never imports directly.
export interface MigrationTarget {
  // Idempotent: upsert by primary key so a retried/partial run converges.
  importBundle(bundle: ExportBundle): Promise<void>;
  // Reads back the imported tenant as a parity summary (count + content checksum).
  summarize(tenantId: string): Promise<ParitySide>;
}

// 'tenants' is keyed by its own `id`; every child table by `tenant_id`. One place
// so the scope can never drift between source export and target verify.
function scopeColumn(table: TableName): "id" | "tenant_id" {
  return table === "tenants" ? "id" : "tenant_id";
}

// A BundleReader over any Supabase client (shared by the EU source and the KSA
// target). fetchRows is tenant-scoped; listStorageObjects walks the per-tenant
// prefix in the documents bucket (best-effort — byte transfer is runbook-gated;
// the manifest + per-object checksum is what verification compares).
export function supabaseBundleReader(client: SupabaseClient): BundleReader {
  return {
    async fetchRows(table, tenantId) {
      const { data, error } = await client.from(table).select("*").eq(scopeColumn(table), tenantId);
      if (error) throw error;
      return (data ?? []) as Row[];
    },
    async listStorageObjects(tenantId) {
      const { data, error } = await client.storage
        .from(DOCUMENTS_BUCKET)
        .list(tenantId, { limit: 1000 });
      if (error || !data) return [];
      return data
        .filter((o) => o.id) // skip pseudo-folder entries
        .map<StorageObject>((o) => ({
          path: `${tenantId}/${o.name}`,
          size: Number(o.metadata?.size ?? 0),
          checksum: String(o.metadata?.eTag ?? o.metadata?.size ?? "")
        }));
    }
  };
}

// Live KSA target. Lazily constructed from KSA-region service-role env so the
// module imports cleanly in CI (where these are unset) — only a real migration
// run touches them. The key has no NEXT_PUBLIC_ prefix → never bundled client-side.
export function createKsaTarget(): MigrationTarget {
  let client: SupabaseClient | null = null;
  const target = (): SupabaseClient => {
    if (client) return client;
    const url = process.env.KSA_SUPABASE_URL;
    const key = process.env.KSA_SUPABASE_SERVICE_KEY;
    if (!url || !key) {
      throw new Error("KSA_SUPABASE_URL and KSA_SUPABASE_SERVICE_KEY must be set to migrate.");
    }
    client = createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
    return client;
  };

  return {
    async importBundle(bundle) {
      const c = target();
      // FK dependency order — parents before children (TENANT_TABLES is ordered).
      for (const table of TENANT_TABLES) {
        const rows = bundle.tables[table];
        if (rows.length === 0) continue;
        const { error } = await c.from(table).upsert(rows, { onConflict: "id" });
        if (error) throw error;
      }
    },
    async summarize(tenantId) {
      const b = await buildBundle(supabaseBundleReader(target()), tenantId);
      return { checksum: b.checksum, rowCounts: b.rowCounts };
    }
  };
}

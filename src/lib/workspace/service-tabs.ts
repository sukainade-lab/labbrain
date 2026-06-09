import type { createAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createAdminClient>;

// S18 — service-tab CRUD (AC-2.1). A service_tab is a dynamic "خدمة جديدة" tab,
// scoped to one tenant. The permanent "خدماتي الحالية" panel is NOT a row here —
// it is the implicit (panel_type='existing', service_tab_id IS NULL) partition.
//
// Every function takes the tenantId resolved from the session (never client-supplied)
// and stamps/filters on it, so the API can never read or mutate another lab's tabs
// even though it runs with the service-role admin client (AC-2.5).

export interface ServiceTab {
  id: string;
  name: string;
  position: number;
  created_at: string;
}

// List a tenant's New Service tabs, oldest-first by position then creation, so the
// tab bar renders in a stable order.
export async function listServiceTabs(admin: Admin, tenantId: string): Promise<ServiceTab[]> {
  const { data, error } = await admin
    .from("service_tabs")
    .select("id, name, position, created_at")
    .eq("tenant_id", tenantId)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw new Error(`service_tabs list failed: ${error.message}`);
  return (data ?? []) as ServiceTab[];
}

export interface CreateServiceTabInput {
  admin: Admin;
  tenantId: string;
  name: string;
}

// Create a tab at the end of the tenant's current order (position = count). The
// name is assumed already validated (createServiceTabSchema) by the caller.
export async function createServiceTab({
  admin,
  tenantId,
  name
}: CreateServiceTabInput): Promise<ServiceTab> {
  const { count, error: cErr } = await admin
    .from("service_tabs")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId);
  if (cErr) throw new Error(`service_tabs count failed: ${cErr.message}`);

  const { data, error } = await admin
    .from("service_tabs")
    .insert({ tenant_id: tenantId, name, position: count ?? 0 })
    .select("id, name, position, created_at")
    .single();
  if (error) throw new Error(`service_tabs insert failed: ${error.message}`);
  return data as ServiceTab;
}

export interface DeleteServiceTabInput {
  admin: Admin;
  tenantId: string;
  id: string;
}

// Delete a tenant's tab. Returns false if no row matched (wrong id or not owned) so
// the route can answer 404 — the tenant_id filter is the cross-tenant guard (AC-2.5).
// Deleting the tab cascades its documents + chunks (FK on delete cascade, AC-2.1).
export async function deleteServiceTab({
  admin,
  tenantId,
  id
}: DeleteServiceTabInput): Promise<boolean> {
  const { data, error } = await admin
    .from("service_tabs")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .select("id");
  if (error) throw new Error(`service_tabs delete failed: ${error.message}`);
  return (data?.length ?? 0) > 0;
}

// Verify a tenant owns a given tab — the gate the documents POST applies before
// accepting a new_service upload (AC-2.4 cross-tenant guard).
export async function tenantOwnsServiceTab(
  admin: Admin,
  tenantId: string,
  id: string
): Promise<boolean> {
  const { data, error } = await admin
    .from("service_tabs")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`service_tabs ownership check failed: ${error.message}`);
  return Boolean(data);
}

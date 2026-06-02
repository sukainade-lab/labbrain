import type { createAdminClient } from "@/lib/supabase/admin";
import { extForLogoMime } from "@/lib/validation/branding";

type Admin = ReturnType<typeof createAdminClient>;

export const BRANDING_BUCKET = "branding";

// Storage key for a tenant's logo: `{tenant_id}/logo.{ext}`. The first path
// segment is the tenant_id so the storage RLS policy (migration 0013) isolates it.
export function logoStoragePath(tenantId: string, ext: string): string {
  return `${tenantId}/logo.${ext}`;
}

export interface UploadLogoInput {
  admin: Admin;
  tenantId: string;
  file: Blob;
  mimeType: string;
  /** Current logo_path to remove first, if any (replace-in-place). */
  previousPath?: string | null;
}

export interface UploadLogoResult {
  logoPath: string;
  url: string;
}

// Upload (replace-in-place) a tenant's logo (AC-12.1/12.3):
//   1. remove any prior object (different ext → orphan otherwise),
//   2. upload the new bytes under {tenant}/logo.{ext} (upsert),
//   3. point tenants.logo_path at the new key.
// Returns the new key + its public URL. Throws on any storage/DB failure so the
// route surfaces a 500 rather than silently leaving a half-applied state.
export async function uploadLogo({
  admin,
  tenantId,
  file,
  mimeType,
  previousPath
}: UploadLogoInput): Promise<UploadLogoResult> {
  const ext = extForLogoMime(mimeType);
  if (!ext) throw new Error(`unsupported logo mime: ${mimeType}`);

  const logoPath = logoStoragePath(tenantId, ext);

  // Remove a prior object only if it lived at a different key (e.g. a format
  // change png→svg); a same-key upload is handled by upsert below.
  if (previousPath && previousPath !== logoPath) {
    await admin.storage.from(BRANDING_BUCKET).remove([previousPath]);
  }

  const { error: upErr } = await admin.storage
    .from(BRANDING_BUCKET)
    .upload(logoPath, file, { contentType: mimeType, upsert: true });
  if (upErr) throw new Error(`logo upload failed: ${upErr.message}`);

  const { error: updErr } = await admin
    .from("tenants")
    .update({ logo_path: logoPath })
    .eq("id", tenantId);
  if (updErr) {
    // Roll back the object so logo_path and storage never disagree.
    await admin.storage.from(BRANDING_BUCKET).remove([logoPath]);
    throw new Error(`tenant logo_path update failed: ${updErr.message}`);
  }

  const url = publicLogoUrl(admin, logoPath);
  if (!url) throw new Error("failed to resolve public logo url");
  return { logoPath, url };
}

// Remove a tenant's logo (AC-12.5): null the column first (so the header stops
// referencing it even if the object delete lags), then delete the object.
export async function removeLogo(admin: Admin, tenantId: string, logoPath: string): Promise<void> {
  const { error } = await admin.from("tenants").update({ logo_path: null }).eq("id", tenantId);
  if (error) throw new Error(`tenant logo_path clear failed: ${error.message}`);
  await admin.storage.from(BRANDING_BUCKET).remove([logoPath]);
}

// Stable public URL for a logo object (AC-12.6). The branding bucket is
// public-read, so this URL needs no signing/refresh. Null path → null.
export function publicLogoUrl(admin: Admin, logoPath: string | null | undefined): string | null {
  if (!logoPath) return null;
  return admin.storage.from(BRANDING_BUCKET).getPublicUrl(logoPath).data.publicUrl;
}

import { describe, it, expect, vi } from "vitest";
import {
  uploadLogo,
  removeLogo,
  publicLogoUrl,
  resolveSidebarBrand,
  logoStoragePath,
  BRANDING_BUCKET
} from "@/lib/branding/logo";
import type { createAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createAdminClient>;

// S12 — service-layer unit tests for lib/branding/logo.ts (the "Service (mocked
// admin client)" layer promised in docs/stories/S12.md). The route-seam tests mock
// these helpers out entirely and the live L2 test exercises raw Storage RLS, so
// without this file the core upload/remove/url + sidebar-fallback behaviour
// (AC-12.3/12.4/12.5/12.6) has no direct coverage. The admin client is mocked, so
// this runs anywhere (no live Supabase).

interface AdminOpts {
  uploadError?: { message: string } | null;
  updateError?: { message: string } | null;
}

function makeAdmin(opts: AdminOpts = {}) {
  const calls = {
    remove: [] as string[][],
    upload: [] as { path: string; opts: unknown }[],
    update: [] as { table: string; patch: Record<string, unknown> }[]
  };
  const storageApi = {
    remove: vi.fn(async (paths: string[]) => {
      calls.remove.push(paths);
      return { error: null };
    }),
    upload: vi.fn(async (path: string, _file: unknown, o: unknown) => {
      calls.upload.push({ path, opts: o });
      return { error: opts.uploadError ?? null };
    }),
    getPublicUrl: vi.fn((path: string) => ({
      data: { publicUrl: `https://cdn.example/${BRANDING_BUCKET}/${path}` }
    }))
  };
  const admin = {
    storage: { from: vi.fn(() => storageApi) },
    from: vi.fn((table: string) => ({
      update: vi.fn((patch: Record<string, unknown>) => {
        calls.update.push({ table, patch });
        return { eq: vi.fn(async () => ({ error: opts.updateError ?? null })) };
      })
    }))
  } as unknown as Admin;
  return { admin, calls };
}

function logoBlob() {
  return new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" });
}

describe("logoStoragePath / publicLogoUrl (AC-12.2/12.6)", () => {
  it("@AC-12.2 @AC-12.3 keys the object under {tenant_id}/logo.{ext}", () => {
    expect(logoStoragePath("t1", "png")).toBe("t1/logo.png");
    expect(logoStoragePath("t2", "svg")).toBe("t2/logo.svg");
  });

  it("@AC-12.6 publicLogoUrl returns null for a null/empty path", () => {
    const { admin } = makeAdmin();
    expect(publicLogoUrl(admin, null)).toBeNull();
    expect(publicLogoUrl(admin, undefined)).toBeNull();
    expect(publicLogoUrl(admin, "")).toBeNull();
  });

  it("@AC-12.6 publicLogoUrl builds a stable public URL for a path", () => {
    const { admin } = makeAdmin();
    expect(publicLogoUrl(admin, "t1/logo.png")).toBe(
      "https://cdn.example/branding/t1/logo.png"
    );
  });
});

describe("resolveSidebarBrand — header fallback chain (AC-12.4/12.6, L5)", () => {
  it("@AC-12.4 @AC-12.6 logo + name → renders logo with Arabic alt and the bdi name", () => {
    const b = resolveSidebarBrand("Acme Labs", "https://cdn/x.png");
    expect(b.logoUrl).toBe("https://cdn/x.png");
    expect(b.logoAlt).toBe("شعار Acme Labs");
    expect(b.labName).toBe("Acme Labs");
    expect(b.showWordmark).toBe(false);
  });

  it("@AC-12.4 name only (no logo) → name shown, no logo, not wordmark", () => {
    const b = resolveSidebarBrand("مختبر الأردن", null);
    expect(b.logoUrl).toBeNull();
    expect(b.labName).toBe("مختبر الأردن");
    expect(b.showWordmark).toBe(false);
  });

  it("@AC-12.4 no name, no logo → wordmark; whitespace/empty name collapses to wordmark", () => {
    expect(resolveSidebarBrand(null, null).showWordmark).toBe(true);
    expect(resolveSidebarBrand("   ", null).showWordmark).toBe(true);
    const b = resolveSidebarBrand("   ", null);
    expect(b.labName).toBeNull();
    // alt falls back to the generic lab label when there is no name
    expect(b.logoAlt).toBe("شعار المختبر");
  });

  it("@AC-12.4 trims a padded name", () => {
    expect(resolveSidebarBrand("  Acme  ", null).labName).toBe("Acme");
  });
});

describe("uploadLogo — replace-in-place (AC-12.3)", () => {
  it("@AC-12.3 uploads under {tenant}/logo.{ext} (upsert), sets logo_path, returns the url", async () => {
    const { admin, calls } = makeAdmin();
    const res = await uploadLogo({
      admin,
      tenantId: "t1",
      file: logoBlob(),
      mimeType: "image/png",
      previousPath: null
    });
    expect(res.logoPath).toBe("t1/logo.png");
    expect(res.url).toBe("https://cdn.example/branding/t1/logo.png");
    expect(calls.upload[0].path).toBe("t1/logo.png");
    expect(calls.upload[0].opts).toMatchObject({ upsert: true, contentType: "image/png" });
    expect(calls.update[0]).toEqual({ table: "tenants", patch: { logo_path: "t1/logo.png" } });
  });

  it("@AC-12.3 removes a prior object only when it lived at a different key", async () => {
    const { admin, calls } = makeAdmin();
    await uploadLogo({
      admin,
      tenantId: "t1",
      file: logoBlob(),
      mimeType: "image/png",
      previousPath: "t1/logo.svg" // format change → orphan unless removed
    });
    expect(calls.remove).toContainEqual(["t1/logo.svg"]);
  });

  it("@AC-12.3 same-key replace does NOT call remove (upsert handles it)", async () => {
    const { admin, calls } = makeAdmin();
    await uploadLogo({
      admin,
      tenantId: "t1",
      file: logoBlob(),
      mimeType: "image/png",
      previousPath: "t1/logo.png"
    });
    expect(calls.remove).toHaveLength(0);
  });

  it("@AC-12.3 rolls back the uploaded object and throws when the DB update fails", async () => {
    const { admin, calls } = makeAdmin({ updateError: { message: "boom" } });
    await expect(
      uploadLogo({ admin, tenantId: "t1", file: logoBlob(), mimeType: "image/png" })
    ).rejects.toThrow(/logo_path update failed/);
    // the just-uploaded key is removed so storage and logo_path never disagree
    expect(calls.remove).toContainEqual(["t1/logo.png"]);
  });

  it("@AC-12.1 @AC-12.3 throws on an unsupported mime (no storage write)", async () => {
    const { admin, calls } = makeAdmin();
    await expect(
      uploadLogo({ admin, tenantId: "t1", file: logoBlob(), mimeType: "application/pdf" })
    ).rejects.toThrow(/unsupported logo mime/);
    expect(calls.upload).toHaveLength(0);
  });
});

describe("removeLogo (AC-12.5)", () => {
  it("@AC-12.5 nulls logo_path first, then deletes the object", async () => {
    const { admin, calls } = makeAdmin();
    await removeLogo(admin, "t1", "t1/logo.png");
    expect(calls.update[0]).toEqual({ table: "tenants", patch: { logo_path: null } });
    expect(calls.remove).toContainEqual(["t1/logo.png"]);
  });
});

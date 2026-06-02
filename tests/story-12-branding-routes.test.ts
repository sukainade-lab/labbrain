import { describe, it, expect, beforeEach, vi } from "vitest";

// S12 — HTTP route-handler integration tests for /api/branding (Lesson L1: test
// the seam, not just the functions behind it). Every branch of POST + DELETE is
// exercised against the real route handlers. The cookie-bound server client, the
// service-role admin client, and the branding service lib are mocked, so these run
// in any environment (no live Supabase needed) — they assert the route's auth +
// admin + validation contract (AC-12.1/12.5/12.8), not storage behaviour (that's
// the live L2 test).

const h = vi.hoisted(() => ({
  state: {
    user: null as { id: string } | null,
    me: null as { tenant_id: string; role: string } | null,
    tenantLogoPath: null as string | null
  },
  uploadLogo: vi.fn(async (_input: { tenantId: string; previousPath: string | null }) => ({
    logoPath: "t/logo.png",
    url: "https://cdn/branding/t/logo.png"
  })),
  removeLogo: vi.fn(async (_admin: unknown, _tenantId: string, _logoPath: string) => undefined)
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: h.state.user } }) },
    from: () => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: h.state.me }) }) })
    })
  })
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ single: async () => ({ data: { logo_path: h.state.tenantLogoPath } }) })
      })
    })
  })
}));

vi.mock("@/lib/branding/logo", () => ({
  uploadLogo: h.uploadLogo,
  removeLogo: h.removeLogo
}));

vi.mock("@/lib/observability/sentry", () => ({ setSentryTenant: vi.fn() }));
vi.mock("@/lib/observability/log", () => ({ captureError: vi.fn() }));

import { POST, DELETE } from "@/app/api/branding/route";

function logoFile(bytes: number, name = "logo.png", type = "image/png") {
  return new File([new Uint8Array(bytes)], name, { type });
}

function postFile(file: File | null) {
  const form = new FormData();
  if (file) form.append("file", file);
  return POST(new Request("http://localhost/api/branding", { method: "POST", body: form }));
}

const admin = { id: "u", tenant_id: "t1", role: "admin" };
const member = { id: "u", tenant_id: "t1", role: "member" };

beforeEach(() => {
  h.state.user = null;
  h.state.me = null;
  h.state.tenantLogoPath = null;
  h.uploadLogo.mockClear();
  h.removeLogo.mockClear();
});

describe("POST /api/branding — logo upload (AC-12.1/12.8, L1)", () => {
  it("@AC-12.8 unauthenticated → 401", async () => {
    const res = await postFile(logoFile(64));
    expect(res.status).toBe(401);
    expect(h.uploadLogo).not.toHaveBeenCalled();
  });

  it("@AC-12.8 a member (non-admin) → 403", async () => {
    h.state.user = { id: member.id };
    h.state.me = { tenant_id: member.tenant_id, role: member.role };
    const res = await postFile(logoFile(64));
    expect(res.status).toBe(403);
    expect(h.uploadLogo).not.toHaveBeenCalled();
  });

  it("@AC-12.1 admin without a file → 400", async () => {
    h.state.user = { id: admin.id };
    h.state.me = { tenant_id: admin.tenant_id, role: admin.role };
    const res = await postFile(null);
    expect(res.status).toBe(400);
  });

  it("@AC-12.1 an unsupported MIME → 400", async () => {
    h.state.user = { id: admin.id };
    h.state.me = { tenant_id: admin.tenant_id, role: admin.role };
    const res = await postFile(logoFile(64, "notes.txt", "text/plain"));
    expect(res.status).toBe(400);
    expect(h.uploadLogo).not.toHaveBeenCalled();
  });

  it("@AC-12.1 a logo over 512KB → 413", async () => {
    h.state.user = { id: admin.id };
    h.state.me = { tenant_id: admin.tenant_id, role: admin.role };
    const res = await postFile(logoFile(512 * 1024 + 1));
    expect(res.status).toBe(413);
    expect(h.uploadLogo).not.toHaveBeenCalled();
  });

  it("@AC-12.1 @AC-12.3 a valid PNG → 201 with the new url; uploadLogo gets previousPath", async () => {
    h.state.user = { id: admin.id };
    h.state.me = { tenant_id: admin.tenant_id, role: admin.role };
    h.state.tenantLogoPath = "t1/logo.svg"; // prior logo to replace
    const res = await postFile(logoFile(2048));
    const data = await res.json();
    expect(res.status).toBe(201);
    expect(data.url).toContain("logo");
    expect(h.uploadLogo).toHaveBeenCalledOnce();
    const arg = h.uploadLogo.mock.calls[0][0] as { tenantId: string; previousPath: string | null };
    expect(arg.tenantId).toBe("t1");
    expect(arg.previousPath).toBe("t1/logo.svg");
  });

  it("@AC-12.1 an SVG the browser mislabels as octet-stream → 201 (extension fallback)", async () => {
    h.state.user = { id: admin.id };
    h.state.me = { tenant_id: admin.tenant_id, role: admin.role };
    const res = await postFile(logoFile(2048, "brand.svg", "application/octet-stream"));
    expect(res.status).toBe(201);
    expect(h.uploadLogo).toHaveBeenCalledOnce();
  });
});

describe("DELETE /api/branding — logo removal (AC-12.5/12.8, L1)", () => {
  it("@AC-12.8 unauthenticated → 401", async () => {
    const res = await DELETE();
    expect(res.status).toBe(401);
    expect(h.removeLogo).not.toHaveBeenCalled();
  });

  it("@AC-12.8 a member (non-admin) → 403", async () => {
    h.state.user = { id: member.id };
    h.state.me = { tenant_id: member.tenant_id, role: member.role };
    const res = await DELETE();
    expect(res.status).toBe(403);
    expect(h.removeLogo).not.toHaveBeenCalled();
  });

  it("@AC-12.5 admin with an existing logo → 200, removeLogo called", async () => {
    h.state.user = { id: admin.id };
    h.state.me = { tenant_id: admin.tenant_id, role: admin.role };
    h.state.tenantLogoPath = "t1/logo.png";
    const res = await DELETE();
    expect(res.status).toBe(200);
    expect(h.removeLogo).toHaveBeenCalledWith(expect.anything(), "t1", "t1/logo.png");
  });

  it("@AC-12.5 admin with no logo → 200, removeLogo not called (no-op)", async () => {
    h.state.user = { id: admin.id };
    h.state.me = { tenant_id: admin.tenant_id, role: admin.role };
    h.state.tenantLogoPath = null;
    const res = await DELETE();
    expect(res.status).toBe(200);
    expect(h.removeLogo).not.toHaveBeenCalled();
  });
});

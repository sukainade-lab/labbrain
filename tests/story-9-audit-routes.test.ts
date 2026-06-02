import { describe, it, expect, beforeEach, vi } from "vitest";
import { buildAuditFilename, labSlug } from "@/lib/audit/filename";

// Story 9 — HTTP route-handler integration tests (Lesson L1: test the seam).
// GET /api/audit/export. The cookie-bound server client is mocked to supply the
// authenticated user + tenant/role lookup; getAuditLog and the Chromium render
// seam are mocked (CI never needs a DB or a browser). The live query is covered
// in story-9-audit.test.ts; the report HTML + render seam in their own units.

const h = vi.hoisted(() => ({
  state: {
    user: null as { id: string } | null,
    me: null as { tenant_id: string; role: string; email: string } | null,
    tenant: null as { name: string } | null,
    insert: vi.fn(async (_row: Record<string, unknown>) => ({ error: null }))
  }
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: h.state.user } }) },
    from: (table: string) => {
      if (table === "users") {
        return {
          select: () => ({ eq: () => ({ single: async () => ({ data: h.state.me }) }) })
        };
      }
      if (table === "tenants") {
        return {
          select: () => ({ eq: () => ({ single: async () => ({ data: h.state.tenant }) }) })
        };
      }
      if (table === "audit_exports") {
        return { insert: h.state.insert };
      }
      return {};
    }
  })
}));

vi.mock("@/lib/audit/export-query", () => ({ getAuditLog: vi.fn() }));

// PDF render seam mocked → a tiny valid "%PDF-" body. The real Chromium render
// is verified only in the manual walk.
vi.mock("@/lib/audit/render-pdf", () => ({
  renderPdfFromHtml: vi.fn(async () => new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]))
}));

import { GET } from "@/app/api/audit/export/route";
import { getAuditLog } from "@/lib/audit/export-query";
import { renderPdfFromHtml } from "@/lib/audit/render-pdf";

function entry(over = {}) {
  return {
    id: "q1",
    question_text: "سؤال",
    answer_text: "جواب",
    question_lang: "ar",
    found_answer: true,
    citations: [],
    asker_email: "eng@lab.jo",
    created_at: "2026-02-15T10:30:00Z",
    ...over
  };
}

function getExport(query = "") {
  return GET(new Request(`http://localhost/api/audit/export${query}`));
}

describe("Story 9 — /api/audit/export route handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.state.user = null;
    h.state.me = null;
    h.state.tenant = null;
    h.state.insert = vi.fn(async (_row: Record<string, unknown>) => ({ error: null }));
  });

  it("@AC-9.1 unauthenticated → 401, never queries the log", async () => {
    h.state.user = null;
    const res = await getExport();
    expect(res.status).toBe(401);
    expect(getAuditLog).not.toHaveBeenCalled();
  });

  it("@AC-9.1 authenticated but no tenant row → 401", async () => {
    h.state.user = { id: "u" };
    h.state.me = null;
    const res = await getExport();
    expect(res.status).toBe(401);
    expect(getAuditLog).not.toHaveBeenCalled();
  });

  it("@AC-9.1 a member (not owner/admin) → 403", async () => {
    h.state.user = { id: "u" };
    h.state.me = { tenant_id: "t1", role: "member", email: "m@lab.jo" };
    h.state.tenant = { name: "Lab Amman" };
    const res = await getExport();
    expect(res.status).toBe(403);
    expect(getAuditLog).not.toHaveBeenCalled();
  });

  it("@AC-9.3 a reversed date range → 400", async () => {
    h.state.user = { id: "u" };
    h.state.me = { tenant_id: "t1", role: "owner", email: "o@lab.jo" };
    h.state.tenant = { name: "Lab Amman" };
    const res = await getExport("?from=2026-03-01&to=2026-01-01");
    expect(res.status).toBe(400);
    expect(getAuditLog).not.toHaveBeenCalled();
  });

  it("@AC-9.1 @AC-9.5 @AC-9.6 owner → 200 PDF with attachment headers, export logged", async () => {
    h.state.user = { id: "u1" };
    h.state.me = { tenant_id: "t1", role: "owner", email: "owner@lab.jo" };
    h.state.tenant = { name: "Lab Amman" };
    vi.mocked(getAuditLog).mockResolvedValueOnce([entry(), entry({ id: "q2" })]);

    const res = await getExport("?from=2026-01-01&to=2026-03-31");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    const disp = res.headers.get("content-disposition") ?? "";
    expect(disp).toContain("attachment");
    expect(disp).toMatch(/labbrain-audit-lab-amman-\d{8}\.pdf/);

    const body = new Uint8Array(await res.arrayBuffer());
    expect(String.fromCharCode(...body.slice(0, 5))).toBe("%PDF-");

    expect(getAuditLog).toHaveBeenCalledTimes(1);
    expect(vi.mocked(getAuditLog).mock.calls[0][1]).toEqual({
      from: "2026-01-01",
      to: "2026-03-31"
    });
    expect(renderPdfFromHtml).toHaveBeenCalledTimes(1);
    // AC-9.6 — the export is recorded with the range + row count.
    expect(h.state.insert).toHaveBeenCalledTimes(1);
    expect(h.state.insert.mock.calls[0][0]).toMatchObject({
      tenant_id: "t1",
      user_id: "u1",
      range_from: "2026-01-01",
      range_to: "2026-03-31",
      row_count: 2
    });
  });

  it("@AC-9.1 an admin is also allowed → 200", async () => {
    h.state.user = { id: "u2" };
    h.state.me = { tenant_id: "t1", role: "admin", email: "admin@lab.jo" };
    h.state.tenant = { name: "Lab Amman" };
    vi.mocked(getAuditLog).mockResolvedValueOnce([entry()]);
    const res = await getExport();
    expect(res.status).toBe(200);
  });

  it("@AC-9.4 @AC-9.6 an empty log → still a 200 PDF (not an error), logged with row_count 0", async () => {
    h.state.user = { id: "u1" };
    h.state.me = { tenant_id: "t1", role: "owner", email: "owner@lab.jo" };
    h.state.tenant = { name: "Lab Amman" };
    vi.mocked(getAuditLog).mockResolvedValueOnce([]);

    const res = await getExport();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(renderPdfFromHtml).toHaveBeenCalledTimes(1);
    expect(h.state.insert.mock.calls[0][0]).toMatchObject({ row_count: 0 });
  });
});

describe("Story 9 — filename helper (@AC-9.5)", () => {
  it("slugifies an ASCII lab name", () => {
    expect(labSlug("Lab Amman", "abcd1234-...")).toBe("lab-amman");
  });

  it("falls back to a tenant-id slice for an Arabic-only name", () => {
    expect(labSlug("مختبر عمّان", "abcd1234-ef56-7890")).toBe("lab-abcd1234");
  });

  it("builds the full filename with a YYYYMMDD stamp", () => {
    const name = buildAuditFilename("Lab Amman", "t1", new Date("2026-06-02T09:00:00Z"));
    expect(name).toBe("labbrain-audit-lab-amman-20260602.pdf");
  });
});

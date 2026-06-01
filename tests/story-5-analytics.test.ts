import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  signupCompleted,
  documentUploaded,
  questionAsked,
  invoiceRequested
} from "@/lib/analytics/events";

// Story 5 — AC-5.5. Two layers:
//  1. The event builders are the single no-PII surface — assert each payload
//     carries only typed, non-identifying fields (no email/name/lab/filename/
//     question text).
//  2. Each of the 4 real route handlers actually fires its builder through
//     track() (Lesson L4: confirmed from the user-reachable handler, not just
//     the builder in isolation). track() is mocked so no HTTP call is made.

// ── Layer 1: builders are PII-free ──────────────────────────────────────────

describe("@AC-5.5 analytics event builders (no PII)", () => {
  it("signup_completed carries only the user distinct_id, no properties", () => {
    const evt = signupCompleted("user-123");
    expect(evt.event).toBe("signup_completed");
    expect(evt.distinctId).toBe("user-123");
    expect(evt.properties).toEqual({});
  });

  it("document_uploaded carries mime_type only — never the filename", () => {
    const evt = documentUploaded("user-123", { mimeType: "application/pdf" });
    expect(evt.event).toBe("document_uploaded");
    expect(evt.distinctId).toBe("user-123");
    expect(evt.properties).toEqual({ mime_type: "application/pdf" });
    expect(JSON.stringify(evt.properties)).not.toMatch(/\.pdf|filename|name/i);
  });

  it("question_asked carries found_answer + lang only — never the question text", () => {
    const evt = questionAsked("user-123", { foundAnswer: true, lang: "ar" });
    expect(evt.event).toBe("question_asked");
    expect(evt.distinctId).toBe("user-123");
    expect(evt.properties).toEqual({ found_answer: true, lang: "ar" });
  });

  it("invoice_requested is anonymous with no buyer PII", () => {
    const evt = invoiceRequested();
    expect(evt.event).toBe("invoice_requested");
    expect(evt.distinctId).toBe("anonymous");
    expect(evt.properties).toEqual({});
  });
});

// ── Layer 2: each real handler fires its builder through track() ─────────────

const h = vi.hoisted(() => ({
  state: {
    user: null as { id: string } | null,
    me: null as { tenant_id: string } | null
  },
  afterTasks: [] as Array<() => unknown | Promise<unknown>>
}));

vi.mock("@/lib/analytics/posthog-server", () => ({ track: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: h.state.user } }) },
    from: () => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: h.state.me }) }) })
    })
  })
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));

vi.mock("next/server", async (importActual) => {
  const actual = await importActual<typeof import("next/server")>();
  return { ...actual, after: (cb: () => unknown) => h.afterTasks.push(cb) };
});

vi.mock("@/lib/auth/provision", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/auth/provision")>();
  return {
    ...actual,
    provisionSignup: vi.fn(async () => ({ userId: "u1", tenantId: "t1", role: "owner" }))
  };
});
vi.mock("@/lib/email/resend", () => ({ sendInvoiceRequestEmail: vi.fn(async () => {}) }));
vi.mock("@/lib/qa/ask", () => ({
  ask: vi.fn(async () => ({
    answer: "...",
    citations: [],
    found: true,
    lang: "ar",
    emptyCorpus: false
  }))
}));
vi.mock("@/lib/documents/ingest", () => ({
  createDocument: vi.fn(async () => ({ documentId: "d1", status: "parsing" })),
  processDocument: vi.fn(async () => {})
}));

import { track } from "@/lib/analytics/posthog-server";
import { POST as signupPOST } from "@/app/api/auth/signup/route";
import { POST as invoicePOST } from "@/app/api/invoice-request/route";
import { POST as documentsPOST } from "@/app/api/documents/route";
import { POST as qaPOST } from "@/app/api/qa/route";

function jsonReq(url: string, body: unknown) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

describe("@AC-5.5 route handlers fire analytics through track()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.state.user = null;
    h.state.me = null;
    h.afterTasks = [];
  });

  it("signup → signup_completed with the new user id", async () => {
    const res = await signupPOST(
      jsonReq("http://localhost/api/auth/signup", {
        labName: "Lab Amman",
        adminName: "Founder Name",
        email: "founder@lab.jo",
        password: "password123"
      })
    );
    expect(res.status).toBe(201);
    expect(track).toHaveBeenCalledTimes(1);
    expect(vi.mocked(track).mock.calls[0][0]).toEqual(signupCompleted("u1"));
  });

  it("invoice-request → invoice_requested (anonymous)", async () => {
    const res = await invoicePOST(
      jsonReq("http://localhost/api/invoice-request", {
        companyName: "Lab Amman",
        contactName: "Founder Name",
        contactEmail: "founder@lab.jo",
        plan: "pro",
        interval: "year",
        billingAddress: "Amman, Jordan"
      })
    );
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(track).toHaveBeenCalledTimes(1);
    expect(vi.mocked(track).mock.calls[0][0]).toEqual(invoiceRequested());
  });

  it("documents → document_uploaded with mime_type only", async () => {
    h.state.user = { id: "uploader-1" };
    h.state.me = { tenant_id: "t1" };
    const form = new FormData();
    form.append("file", new File([new Uint8Array(2048)], "secret-client.pdf", { type: "application/pdf" }));
    const res = await documentsPOST(
      new Request("http://localhost/api/documents", { method: "POST", body: form })
    );
    expect(res.status).toBe(201);
    expect(track).toHaveBeenCalledTimes(1);
    expect(vi.mocked(track).mock.calls[0][0]).toEqual(
      documentUploaded("uploader-1", { mimeType: "application/pdf" })
    );
  });

  it("qa → question_asked with found_answer + lang", async () => {
    h.state.user = { id: "asker-1" };
    h.state.me = { tenant_id: "t1" };
    const res = await qaPOST(
      jsonReq("http://localhost/api/qa", { question: "ما هو نطاق الاعتماد؟" })
    );
    expect(res.status).toBe(200);
    expect(track).toHaveBeenCalledTimes(1);
    expect(vi.mocked(track).mock.calls[0][0]).toEqual(
      questionAsked("asker-1", { foundAnswer: true, lang: "ar" })
    );
  });
});

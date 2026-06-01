import { describe, it, expect, beforeEach, vi } from "vitest";

// Story 3 — HTTP route-handler integration tests (Lesson L1: test the seam, not
// just the functions behind it). These POST to the actual /api/qa handler.
//
// The cookie-bound server client (@/lib/supabase/server) is mocked to supply the
// authenticated user + tenant lookup. The orchestrator (@/lib/qa/ask) is mocked —
// its live behaviour (real RPC + audit insert) is covered in tests/story-3-qa.test.ts.
// This file pins the HTTP contract: auth gate, input validation, success shapes,
// and the 500 fallback.

const h = vi.hoisted(() => ({
  state: {
    user: null as { id: string } | null,
    me: null as { tenant_id: string } | null
  }
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: h.state.user } }) },
    from: () => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: h.state.me }) }) })
    })
  })
}));

vi.mock("@/lib/qa/ask", () => ({ ask: vi.fn() }));

vi.mock("next/server", async (importActual) => {
  const actual = await importActual<typeof import("next/server")>();
  return { ...actual };
});

import { POST as qaPOST } from "@/app/api/qa/route";
import { ask } from "@/lib/qa/ask";

function postQuestion(body: unknown) {
  return qaPOST(
    new Request("http://localhost/api/qa", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body)
    })
  );
}

describe("Story 3 — /api/qa route handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.state.user = null;
    h.state.me = null;
  });

  it("@AC-3.1 POST unauthenticated → 401, never calls ask", async () => {
    h.state.user = null;
    const res = await postQuestion({ question: "ما هي فترة المعايرة؟" });
    expect(res.status).toBe(401);
    expect(ask).not.toHaveBeenCalled();
  });

  it("@AC-3.1 POST with an empty question → 400", async () => {
    h.state.user = { id: "u" };
    h.state.me = { tenant_id: "t1" };
    const res = await postQuestion({ question: "   " });
    expect(res.status).toBe(400);
    expect(ask).not.toHaveBeenCalled();
  });

  it("@AC-3.1 POST with no body → 400", async () => {
    h.state.user = { id: "u" };
    h.state.me = { tenant_id: "t1" };
    const res = await postQuestion(undefined);
    expect(res.status).toBe(400);
  });

  it("@AC-3.1 authenticated user with no tenant row → 401", async () => {
    h.state.user = { id: "u" };
    h.state.me = null;
    const res = await postQuestion({ question: "calibration interval?" });
    expect(res.status).toBe(401);
    expect(ask).not.toHaveBeenCalled();
  });

  it("@AC-3.2 @AC-3.4 grounded question → 200 with answer + citations", async () => {
    h.state.user = { id: "u1" };
    h.state.me = { tenant_id: "t1" };
    vi.mocked(ask).mockResolvedValueOnce({
      answer: "تُعاير كتل الفئة E2 كل 12 شهراً.",
      citations: [
        { document_id: "d1", document_name: "SOP.pdf", section: "5.3", page_number: 11, similarity: 0.93 }
      ],
      found: true,
      lang: "ar"
    });

    const res = await postQuestion({ question: "ما فترة معايرة كتل الفئة E2؟" });
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.found).toBe(true);
    expect(data.citations).toHaveLength(1);
    expect(data.citations[0].page_number).toBe(11);
    // The handler must hand the parsed question + tenant + user to the orchestrator.
    expect(ask).toHaveBeenCalledTimes(1);
    expect(vi.mocked(ask).mock.calls[0][0]).toMatchObject({
      tenantId: "t1",
      userId: "u1",
      question: "ما فترة معايرة كتل الفئة E2؟"
    });
  });

  it("@AC-3.5 ungrounded question → 200, found=false, no citations", async () => {
    h.state.user = { id: "u1" };
    h.state.me = { tenant_id: "t1" };
    vi.mocked(ask).mockResolvedValueOnce({
      answer: "لم أجد إجابة لهذا السؤال في وثائقكم.",
      citations: [],
      found: false,
      lang: "ar"
    });

    const res = await postQuestion({ question: "سؤال لا توجد له وثيقة" });
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.found).toBe(false);
    expect(data.citations).toEqual([]);
  });

  it("@AC-3.7 an orchestrator failure surfaces as 500 (not a partial answer)", async () => {
    h.state.user = { id: "u1" };
    h.state.me = { tenant_id: "t1" };
    vi.mocked(ask).mockRejectedValueOnce(new Error("failed to log query"));
    const res = await postQuestion({ question: "calibration interval?" });
    expect(res.status).toBe(500);
  });
});

import { describe, it, expect, beforeEach, vi } from "vitest";

// Story 4 — invoice-request HTTP seam (AC-4.2 fallback, Lesson L1).
// sendInvoiceRequestEmail is mocked so no real Resend call is made; the test
// pins validation + the success/failure contract.

vi.mock("@/lib/email/resend", () => ({
  sendInvoiceRequestEmail: vi.fn()
}));

import { POST as invoicePOST } from "@/app/api/invoice-request/route";
import { sendInvoiceRequestEmail } from "@/lib/email/resend";

function postInvoice(body: unknown) {
  return invoicePOST(
    new Request("http://localhost/api/invoice-request", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body)
    })
  );
}

const valid = {
  companyName: "مختبر الأردن للمعايرة",
  contactName: "سكينة",
  contactEmail: "s@lab.jo",
  plan: "pro",
  interval: "year",
  billingAddress: "عمّان، شارع المدينة المنورة، مبنى ١٢",
  vatNumber: "JO-998877"
};

describe("Story 4 — /api/invoice-request route handler", () => {
  beforeEach(() => vi.clearAllMocks());

  it("@AC-4.2 valid request → 200 and emails the founder with the details", async () => {
    vi.mocked(sendInvoiceRequestEmail).mockResolvedValueOnce({} as never);
    const res = await postInvoice(valid);
    expect(res.status).toBe(200);
    expect(sendInvoiceRequestEmail).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendInvoiceRequestEmail).mock.calls[0][0]).toMatchObject({
      companyName: valid.companyName,
      plan: "pro",
      interval: "year",
      vatNumber: "JO-998877"
    });
  });

  it("@AC-4.2 VAT number is optional → 200 without it", async () => {
    vi.mocked(sendInvoiceRequestEmail).mockResolvedValueOnce({} as never);
    const { vatNumber: _omit, ...noVat } = valid;
    void _omit;
    const res = await postInvoice(noVat);
    expect(res.status).toBe(200);
  });

  it("@AC-4.2 missing billing address → 400, no email sent", async () => {
    const { billingAddress: _omit, ...bad } = valid;
    void _omit;
    const res = await postInvoice(bad);
    expect(res.status).toBe(400);
    expect(sendInvoiceRequestEmail).not.toHaveBeenCalled();
  });

  it("@AC-4.2 invalid email → 400", async () => {
    const res = await postInvoice({ ...valid, contactEmail: "not-an-email" });
    expect(res.status).toBe(400);
  });

  it("@AC-4.2 a delivery failure surfaces as 500", async () => {
    vi.mocked(sendInvoiceRequestEmail).mockRejectedValueOnce(new Error("resend down"));
    const res = await postInvoice(valid);
    expect(res.status).toBe(500);
  });
});

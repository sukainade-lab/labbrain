import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { sendSms, otpSmsBody, sendOtpSms } from "@/lib/sms/unifonic";

// S7 AC-7.2 — Unifonic SMS sender on native fetch (no SDK), fails closed.
// The HTTP seam is mocked: we assert the request shape Unifonic's verified contract
// expects (AppSid + SenderID + Body + Recipient, international form without +) and
// that a non-success response throws rather than silently dropping the OTP.

const ORIGINAL_ENV = { ...process.env };

function mockFetchOnce(impl: () => Response | Promise<Response>) {
  // Typed with fetch's parameter shape so mock.calls entries are [input, init?].
  const fn = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) => impl());
  vi.stubGlobal("fetch", fn);
  return fn;
}

beforeEach(() => {
  process.env.UNIFONIC_API_KEY = "test-app-sid";
  process.env.UNIFONIC_SENDER_ID = "LabBrain";
});

afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...ORIGINAL_ENV };
});

describe("otpSmsBody", () => {
  it("@AC-7.2 builds an Arabic body containing the code", () => {
    const body = otpSmsBody("123456");
    expect(body).toContain("123456");
    expect(body).toContain("LabBrain");
    // Arabic content present (verification-code phrasing).
    expect(body).toMatch(/[؀-ۿ]/);
  });
});

describe("sendSms", () => {
  it("@AC-7.2 POSTs AppSid + SenderID + Body + Recipient to Unifonic and returns the MessageID", async () => {
    const fetchMock = mockFetchOnce(
      () =>
        new Response(JSON.stringify({ success: true, data: { MessageID: "MSG-1" } }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
    );

    const res = await sendSms({ recipient: "962791234567", body: "hi" });
    expect(res.messageId).toBe("MSG-1");

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/rest/SMS/messages");
    expect(init!.method).toBe("POST");
    const sent = String(init!.body);
    expect(sent).toContain("AppSid=test-app-sid");
    expect(sent).toContain("SenderID=LabBrain");
    expect(sent).toContain("Recipient=962791234567");
    expect(sent).toContain("responseType=JSON");
  });

  it("@AC-7.2 throws on a non-2xx response (fails closed)", async () => {
    mockFetchOnce(
      () =>
        new Response(JSON.stringify({ success: false, errorCode: "ER-01", message: "bad" }), {
          status: 401
        })
    );
    await expect(sendSms({ recipient: "962791234567", body: "hi" })).rejects.toThrow();
  });

  it("@AC-7.2 throws when the provider reports success:false on a 200", async () => {
    mockFetchOnce(
      () =>
        new Response(JSON.stringify({ success: false, errorCode: "480", message: "bad sender" }), {
          status: 200
        })
    );
    await expect(sendSms({ recipient: "962791234567", body: "hi" })).rejects.toThrow();
  });

  it("@AC-7.2 throws when UNIFONIC_API_KEY is missing (fails closed, no silent skip)", async () => {
    delete process.env.UNIFONIC_API_KEY;
    mockFetchOnce(() => new Response("{}", { status: 200 }));
    await expect(sendSms({ recipient: "962791234567", body: "hi" })).rejects.toThrow(
      /UNIFONIC/
    );
  });
});

describe("sendOtpSms", () => {
  it("@AC-7.2 sends the Arabic OTP body to the recipient", async () => {
    const fetchMock = mockFetchOnce(
      () =>
        new Response(JSON.stringify({ success: true, MessageID: "MSG-9" }), { status: 200 })
    );
    const res = await sendOtpSms("962791234567", "654321");
    expect(res.messageId).toBe("MSG-9");
    const sent = String(fetchMock.mock.calls[0][1]!.body);
    expect(decodeURIComponent(sent)).toContain("654321");
  });
});

import { describe, it, expect, beforeEach, vi } from "vitest";

// Story 4 — welcome email content (AC-4.4). Mocks the Resend SDK at the package
// boundary so we exercise the REAL sendWelcomeEmail HTML builder and assert the
// required content: lab name, admin name, the 3 onboarding steps, and the demo
// link. No network call is made.

const send = vi.fn().mockResolvedValue({ id: "email_test" });
vi.mock("resend", () => ({
  Resend: vi.fn().mockImplementation(() => ({ emails: { send } }))
}));

import { sendWelcomeEmail } from "@/lib/email/resend";

describe("Story 4 — welcome email (AC-4.4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.RESEND_API_KEY = "re_test";
    process.env.DEMO_VIDEO_URL = "https://labbrain.app/demo-video";
  });

  it("@AC-4.4 includes lab name, admin name, 3 onboarding steps, and the demo link", async () => {
    await sendWelcomeEmail("owner@lab.jo", {
      labName: "مختبر الأردن للمعايرة",
      adminName: "سكينة"
    });

    expect(send).toHaveBeenCalledTimes(1);
    const payload = send.mock.calls[0][0] as { to: string; subject: string; html: string };
    expect(payload.to).toBe("owner@lab.jo");

    // Identity
    expect(payload.subject).toContain("مختبر الأردن للمعايرة");
    expect(payload.html).toContain("مختبر الأردن للمعايرة"); // lab name
    expect(payload.html).toContain("سكينة"); // admin name

    // The 3 onboarding steps (upload first doc, ask first question, invite team)
    expect(payload.html).toMatch(/ارفع أول وثيقة/);
    expect(payload.html).toMatch(/اسأل أول سؤال/);
    expect(payload.html).toMatch(/ادعُ فريق/);

    // Demo video link
    expect(payload.html).toContain("https://labbrain.app/demo-video");

    // RTL email
    expect(payload.html).toContain('dir="rtl"');
  });

  it("@AC-4.4 falls back to APP_URL/demo when DEMO_VIDEO_URL is unset", async () => {
    delete process.env.DEMO_VIDEO_URL;
    process.env.APP_URL = "https://app.labbrain.test";

    await sendWelcomeEmail("owner@lab.jo", { labName: "Lab", adminName: "Sukaina" });

    const payload = send.mock.calls[0][0] as { html: string };
    expect(payload.html).toContain("https://app.labbrain.test/demo");
  });
});

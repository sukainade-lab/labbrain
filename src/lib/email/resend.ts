import { Resend } from "resend";

const apiKey = process.env.RESEND_API_KEY;
export const resend = new Resend(apiKey ?? "");

const FROM = process.env.EMAIL_FROM ?? "LabBrain <no-reply@labbrain.app>";

// Activation email sent after a successful Stripe checkout (AC-4.3 follow-up).
export async function sendActivationEmail(to: string, tenantName: string) {
  return resend.emails.send({
    from: FROM,
    to,
    subject: "تم تفعيل حسابك في LabBrain",
    html: `<div dir="rtl" style="font-family:sans-serif">
      <h2>أهلاً ${tenantName}</h2>
      <p>تم تفعيل اشتراكك بنجاح. يمكنك الآن رفع وثائقك وبدء الاستعلام.</p>
    </div>`
  });
}

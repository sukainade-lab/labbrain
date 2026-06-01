import { Resend } from "resend";

// Lazy client: Resend's constructor throws on an empty key, which would crash at
// module-load during `next build` page-data collection (no real key in CI). Defer
// construction until an email is actually sent.
let client: Resend | null = null;
function getResend(): Resend {
  if (!client) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) throw new Error("RESEND_API_KEY is not set — cannot send email");
    client = new Resend(apiKey);
  }
  return client;
}

const FROM = process.env.RESEND_FROM_EMAIL ?? "LabBrain <no-reply@labbrain.app>";

// Activation email sent after a successful Stripe checkout (AC-4.3 follow-up).
export async function sendActivationEmail(to: string, tenantName: string) {
  return getResend().emails.send({
    from: FROM,
    to,
    subject: "تم تفعيل حسابك في LabBrain",
    html: `<div dir="rtl" style="font-family:sans-serif">
      <h2>أهلاً ${tenantName}</h2>
      <p>تم تفعيل اشتراكك بنجاح. يمكنك الآن رفع وثائقك وبدء الاستعلام.</p>
    </div>`
  });
}

// Team invitation email (AC-1.4). Link carries the pre-filled signup token.
export async function sendInvitationEmail(to: string, tenantName: string, inviteUrl: string) {
  return getResend().emails.send({
    from: FROM,
    to,
    subject: `دعوة للانضمام إلى ${tenantName} على LabBrain`,
    html: `<div dir="rtl" style="font-family:sans-serif">
      <h2>تمت دعوتك للانضمام إلى ${tenantName}</h2>
      <p>اضغط الرابط لإنشاء حسابك والانضمام إلى فريق المختبر:</p>
      <p><a href="${inviteUrl}">${inviteUrl}</a></p>
      <p style="color:#64748b;font-size:12px">إذا لم تكن تتوقع هذه الدعوة، تجاهل هذا البريد.</p>
    </div>`
  });
}

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

// Bank-transfer / invoice request (AC-4.2 fallback). JOD merchants buy by
// official invoice + bank transfer; this routes the request to the founder/sales
// inbox so they can issue the invoice and manually activate (AC-4.3).
export async function sendInvoiceRequestEmail(req: {
  companyName: string;
  contactName: string;
  contactEmail: string;
  plan: string;
  interval: string;
  billingAddress: string;
  vatNumber?: string;
}) {
  const to = process.env.INVOICE_REQUEST_TO;
  if (!to) throw new Error("INVOICE_REQUEST_TO is not set — cannot route invoice request");
  return getResend().emails.send({
    from: FROM,
    to,
    replyTo: req.contactEmail,
    subject: `طلب فاتورة جديد — ${req.companyName} (${req.plan}/${req.interval})`,
    html: `<div dir="rtl" style="font-family:sans-serif">
      <h2>طلب فاتورة / تحويل بنكي</h2>
      <ul>
        <li><b>المختبر:</b> ${req.companyName}</li>
        <li><b>المسؤول:</b> ${req.contactName} — ${req.contactEmail}</li>
        <li><b>الباقة:</b> ${req.plan} / ${req.interval}</li>
        <li><b>عنوان الفوترة:</b> ${req.billingAddress}</li>
        ${req.vatNumber ? `<li><b>الرقم الضريبي:</b> ${req.vatNumber}</li>` : ""}
      </ul>
    </div>`
  });
}

// Welcome email (AC-4.4). Sent automatically on every new account creation,
// regardless of plan. Carries the lab name, the admin's name, the three first
// onboarding steps, and a link to the demo video. Best-effort: a send failure
// must never block account provisioning (the caller swallows errors).
export async function sendWelcomeEmail(to: string, opts: { labName: string; adminName: string }) {
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const demoUrl = process.env.DEMO_VIDEO_URL ?? `${appUrl}/demo`;
  return getResend().emails.send({
    from: FROM,
    to,
    subject: `أهلاً بك في LabBrain — ${opts.labName}`,
    html: `<div dir="rtl" style="font-family:sans-serif">
      <h2>أهلاً ${opts.adminName} 👋</h2>
      <p>تم إنشاء حساب مختبر <b>${opts.labName}</b> على LabBrain. إليك أول ثلاث خطوات للبدء:</p>
      <ol>
        <li>ارفع أول وثيقة (إجراء أو دليل جودة).</li>
        <li>اسأل أول سؤال واحصل على إجابة موثّقة بالمصدر والصفحة.</li>
        <li>ادعُ فريق المختبر للانضمام.</li>
      </ol>
      <p>شاهد العرض التوضيحي السريع: <a href="${demoUrl}">${demoUrl}</a></p>
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

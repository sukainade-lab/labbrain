// Unifonic SMS sender on native fetch + node crypto — no SDK (bundle discipline,
// matches the Tap/Stripe seam pattern). Fails closed: a missing key, a non-2xx, or a
// provider `success:false` all throw, so an OTP is never silently dropped (S7 AC-7.2).
//
// Verified contract (Unifonic Messaging API):
//   POST https://el.cloud.unifonic.com/rest/SMS/messages
//   form-encoded params: AppSid (credential), SenderID, Body, Recipient
//   Recipient = international form WITHOUT '+' (e.g. 9627XXXXXXXX), responseType=JSON
//   JSON response: { success, MessageID|data.MessageID, errorCode, message }
//   error codes: 401 auth, 449 empty body, 480 invalid SenderID, 482 invalid destination

const UNIFONIC_SMS_URL = "https://el.cloud.unifonic.com/rest/SMS/messages";

function unifonicAppSid(): string {
  const key = process.env.UNIFONIC_API_KEY;
  if (!key) throw new Error("UNIFONIC_API_KEY is not set — cannot send SMS.");
  return key;
}

function unifonicSenderId(): string {
  const id = process.env.UNIFONIC_SENDER_ID;
  if (!id) throw new Error("UNIFONIC_SENDER_ID is not set — cannot send SMS.");
  return id;
}

type UnifonicResponse = {
  success?: boolean;
  MessageID?: string;
  data?: { MessageID?: string };
  errorCode?: string;
  message?: string;
};

/** Low-level send. Throws on any failure so callers can't proceed on a dropped SMS. */
export async function sendSms(opts: {
  recipient: string;
  body: string;
}): Promise<{ messageId: string | null }> {
  const params = new URLSearchParams({
    AppSid: unifonicAppSid(),
    SenderID: unifonicSenderId(),
    Recipient: opts.recipient,
    Body: opts.body,
    responseType: "JSON"
  });

  const res = await fetch(UNIFONIC_SMS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString()
  });

  const data = (await res.json().catch(() => null)) as UnifonicResponse | null;
  if (!res.ok || !data || data.success === false) {
    const code = data?.errorCode ?? res.status;
    const msg = data?.message ?? "unknown error";
    throw new Error(`Unifonic SMS failed (${code}): ${msg}`);
  }

  return { messageId: data.MessageID ?? data.data?.MessageID ?? null };
}

/** Arabic (Jordanian) OTP message body. Kept here so AC-7.2 phrasing is one place. */
export function otpSmsBody(code: string): string {
  return `رمز التحقق الخاص بك في LabBrain هو: ${code}\nصالح لمدة 5 دقائق. لا تشاركه مع أي أحد.`;
}

/** Send an OTP to a recipient (international form without +). */
export function sendOtpSms(recipient: string, code: string): Promise<{ messageId: string | null }> {
  return sendSms({ recipient, body: otpSmsBody(code) });
}

import { NextResponse } from "next/server";
import { invoiceRequestSchema } from "@/lib/validation/billing";
import { sendInvoiceRequestEmail } from "@/lib/email/resend";

// AC-4.2 fallback — JOD merchants buy by official invoice + bank transfer. This
// public endpoint routes the request to the founder/sales inbox (relationship-
// gated activation happens manually in admin, AC-4.3). No auth: the buyer may
// not have an account yet.
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = invoiceRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" },
      { status: 400 }
    );
  }

  try {
    await sendInvoiceRequestEmail(parsed.data);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "تعذّر إرسال الطلب" }, { status: 500 });
  }
}

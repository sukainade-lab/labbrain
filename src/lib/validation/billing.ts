import { z } from "zod";

// AC-4.2 fallback — bank-transfer / invoice request from a relationship buyer.
// VAT (الرقم الضريبي) is optional; everything else is required to issue a JOD
// invoice.
export const invoiceRequestSchema = z.object({
  companyName: z.string().trim().min(2, "اسم المختبر مطلوب"),
  contactName: z.string().trim().min(2, "اسم المسؤول مطلوب"),
  contactEmail: z.string().trim().email("البريد الإلكتروني غير صالح"),
  plan: z.enum(["starter", "pro"]),
  interval: z.enum(["month", "year"]).default("month"),
  billingAddress: z.string().trim().min(5, "عنوان الفوترة مطلوب"),
  vatNumber: z.string().trim().optional()
});
export type InvoiceRequestInput = z.infer<typeof invoiceRequestSchema>;

import { z } from "zod";

// Seat limits per plan tier (AC-1.6). Matches UX reference + tenants.plan check.
export const PLAN_SEAT_LIMITS = { starter: 5, pro: 20 } as const;
export type PlanTier = keyof typeof PLAN_SEAT_LIMITS;

export const signupSchema = z
  .object({
    // Optional at the field level: invited users join an existing tenant and
    // never supply a lab name (the field is hidden in the invite UI). The refine
    // below makes it required only for the new-lab (non-invite) path.
    labName: z.string().trim().optional(),
    adminName: z.string().trim().min(2, "الاسم الكامل مطلوب"),
    email: z.string().trim().email("البريد الإلكتروني غير صالح"),
    password: z.string().min(8, "كلمة المرور 8 أحرف على الأقل"),
    inviteToken: z.string().trim().min(1).optional()
  })
  .superRefine((val, ctx) => {
    if (!val.inviteToken && (val.labName ?? "").length < 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["labName"],
        message: "اسم المختبر مطلوب"
      });
    }
  });
export type SignupInput = z.infer<typeof signupSchema>;

export const loginSchema = z.object({
  email: z.string().trim().email("البريد الإلكتروني غير صالح"),
  password: z.string().min(1, "كلمة المرور مطلوبة")
});

export const forgotSchema = z.object({
  email: z.string().trim().email("البريد الإلكتروني غير صالح")
});

export const inviteSchema = z.object({
  email: z.string().trim().email("البريد الإلكتروني غير صالح"),
  role: z.enum(["admin", "member"]).default("member")
});

// ── S7 SMS 2FA ────────────────────────────────────────────────────────────────
// The raw phone is validated/normalized by lib/auth/phone.ts (Jordan-specific), so
// here we only require a non-empty string and let the route return the localized
// "invalid number" message on a normalize miss.
export const enrollSchema = z.object({
  phone: z.string().trim().min(1, "رقم الهاتف مطلوب")
});

export const otpVerifySchema = z.object({
  code: z.string().trim().regex(/^\d{6}$/, "الرمز يتكوّن من 6 أرقام"),
  purpose: z.enum(["login", "enroll", "disable"])
});

export const otpSendSchema = z.object({
  purpose: z.enum(["login", "enroll", "disable"]).default("login")
});

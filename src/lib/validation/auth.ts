import { z } from "zod";

// Seat limits per plan tier (AC-1.6). Matches UX reference + tenants.plan check.
export const PLAN_SEAT_LIMITS = { starter: 5, pro: 20 } as const;
export type PlanTier = keyof typeof PLAN_SEAT_LIMITS;

export const signupSchema = z.object({
  labName: z.string().trim().min(2, "اسم المختبر مطلوب"),
  adminName: z.string().trim().min(2, "الاسم الكامل مطلوب"),
  email: z.string().trim().email("البريد الإلكتروني غير صالح"),
  password: z.string().min(8, "كلمة المرور 8 أحرف على الأقل"),
  inviteToken: z.string().trim().min(1).optional()
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

// Minimal AR/EN dictionary. Arabic is the default locale; English terms render
// inline LTR via the .bidi-term class (see globals.css). Expand per story.
export type Locale = "ar" | "en";
export const defaultLocale: Locale = "ar";
export const dir = (locale: Locale) => (locale === "ar" ? "rtl" : "ltr");

const dict = {
  ar: {
    "nav.pricing": "الأسعار",
    "nav.signup": "إنشاء حساب",
    "nav.login": "تسجيل الدخول",
    "nav.dashboard": "لوحة التحكم",
    "nav.admin": "الإدارة"
  },
  en: {
    "nav.pricing": "Pricing",
    "nav.signup": "Sign up",
    "nav.login": "Log in",
    "nav.dashboard": "Dashboard",
    "nav.admin": "Admin"
  }
} as const;

export type MessageKey = keyof (typeof dict)["ar"];

export function t(key: MessageKey, locale: Locale = defaultLocale): string {
  return dict[locale][key] ?? dict[defaultLocale][key] ?? key;
}

import type { Config } from "tailwindcss";
import tailwindcssRtl from "tailwindcss-rtl";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        // IBM Plex Arabic for Arabic content; system stack fallback for LTR.
        arabic: ["'IBM Plex Arabic'", "system-ui", "sans-serif"],
        sans: ["'IBM Plex Sans'", "system-ui", "sans-serif"]
      },
      colors: {
        // Single source of truth for the primary action color (L9 guard).
        // White text on amber-600 (#D97706) is 3.19:1 — FAILS WCAG-AA. These
        // AA-safe tokens replace it everywhere so no future story re-introduces
        // the failure. amber-700 #B45309 = 5.02:1, amber-800 #92400E = 7.09:1.
        "brand-amber": "#B45309", // default — white text 5.02:1 (AA pass)
        "brand-amber-hover": "#92400E" // hover — white text 7.09:1 (AA pass)
      }
    }
  },
  // tailwindcss-rtl enables ms-/me-/ps-/pe- logical-property utilities so the
  // same classes work in RTL (Arabic, default) and LTR (English) without flips.
  plugins: [tailwindcssRtl]
};

export default config;

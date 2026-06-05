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
        // ── Brand action color (L9 contrast guard) ──────────────────────────
        // Single source of truth for WHITE-ON-AMBER text. The reference's bright
        // amber (#F5A623) is 1.9:1 on white — FAILS WCAG-AA for text. These
        // AA-safe tokens are the ONLY amber allowed behind white text:
        //   brand-amber       #B45309 → white 5.02:1 (AA pass)
        //   brand-amber-hover #92400E → white 7.09:1 (AA pass)
        "brand-amber": "#B45309",
        "brand-amber-hover": "#92400E",

        // ── Reference design language (light navy + amber premium) ───────────
        // Deep navy scale — topbar gradient, headings, large display numbers.
        navy: "#0A1E3F",
        navy2: "#112C57",
        navy3: "#1B3D74",
        ink: "#14233D", // primary body text on light bg
        muted: "#5B6B85", // secondary text / captions
        line: "#E4EAF2", // hairline borders / dividers
        canvas: "#F4F7FB", // app background
        card: "#FFFFFF", // surface

        // Bright amber is ACCENT-ONLY (stripes, brand square, large navy-on-amber
        // display numerals) — never behind white text. Use brand-amber for that.
        "amber-bright": "#F5A623",
        "amber-soft": "#FFEAC4",

        // Status colors + their soft tints (badges, pills, accent fills).
        // `*-strong` are the AA-safe variants for TEXT on a light/soft background
        // or white text on a solid fill (L9). Base tones are accent-only.
        success: "#2FA37C",
        "success-soft": "#DBF1E8",
        "success-strong": "#166049", // text on success-soft 5.5:1 (AA)
        danger: "#E2553D",
        "danger-soft": "#FBE2DC",
        "danger-strong": "#B91C1C", // text on danger-soft 5.9:1 · white on it 6.5:1 (AA)
        info: "#6E84AE",
        "info-soft": "#E7EDF7"
      },
      borderRadius: {
        card: "16px",
        control: "11px"
      },
      boxShadow: {
        // Layered soft shadows from the reference (cool navy-tinted ambient).
        soft: "0 1px 2px rgba(16,38,76,.06), 0 10px 30px rgba(16,38,76,.06)",
        lift: "0 6px 16px rgba(16,38,76,.10), 0 22px 48px rgba(16,38,76,.12)"
      }
    }
  },
  // tailwindcss-rtl enables ms-/me-/ps-/pe- logical-property utilities so the
  // same classes work in RTL (Arabic, default) and LTR (English) without flips.
  plugins: [tailwindcssRtl]
};

export default config;

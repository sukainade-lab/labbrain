import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        // IBM Plex Arabic for Arabic content; system stack fallback for LTR.
        arabic: ["'IBM Plex Arabic'", "system-ui", "sans-serif"],
        sans: ["'IBM Plex Sans'", "system-ui", "sans-serif"]
      }
    }
  },
  // tailwindcss-rtl enables ms-/me-/ps-/pe- logical-property utilities so the
  // same classes work in RTL (Arabic, default) and LTR (English) without flips.
  plugins: [require("tailwindcss-rtl")]
};

export default config;

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

// A11y follow-up (Sprint 5 retro, lesson L9) — systemic guard against the
// recurring WCAG-AA contrast failure on primary action buttons.
//
// Root cause: the app-wide primary button shipped white text on amber-600
// (#D97706) = 3.19:1, which fails WCAG-AA (needs ≥4.5:1 for normal text). It
// bit S8 (found+fixed in review) and S9 (found, deferred → cost a bridge). The
// fix is a single AA-safe brand token (amber-700 #B45309, white = 5.02:1) used
// everywhere, locked by this test so no future story re-introduces the failure.

// --- WCAG relative-luminance contrast (the authoritative formula) ----------
function srgbToLinear(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}
function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}
function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

const WHITE = "#FFFFFF";
const AA_NORMAL = 4.5;

// --- recursive walk of src for .tsx files ----------------------------------
const ROOT = resolve(__dirname, "..");
const SRC = resolve(ROOT, "src");

function tsxFiles(): string[] {
  return readdirSync(SRC, { recursive: true, encoding: "utf8" })
    .filter((p) => p.endsWith(".tsx"))
    .map((p) => resolve(SRC, p));
}

// className tokens that paint a SOLID amber background. White text on any of
// these fails AA. (Borders, focus rings, and translucent /15 fills are fine —
// they never carry white body text, so they are intentionally excluded.)
const FAILING_BG = ["bg-[#D97706]", "bg-[#F59E0B]", "bg-amber-600", "bg-amber-500"];

// Pull every class string literal out of a file (className="…", const x = "…").
function classStrings(src: string): string[] {
  return Array.from(src.matchAll(/"([^"]*?(?:bg-|text-|border-)[^"]*?)"/g)).map((m) => m[1]);
}

describe("a11y — primary button contrast (L9 guard)", () => {
  it("documents WHY: white-on-#D97706 fails WCAG-AA", () => {
    expect(contrastRatio(WHITE, "#D97706")).toBeLessThan(AA_NORMAL);
  });

  it("brand token amber-700 (#B45309) passes AA with white text", () => {
    expect(contrastRatio(WHITE, "#B45309")).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it("brand hover amber-800 (#92400E) passes AA with white text", () => {
    expect(contrastRatio(WHITE, "#92400E")).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it("no .tsx pairs a solid amber background with white text", () => {
    const violations: string[] = [];
    for (const file of tsxFiles()) {
      const src = readFileSync(file, "utf8");
      for (const cls of classStrings(src)) {
        const hasWhiteText = /(^|\s)text-white(\s|$)/.test(cls);
        const hasFailingBg = FAILING_BG.some((bg) => cls.includes(bg));
        if (hasWhiteText && hasFailingBg) {
          violations.push(`${file.replace(ROOT, "")}: "${cls.slice(0, 80)}…"`);
        }
      }
    }
    expect(violations, `AA-failing buttons:\n${violations.join("\n")}`).toEqual([]);
  });

  it("the shared Button primitive uses the AA-safe brand token, not amber-600", () => {
    const btn = readFileSync(resolve(SRC, "components/ui/button.tsx"), "utf8");
    expect(btn).toContain("bg-brand-amber");
    expect(btn).not.toContain("bg-amber-600");
  });
});

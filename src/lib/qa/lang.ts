// AC-3.1 — auto-detect the question language; no UI toggle. The user's language
// also decides which "not found" message they get (AC-3.5) and is stored on the
// audit log (AC-3.7). Heuristic: any Arabic-script codepoint → Arabic, matching
// the product-demo.jsx reference. Arabic blocks: Arabic, Supplement, Extended-A,
// and the Presentation Forms used for ligatures.
const ARABIC = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;

export type Lang = "ar" | "en";

export function detectLang(text: string): Lang {
  return ARABIC.test(text) ? "ar" : "en";
}

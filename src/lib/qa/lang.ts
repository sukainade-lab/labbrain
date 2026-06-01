// AC-3.1 — auto-detect the question language; no UI toggle. The user's language
// also decides which "not found" message they get (AC-3.5) and is stored on the
// audit log (AC-3.7).
//
// Majority-script by WORD, not by raw codepoint. The ICP is an Arabic-native
// engineer who writes Arabic questions peppered with English technical terms
// ("ما هو الـ calibration interval؟") — those technical words are long and would
// dominate a codepoint count, mislabelling a genuinely-Arabic question as English.
// Counting words instead keeps that question Arabic, while a mostly-English
// question carrying one stray Arabic word correctly resolves to English. Ties go
// to Arabic (the product is Arabic-first). Arabic blocks: Arabic, Supplement,
// Extended-A, and the Presentation Forms used for ligatures.
const ARABIC = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
const LATIN = /[A-Za-z]/;

export type Lang = "ar" | "en";

export function detectLang(text: string): Lang {
  let arabicWords = 0;
  let latinWords = 0;
  for (const word of text.split(/\s+/)) {
    if (ARABIC.test(word)) arabicWords++;
    else if (LATIN.test(word)) latinWords++;
  }
  // Tie (including no-letter input) → Arabic, the product's default language.
  return arabicWords >= latinWords ? "ar" : "en";
}

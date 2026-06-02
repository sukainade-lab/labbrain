// Jordan mobile phone normalization (S7 AC-7.1).
//
// Stores ONE canonical shape — E.164 `+9627XXXXXXXX` — regardless of how the user
// typed it. Jordan mobile national significant number is 9 digits: `7` then a
// carrier digit (7/8/9) then 7 subscriber digits. Landlines (06…, 03…) and foreign
// numbers are rejected so we never try to SMS a number Unifonic can't deliver to.

const JO_MOBILE_NSN = /^7[789]\d{7}$/; // national significant number, no country code

/**
 * Normalize any everyday Jordan-mobile form to E.164 (`+9627XXXXXXXX`).
 * Returns null for anything that is not a valid Jordan mobile number.
 */
export function normalizeJordanPhone(input: string | null | undefined): string | null {
  if (!input) return null;

  // Drop everything except digits and a single leading +.
  let s = input.trim().replace(/[\s()\-.]/g, "");
  const hadPlus = s.startsWith("+");
  s = s.replace(/\D/g, ""); // now pure digits

  if (!s) return null;

  // Reduce to the 9-digit national significant number (NSN).
  let nsn: string;
  if (s.startsWith("00962")) {
    nsn = s.slice(5);
  } else if (hadPlus && s.startsWith("962")) {
    nsn = s.slice(3);
  } else if (!hadPlus && s.startsWith("962") && s.length === 12) {
    nsn = s.slice(3); // bare 962…
  } else if (s.startsWith("0")) {
    nsn = s.slice(1); // local 07…
  } else if (s.length === 9) {
    nsn = s; // bare national 7XXXXXXXX
  } else {
    return null;
  }

  if (!JO_MOBILE_NSN.test(nsn)) return null;
  return `+962${nsn}`;
}

/**
 * Derive the Unifonic `Recipient` param from an E.164 number — international form
 * WITHOUT the leading `+` (e.g. `962791234567`).
 */
export function toUnifonicRecipient(e164: string): string {
  return e164.replace(/^\+/, "");
}

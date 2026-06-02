import { describe, it, expect } from "vitest";
import { normalizeJordanPhone, toUnifonicRecipient } from "@/lib/auth/phone";

// S7 AC-7.1 — Jordan mobile normalization. A logged-in user types their number in
// any of the everyday forms; we store ONE canonical E.164 shape (+9627XXXXXXXX) and
// derive the Unifonic recipient (9627XXXXXXXX, no +) from it.

describe("normalizeJordanPhone", () => {
  it("@AC-7.1 normalizes local 07XXXXXXXX → +9627XXXXXXXX", () => {
    expect(normalizeJordanPhone("0791234567")).toBe("+962791234567");
    expect(normalizeJordanPhone("0781234567")).toBe("+962781234567");
    expect(normalizeJordanPhone("0771234567")).toBe("+962771234567");
  });

  it("@AC-7.1 accepts already-E.164 +9627XXXXXXXX", () => {
    expect(normalizeJordanPhone("+962791234567")).toBe("+962791234567");
  });

  it("@AC-7.1 accepts 00962 international-access form", () => {
    expect(normalizeJordanPhone("00962791234567")).toBe("+962791234567");
  });

  it("@AC-7.1 accepts bare 962… and bare national 7XXXXXXXX", () => {
    expect(normalizeJordanPhone("962791234567")).toBe("+962791234567");
    expect(normalizeJordanPhone("791234567")).toBe("+962791234567");
  });

  it("@AC-7.1 tolerates spaces, dashes and parens", () => {
    expect(normalizeJordanPhone(" 079-123 4567 ")).toBe("+962791234567");
    expect(normalizeJordanPhone("+962 (79) 123-4567")).toBe("+962791234567");
  });

  it("@AC-7.1 rejects non-Jordan / malformed / wrong-length numbers", () => {
    expect(normalizeJordanPhone("0601234567")).toBeNull(); // 06 = landline, not mobile
    expect(normalizeJordanPhone("079123456")).toBeNull(); // too short
    expect(normalizeJordanPhone("07912345678")).toBeNull(); // too long
    expect(normalizeJordanPhone("+1202555 0143")).toBeNull(); // US number
    expect(normalizeJordanPhone("")).toBeNull();
    expect(normalizeJordanPhone("abc")).toBeNull();
  });
});

describe("toUnifonicRecipient", () => {
  it("@AC-7.2 strips the + for the Unifonic Recipient param", () => {
    expect(toUnifonicRecipient("+962791234567")).toBe("962791234567");
  });
});

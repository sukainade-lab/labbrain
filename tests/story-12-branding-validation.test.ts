import { describe, it, expect } from "vitest";
import {
  LOGO_ACCEPTED_MIME,
  MAX_LOGO_BYTES,
  logoMetaSchema,
  extForLogoMime,
  resolveLogoMime
} from "@/lib/validation/branding";

// S12 — pure validation guards for the logo upload (AC-12.1). These cover the
// accept/reject contract the route depends on: the accepted MIME set, the 512 KB
// hard cap (boundary), bad-shape rejection, and the MIME↔ext round-trip including
// the octet-stream extension fallback the AC promises (AC-12.1).

describe("logoMetaSchema — accept/reject contract (AC-12.1)", () => {
  it("@AC-12.1 accepts every supported MIME", () => {
    for (const mime of Object.values(LOGO_ACCEPTED_MIME)) {
      const r = logoMetaSchema.safeParse({ mimeType: mime, sizeBytes: 1024 });
      expect(r.success, mime).toBe(true);
    }
  });

  it("@AC-12.1 rejects an unsupported MIME with the Arabic message", () => {
    const r = logoMetaSchema.safeParse({ mimeType: "application/pdf", sizeBytes: 1024 });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toContain("صيغة غير مدعومة");
  });

  it("@AC-12.1 accepts a logo exactly at the 512 KB cap", () => {
    const r = logoMetaSchema.safeParse({ mimeType: "image/png", sizeBytes: MAX_LOGO_BYTES });
    expect(r.success).toBe(true);
  });

  it("@AC-12.1 rejects a logo one byte over the cap", () => {
    const r = logoMetaSchema.safeParse({ mimeType: "image/png", sizeBytes: MAX_LOGO_BYTES + 1 });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toContain("512");
  });

  it("@AC-12.1 rejects an empty file", () => {
    const r = logoMetaSchema.safeParse({ mimeType: "image/png", sizeBytes: 0 });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toContain("فارغ");
  });
});

describe("extForLogoMime — canonical extension (AC-12.1/12.3)", () => {
  it("@AC-12.3 maps each MIME to its canonical extension (jpeg → jpg)", () => {
    expect(extForLogoMime("image/png")).toBe("png");
    expect(extForLogoMime("image/jpeg")).toBe("jpg");
    expect(extForLogoMime("image/webp")).toBe("webp");
    expect(extForLogoMime("image/svg+xml")).toBe("svg");
  });

  it("@AC-12.3 returns null for an unknown MIME", () => {
    expect(extForLogoMime("application/pdf")).toBeNull();
  });
});

describe("resolveLogoMime — declared type wins, extension fallback (AC-12.1)", () => {
  it("@AC-12.1 trusts a valid declared MIME", () => {
    expect(resolveLogoMime("logo.png", "image/png")).toBe("image/png");
  });

  it("@AC-12.1 falls back to the extension when the browser mislabels octet-stream", () => {
    expect(resolveLogoMime("brand.svg", "application/octet-stream")).toBe("image/svg+xml");
    expect(resolveLogoMime("brand.jpeg", "")).toBe("image/jpeg");
    expect(resolveLogoMime("brand.jpg", null)).toBe("image/jpeg");
  });

  it("@AC-12.1 returns null when neither type nor extension is a supported image", () => {
    expect(resolveLogoMime("notes.txt", "text/plain")).toBeNull();
    expect(resolveLogoMime("noext", "application/octet-stream")).toBeNull();
  });
});

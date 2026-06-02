import { describe, it, expect, vi } from "vitest";
import { renderPdfFromHtml } from "@/lib/audit/render-pdf";

// Story 9 — PDF render seam (AC-9.4). Chromium is injected here so this test
// (and every route test) runs without a real browser — CI never needs Chromium.
// The default launcher (real puppeteer-core) is exercised only in the manual walk.

function fakeBrowser() {
  const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]); // "%PDF-"
  const page = {
    setContent: vi.fn().mockResolvedValue(undefined),
    pdf: vi.fn().mockResolvedValue(pdfBytes)
  };
  const browser = {
    newPage: vi.fn().mockResolvedValue(page),
    close: vi.fn().mockResolvedValue(undefined)
  };
  return { browser, page, pdfBytes };
}

describe("Story 9 — renderPdfFromHtml seam (@AC-9.4)", () => {
  it("loads the HTML and returns the PDF bytes", async () => {
    const { browser, page, pdfBytes } = fakeBrowser();
    const out = await renderPdfFromHtml("<html><body>hi</body></html>", {
      launch: async () => browser
    });
    expect(page.setContent).toHaveBeenCalledWith(
      "<html><body>hi</body></html>",
      expect.objectContaining({ waitUntil: expect.any(String) })
    );
    expect(out).toEqual(pdfBytes);
    expect(String.fromCharCode(...out.slice(0, 5))).toBe("%PDF-");
  });

  it("renders A4 with backgrounds (print fidelity)", async () => {
    const { browser, page } = fakeBrowser();
    await renderPdfFromHtml("<html></html>", { launch: async () => browser });
    expect(page.pdf).toHaveBeenCalledWith(
      expect.objectContaining({ format: "A4", printBackground: true })
    );
  });

  it("always closes the browser, even when rendering throws", async () => {
    const { browser, page } = fakeBrowser();
    page.pdf.mockRejectedValueOnce(new Error("boom"));
    await expect(
      renderPdfFromHtml("<html></html>", { launch: async () => browser })
    ).rejects.toThrow("boom");
    expect(browser.close).toHaveBeenCalledTimes(1);
  });

  it("default launcher throws a clear error when no Chromium path is configured", async () => {
    const prev = process.env.PUPPETEER_EXECUTABLE_PATH;
    const prevAlt = process.env.CHROMIUM_PATH;
    delete process.env.PUPPETEER_EXECUTABLE_PATH;
    delete process.env.CHROMIUM_PATH;
    try {
      await expect(renderPdfFromHtml("<html></html>")).rejects.toThrow(
        /PUPPETEER_EXECUTABLE_PATH/
      );
    } finally {
      if (prev !== undefined) process.env.PUPPETEER_EXECUTABLE_PATH = prev;
      if (prevAlt !== undefined) process.env.CHROMIUM_PATH = prevAlt;
    }
  });
});

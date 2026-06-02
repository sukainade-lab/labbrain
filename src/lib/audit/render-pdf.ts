// Story 9 — the Chromium render seam (AC-9.4). A headless browser is the only
// reliable Arabic shaper + bidi resolver, so the RTL HTML report is rendered to
// a deterministic A4 PDF by a system Chromium driven via puppeteer-core. The
// launcher is injectable so every automated test (route + this unit) runs
// without a real browser — CI never installs Chromium. The default launcher
// (real puppeteer-core) is only ever hit in production + the manual walk.

// Minimal structural types — we don't import puppeteer-core's types at the top
// level so the seam stays mockable and the dep stays lazy.
export interface PdfPage {
  setContent(html: string, opts: { waitUntil: string }): Promise<void>;
  pdf(opts: Record<string, unknown>): Promise<Uint8Array>;
}
export interface PdfBrowser {
  newPage(): Promise<PdfPage>;
  close(): Promise<void>;
}
export type BrowserLauncher = () => Promise<PdfBrowser>;

const PDF_OPTIONS = {
  format: "A4",
  printBackground: true,
  margin: { top: "18mm", bottom: "18mm", left: "14mm", right: "14mm" }
} as const;

// Default launcher: real system Chromium via puppeteer-core. Lazily imported so
// the module loads (and tests run) even where puppeteer-core/Chromium are absent.
async function defaultLaunch(): Promise<PdfBrowser> {
  const execPath =
    process.env.PUPPETEER_EXECUTABLE_PATH ?? process.env.CHROMIUM_PATH;
  if (!execPath) {
    throw new Error(
      "PUPPETEER_EXECUTABLE_PATH is not set — cannot render audit PDF"
    );
  }
  const puppeteer = await import("puppeteer-core");
  const browser = await puppeteer.default.launch({
    executablePath: execPath,
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });
  return browser as unknown as PdfBrowser;
}

// Render print-styled HTML → A4 PDF bytes. Always closes the browser.
export async function renderPdfFromHtml(
  html: string,
  opts: { launch?: BrowserLauncher } = {}
): Promise<Uint8Array> {
  const launch = opts.launch ?? defaultLaunch;
  const browser = await launch();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    return await page.pdf({ ...PDF_OPTIONS });
  } finally {
    await browser.close();
  }
}

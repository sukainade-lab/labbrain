import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "LabBrain — ذكاء وثائق ISO 17025",
  description:
    "إجابات موثّقة من وثائق مختبرك، بالعربي والإنجليزي. صفر هلوسة، استشهاد إجباري بالمصدر."
};

// RTL by default (Arabic-first). English content switches to LTR inline via .bidi-term / dir="ltr".
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body className="font-arabic">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

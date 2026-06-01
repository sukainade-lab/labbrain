"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// App-shell navigation. Client component so the current route can be highlighted
// (usePathname) — orientation matters on a tool an engineer lives in all day.
// Each link is a ≥44px tap target (MENA mobile rule; WhatsApp-shared at 375px).
const LINKS = [
  { href: "/dashboard", label: "لوحة التحكم" },
  { href: "/documents", label: "الوثائق" },
  { href: "/qa", label: "الأسئلة والأجوبة" },
  { href: "/admin", label: "الإدارة" }
];

export function NavLinks() {
  const pathname = usePathname();
  return (
    <nav className="mt-8 space-y-1 text-slate-300">
      {LINKS.map(({ href, label }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`flex min-h-[44px] items-center rounded-lg px-3 py-2 transition ${
              active
                ? "bg-amber-500/10 font-semibold text-amber-400"
                : "hover:bg-slate-800/60 hover:text-amber-400"
            }`}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

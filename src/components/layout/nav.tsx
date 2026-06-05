import Link from "next/link";

// Public top nav for marketing/auth pages. RTL by inheritance from <html dir>.
export function Nav() {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-card/80 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center gap-2 text-lg font-bold text-navy">
          <span
            aria-hidden="true"
            className="flex h-8 w-8 items-center justify-center rounded-control bg-amber-bright font-bold text-navy"
          >
            L
          </span>
          LabBrain
        </Link>
        <nav className="flex gap-1 text-muted">
          <Link
            href="/pricing"
            className="rounded-control px-3 py-2 transition-colors hover:bg-canvas hover:text-navy"
          >
            الأسعار
          </Link>
          <Link
            href="/login"
            className="rounded-control px-3 py-2 transition-colors hover:bg-canvas hover:text-navy"
          >
            تسجيل الدخول
          </Link>
        </nav>
      </div>
    </header>
  );
}

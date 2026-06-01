import Link from "next/link";

// Public top nav for marketing/auth pages. RTL by inheritance from <html dir>.
export function Nav() {
  return (
    <header className="border-b border-slate-800">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
        <Link href="/" className="text-lg font-bold text-amber-500">
          LabBrain
        </Link>
        <nav className="flex gap-6 text-slate-300">
          <Link href="/pricing" className="hover:text-amber-400">
            الأسعار
          </Link>
          <Link href="/login" className="hover:text-amber-400">
            تسجيل الدخول
          </Link>
        </nav>
      </div>
    </header>
  );
}

import Link from "next/link";
import { LogoutButton } from "@/components/layout/logout-button";

// Shell layout for authenticated app routes. Route protection is enforced in
// proxy.ts (gates the (app) group behind a Supabase session).
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 flex-col border-l border-slate-800 bg-slate-900/40 p-6">
        <div className="text-lg font-bold text-amber-500">LabBrain</div>
        <nav className="mt-8 space-y-2 text-slate-300">
          <Link href="/dashboard" className="block hover:text-amber-400">
            لوحة التحكم
          </Link>
          <Link href="/admin" className="block hover:text-amber-400">
            الإدارة
          </Link>
        </nav>
        <div className="mt-auto pt-8">
          <LogoutButton />
        </div>
      </aside>
      <main className="flex-1 px-8 py-10">{children}</main>
    </div>
  );
}

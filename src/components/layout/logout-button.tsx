"use client";

import { useState } from "react";

// AC-1.5 — sign out: clears the Supabase session server-side then routes to /login.
export function LogoutButton() {
  const [loading, setLoading] = useState(false);

  async function onClick() {
    setLoading(true);
    try {
      const res = await fetch("/api/auth/logout", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      window.location.href = data.next ?? "/login";
    } catch {
      window.location.href = "/login";
    }
  }

  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="flex min-h-[44px] w-full items-center rounded-control px-3 text-start text-muted transition-colors hover:bg-danger-soft hover:text-danger-strong disabled:opacity-60"
    >
      {loading ? "جارٍ الخروج…" : "تسجيل الخروج"}
    </button>
  );
}

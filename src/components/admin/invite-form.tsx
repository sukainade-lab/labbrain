"use client";

import { useState } from "react";

const field =
  "w-full rounded-control border border-line bg-card px-4 py-3 text-ink shadow-soft placeholder:text-muted focus:border-brand-amber focus:outline-none";

type Role = "admin" | "member";

// AC-1.4 — owner/admin invites a teammate by email. Posts to /api/invitations,
// which enforces seat limits (AC-1.6) and tenant-scoped permissions server-side.
export function InviteForm() {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("member");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setOk(null);
    setLoading(true);
    try {
      const res = await fetch("/api/invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role })
      });
      const data = await res.json();
      if (!res.ok) {
        setError(
          data.code === "seat_limit"
            ? "بلغت الحد الأقصى لعدد المستخدمين في خطتك — رقِّ خطتك لإضافة المزيد."
            : data.error ?? "تعذّر إرسال الدعوة"
        );
        return;
      }
      setOk(`تم إرسال الدعوة إلى ${email}`);
      setEmail("");
    } catch {
      setError("تعذّر الاتصال بالخادم");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-4 space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          className={field}
          type="email"
          dir="ltr"
          placeholder="بريد عضو الفريق"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <select
          className="rounded-control border border-line bg-card px-4 py-3 text-ink shadow-soft focus:border-brand-amber focus:outline-none"
          value={role}
          onChange={(e) => setRole(e.target.value as Role)}
          aria-label="دور العضو"
        >
          <option value="member">عضو</option>
          <option value="admin">مشرف</option>
        </select>
        <button
          type="submit"
          disabled={loading}
          className="min-h-[44px] whitespace-nowrap rounded-control bg-brand-amber px-6 py-3 font-semibold text-white shadow-soft transition-all hover:bg-brand-amber-hover hover:shadow-lift disabled:opacity-60"
        >
          {loading ? "جارٍ الإرسال…" : "إرسال دعوة"}
        </button>
      </div>

      {error && (
        <p className="rounded-control bg-danger-soft px-4 py-2 text-sm font-medium text-danger-strong" role="alert">
          {error}
        </p>
      )}
      {ok && (
        <p className="rounded-control bg-success-soft px-4 py-2 text-sm font-medium text-success-strong" role="status">
          {ok}
        </p>
      )}
    </form>
  );
}

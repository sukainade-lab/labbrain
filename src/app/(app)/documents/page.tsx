"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// AC-2.5 — document library: name, date, page count, status, delete.
// AC-2.1/2.6 — upload control with status states + over-cap upgrade message.
// RTL-first, IBM Plex Arabic, brand tokens (Navy #1B2A3D / Amber #D97706 / BG
// #0F172A / border #334155), matches docs/ux-reference/product-demo.jsx.

interface DocRow {
  id: string;
  filename: string;
  status: "pending" | "parsing" | "indexing" | "ready" | "failed";
  page_count: number | null;
  created_at: string;
}

const STATUS: Record<DocRow["status"], { label: string; bg: string; color: string }> = {
  pending: { label: "بالانتظار", bg: "#1e3a5f", color: "#93c5fd" },
  parsing: { label: "يُحلَّل...", bg: "#1e3a5f", color: "#93c5fd" },
  indexing: { label: "يُعالَج...", bg: "#1e3a5f", color: "#93c5fd" },
  ready: { label: "جاهز", bg: "#064e3b", color: "#6ee7b7" },
  failed: { label: "خطأ", bg: "#7f1d1d", color: "#fca5a5" }
};

const ACCEPT = ".pdf,.docx,.xlsx";

function extOf(name: string): string {
  const m = name.toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : "doc";
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

export default function DocumentsPage() {
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // No synchronous setState here: the first await yields before any state
  // update, so the initial `loading` (true by default) covers the first load and
  // post-upload/delete refreshes reuse the already-rendered list.
  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/documents");
      const data = await res.json();
      if (res.ok) setDocs(data.documents ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function onUpload(file: File) {
    setError(null);
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/documents", { method: "POST", body: form });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "تعذّر رفع الوثيقة");
        return;
      }
      await load();
    } catch {
      setError("تعذّر رفع الوثيقة");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function onDelete(id: string) {
    if (!confirm("هل تريد حذف هذه الوثيقة وكل مقاطعها؟")) return;
    const res = await fetch(`/api/documents/${id}`, { method: "DELETE" });
    if (res.ok) setDocs((prev) => prev.filter((d) => d.id !== id));
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-100">وثائق المختبر</h1>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="min-h-[44px] rounded-lg bg-[#D97706] px-5 text-sm font-semibold text-white transition hover:bg-[#b45f05] disabled:opacity-60"
        >
          {uploading ? "جارٍ الرفع..." : "+ رفع وثيقة"}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onUpload(f);
          }}
        />
      </div>

      <p className="mt-2 text-xs text-slate-400">PDF أو DOCX أو XLSX — حتى 50 ميغابايت لكل ملف.</p>

      {error && (
        <div className="mt-4 rounded-lg border border-[#92400e] bg-[#3b1c08] px-4 py-3 text-sm text-[#fcd34d]">
          {error}
        </div>
      )}

      <div className="mt-6 flex flex-col gap-2">
        {loading ? (
          <div className="rounded-xl border border-[#334155] bg-[#1B2A3D] p-6 text-center text-sm text-slate-400">
            جارٍ التحميل...
          </div>
        ) : docs.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[#334155] bg-[#1B2A3D] p-8 text-center text-sm text-slate-400">
            لا توجد وثائق بعد. ارفع أول وثيقة لمختبرك لتبدأ.
          </div>
        ) : (
          docs.map((doc) => {
            const ext = extOf(doc.filename);
            const s = STATUS[doc.status] ?? STATUS.ready;
            return (
              <div
                key={doc.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-[#334155] bg-[#1B2A3D] px-4 py-3"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div
                    dir="ltr"
                    className="flex h-9 w-9 flex-none items-center justify-center rounded-md text-[11px] font-bold uppercase text-[#fca5a5]"
                    style={{ background: ext === "pdf" ? "#7f1d1d" : "#14532d" }}
                  >
                    {ext}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-slate-100">{doc.filename}</div>
                    <div className="mt-0.5 text-[11px] text-slate-400">
                      {doc.page_count ? `${doc.page_count} صفحة · ` : ""}
                      {fmtDate(doc.created_at)}
                    </div>
                  </div>
                </div>
                <div className="flex flex-none items-center gap-3">
                  <span
                    className="rounded-full px-2.5 py-0.5 text-[11px] font-medium"
                    style={{ background: s.bg, color: s.color }}
                  >
                    {s.label}
                  </span>
                  <button
                    type="button"
                    onClick={() => onDelete(doc.id)}
                    aria-label={`حذف ${doc.filename}`}
                    className="min-h-[44px] px-2 text-slate-400 transition hover:text-[#fca5a5]"
                  >
                    حذف
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {!loading && docs.length > 0 && (
        <div className="mt-4 rounded-lg bg-[#1e3a5f] px-4 py-2.5 text-xs text-[#93c5fd]">
          {docs.length} وثيقة
        </div>
      )}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  SECTIONS_BY_PANEL,
  type PanelType
} from "@/lib/validation/workspace";

// S18 — two-panel document workspace (AC-2.1/2.4/2.6/2.8).
// A permanent "خدماتي الحالية" (Existing Services) tab + dynamic "خدمة جديدة"
// (New Service) tabs the lab adds via "+" / removes via "✕". Each tab carries
// section sub-tabs; uploads are tagged with the active panel/tab/section so a file
// is filed under exactly the box it was dropped into. RTL-first, IBM Plex Arabic,
// brand tokens (Navy #1B2A3D / Amber #D97706 / BG #F8FAFC). Mixed-script filenames
// AND lab-named service tabs are <bdi>-isolated (L5); controls are ≥44px (L9).

interface DocRow {
  id: string;
  filename: string;
  status: "pending" | "parsing" | "indexing" | "ready" | "failed";
  page_count: number | null;
  version: number;
  created_at: string;
  panel_type: PanelType;
  service_tab_id: string | null;
  doc_section: string;
}

interface DocsResponse {
  documents: DocRow[];
  count: number;
  plan: string;
  limit: number;
}

interface ServiceTab {
  id: string;
  name: string;
  position: number;
  created_at: string;
}

// The permanent panel is keyed by this sentinel in `activeTab`; any other value is
// a service-tab id (panel_type='new_service').
const EXISTING = "existing" as const;

// Light-theme status pills: soft tint + AA-dark text. Status is also conveyed by
// the label text itself (never colour alone) per L9.
const STATUS: Record<DocRow["status"], { label: string; bg: string; color: string }> = {
  pending: { label: "بالانتظار", bg: "#E7EDF7", color: "#1E3A5F" },
  parsing: { label: "يُحلَّل...", bg: "#E7EDF7", color: "#1E3A5F" },
  indexing: { label: "يُعالَج...", bg: "#E7EDF7", color: "#1E3A5F" },
  ready: { label: "جاهز", bg: "#DBF1E8", color: "#166049" },
  failed: { label: "خطأ", bg: "#FBE2DC", color: "#B91C1C" }
};

// A document is still moving through the pipeline (poll until terminal).
const ACTIVE: DocRow["status"][] = ["pending", "parsing", "indexing"];

const PLAN_LABEL: Record<string, string> = { starter: "Starter", pro: "Pro" };

const ACCEPT = ".pdf,.docx,.xlsx";

// Per-panel section display labels (the sub-tab vocabulary differs by panel —
// SECTIONS_BY_PANEL is the single source of truth; this only translates the keys).
const SECTION_LABEL: Record<string, string> = {
  sops: "إجراءات التشغيل (SOPs)",
  references: "المراجع",
  equipment: "الأجهزة والمعدات",
  available_equipment: "الأجهزة المتاحة",
  additional_info: "معلومات إضافية"
};

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
  const [tabs, setTabs] = useState<ServiceTab[]>([]);
  const [plan, setPlan] = useState("starter");
  const [limit, setLimit] = useState(50);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Which tab is selected: EXISTING (permanent panel) or a service-tab id.
  const [activeTab, setActiveTab] = useState<string>(EXISTING);
  // Which section sub-tab is selected within the active panel.
  const [activeSection, setActiveSection] = useState<string>("references");
  const [addingTab, setAddingTab] = useState(false);

  // Highlight + scroll to a doc arrived-at from a Q&A citation (/documents?doc=ID).
  const [highlightId, setHighlightId] = useState<string | null>(() =>
    typeof window === "undefined"
      ? null
      : new URLSearchParams(window.location.search).get("doc")
  );
  // Which document is mid-replace (S13). A single hidden input is reused per row.
  const [replacingId, setReplacingId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const [docsRes, tabsRes] = await Promise.all([
        fetch("/api/documents"),
        fetch("/api/service-tabs")
      ]);
      const docsData: DocsResponse = await docsRes.json();
      if (docsRes.ok) {
        setDocs(docsData.documents ?? []);
        if (docsData.plan) setPlan(docsData.plan);
        if (docsData.limit) setLimit(docsData.limit);
      }
      if (tabsRes.ok) {
        const tabsData = await tabsRes.json();
        setTabs(tabsData.tabs ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // When the user arrives from a Q&A citation, the cited doc dictates the visible
  // panel/section so it actually lands in view (derived below, not stored).
  const highlightDoc = highlightId ? docs.find((d) => d.id === highlightId) : undefined;

  // Effective selection, corrected during render (never via setState-in-effect): a
  // citation target wins; otherwise the user's pick, snapped back to the permanent
  // panel if its service tab was removed, and to the first valid section if the
  // panel's vocabulary doesn't include the chosen one.
  const tabExists = activeTab === EXISTING || tabs.some((t) => t.id === activeTab);
  const effectiveTab = highlightDoc
    ? highlightDoc.service_tab_id ?? EXISTING
    : tabExists
      ? activeTab
      : EXISTING;
  const activePanel: PanelType = effectiveTab === EXISTING ? "existing" : "new_service";
  const activeTabId: string | null = effectiveTab === EXISTING ? null : effectiveTab;
  const sections = SECTIONS_BY_PANEL[activePanel];
  const effectiveSection = highlightDoc
    ? highlightDoc.doc_section
    : sections.includes(activeSection)
      ? activeSection
      : sections[0];

  // Once the highlighted doc is in the list, scroll it into view, then clear the
  // ring after a few seconds (setState lives in the timeout callback, not the
  // effect body, so it doesn't trigger a cascading render).
  useEffect(() => {
    if (!highlightId || loading) return;
    const el = document.getElementById(`doc-${highlightId}`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    const t = setTimeout(() => setHighlightId(null), 4000);
    return () => clearTimeout(t);
  }, [highlightId, loading, docs]);

  // Poll while any doc is non-terminal so badges transition live (AC-2.3).
  const hasActive = docs.some((d) => ACTIVE.includes(d.status));
  useEffect(() => {
    if (!hasActive) return;
    const id = setInterval(() => {
      load();
    }, 2500);
    return () => clearInterval(id);
  }, [hasActive, load]);

  // Documents filed under the active panel/tab/section.
  const visibleDocs = useMemo(
    () =>
      docs.filter(
        (d) =>
          d.panel_type === activePanel &&
          (d.service_tab_id ?? null) === activeTabId &&
          d.doc_section === effectiveSection
      ),
    [docs, activePanel, activeTabId, effectiveSection]
  );

  async function onUpload(file: File) {
    setError(null);
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("panel_type", activePanel);
      if (activeTabId) form.append("service_tab_id", activeTabId);
      form.append("doc_section", effectiveSection);
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

  // S13 — replace a document's file in place. Same id, re-enters the pipeline.
  async function onReplace(id: string, file: File) {
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/documents/${id}`, { method: "PUT", body: form });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "تعذّر استبدال الوثيقة");
        return;
      }
      await load();
    } catch {
      setError("تعذّر استبدال الوثيقة");
    } finally {
      setReplacingId(null);
      if (replaceRef.current) replaceRef.current.value = "";
    }
  }

  // Add a New Service tab (AC-2.1). Name is lab-supplied mixed-script text.
  async function onAddTab() {
    const name = prompt("اسم الخدمة الجديدة:")?.trim();
    if (!name) return;
    setError(null);
    setAddingTab(true);
    try {
      const res = await fetch("/api/service-tabs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "تعذّر إنشاء التبويب");
        return;
      }
      await load();
      // Jump straight into the new tab, on its first section.
      setActiveTab(data.tab.id);
      setActiveSection(SECTIONS_BY_PANEL.new_service[0]);
    } catch {
      setError("تعذّر إنشاء التبويب");
    } finally {
      setAddingTab(false);
    }
  }

  // Remove a New Service tab (AC-2.1). Founder-confirmed; the FK cascade removes
  // the tab's documents + chunks atomically server-side.
  async function onDeleteTab(tab: ServiceTab) {
    if (
      !confirm(
        `حذف تبويب "${tab.name}" سيحذف كل وثائقه ومقاطعها نهائيًا. هل أنت متأكد؟`
      )
    )
      return;
    setError(null);
    const res = await fetch("/api/service-tabs", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: tab.id })
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "تعذّر حذف التبويب");
      return;
    }
    if (activeTab === tab.id) {
      setActiveTab(EXISTING);
      setActiveSection("references");
    }
    await load();
  }

  const planLabel = PLAN_LABEL[plan] ?? plan;
  const usagePct = limit > 0 ? Math.round((docs.length / limit) * 100) : 0;

  return (
    <div>
      <h1 className="text-2xl font-bold text-navy">مساحة عمل الوثائق</h1>
      <p className="mt-2 text-xs text-muted">
        نظّم وثائق مختبرك ضمن الخدمات الحالية أو ابدأ تبويب خدمة جديدة.
      </p>

      {/* ── Service tab bar (AC-2.1) ──────────────────────────────────────────── */}
      <div className="mt-6 flex flex-wrap items-center gap-2 border-b border-line pb-3">
        {/* Permanent Existing Services tab — never removable. */}
        <button
          type="button"
          onClick={() => setActiveTab(EXISTING)}
          className={`min-h-[44px] rounded-control px-4 text-sm font-semibold transition-all ${
            effectiveTab === EXISTING
              ? "bg-brand-amber text-white shadow-soft"
              : "border border-line bg-card text-navy hover:shadow-soft"
          }`}
        >
          خدماتي الحالية
        </button>

        {/* Dynamic New Service tabs — each removable via ✕ (lab-named → <bdi>). */}
        {tabs.map((tab) => {
          const active = effectiveTab === tab.id;
          return (
            <div
              key={tab.id}
              className={`flex min-h-[44px] items-center gap-1 rounded-control pr-1 transition-all ${
                active
                  ? "bg-brand-amber text-white shadow-soft"
                  : "border border-line bg-card text-navy hover:shadow-soft"
              }`}
            >
              <button
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className="min-h-[44px] px-3 text-sm font-semibold"
              >
                <bdi>{tab.name}</bdi>
              </button>
              <button
                type="button"
                onClick={() => onDeleteTab(tab)}
                aria-label={`حذف تبويب ${tab.name}`}
                className={`inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-control text-base leading-none transition ${
                  active ? "text-white/80 hover:text-white" : "text-muted hover:text-danger-strong"
                }`}
              >
                ✕
              </button>
            </div>
          );
        })}

        {/* Add a New Service tab. */}
        <button
          type="button"
          onClick={onAddTab}
          disabled={addingTab}
          aria-label="إضافة تبويب خدمة جديدة"
          className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-control border border-dashed border-line bg-card text-lg font-bold text-brand-amber transition hover:shadow-soft disabled:opacity-60"
        >
          +
        </button>
      </div>

      {/* ── Section sub-tabs for the active panel ─────────────────────────────── */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {sections.map((sec) => (
          <button
            key={sec}
            type="button"
            onClick={() => setActiveSection(sec)}
            className={`min-h-[44px] rounded-control px-4 text-sm font-medium transition ${
              effectiveSection === sec
                ? "bg-navy text-white"
                : "border border-line bg-card text-navy hover:shadow-soft"
            }`}
          >
            {SECTION_LABEL[sec] ?? sec}
          </button>
        ))}
      </div>

      {/* ── Section toolbar: upload + (new-service only) SOP slot ──────────────── */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="min-h-[44px] rounded-control bg-brand-amber px-5 text-sm font-semibold text-white shadow-soft transition-all hover:bg-brand-amber-hover hover:shadow-lift disabled:opacity-60"
        >
          {uploading ? "جارٍ الرفع..." : "+ رفع وثيقة"}
        </button>

        {/* SOP Draft Generator slot — present only in New Service tabs, inert until
            S20. Disabled placeholder keeps the layout stable for the next story. */}
        {activePanel === "new_service" && (
          <button
            type="button"
            disabled
            title="إنشاء مسودة SOP — قريبًا"
            className="min-h-[44px] cursor-not-allowed rounded-control border border-line bg-card px-5 text-sm font-semibold text-muted opacity-70"
          >
            📝 إنشاء مسودة SOP (قريبًا)
          </button>
        )}

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
        <input
          ref={replaceRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f && replacingId) onReplace(replacingId, f);
          }}
        />
      </div>

      <p className="mt-2 text-xs text-muted">PDF أو DOCX أو XLSX — حتى 50 ميغابايت لكل ملف.</p>

      {error && (
        <div className="mt-4 rounded-control border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-medium text-danger-strong">
          {error}
        </div>
      )}

      {/* ── Document list for the active section ───────────────────────────────── */}
      <div className="mt-6 flex flex-col gap-2">
        {loading ? (
          <div className="rounded-card border border-line bg-card p-6 text-center text-sm text-muted shadow-soft">
            جارٍ التحميل...
          </div>
        ) : visibleDocs.length === 0 ? (
          <div className="rounded-card border border-dashed border-line bg-card p-8 text-center text-sm text-muted">
            لا توجد وثائق في هذا القسم بعد. ارفع أول وثيقة لتبدأ.
          </div>
        ) : (
          visibleDocs.map((doc) => {
            const ext = extOf(doc.filename);
            const s = STATUS[doc.status] ?? STATUS.ready;
            return (
              <div
                key={doc.id}
                id={`doc-${doc.id}`}
                className={`flex items-center justify-between gap-3 rounded-card border bg-card px-4 py-3 shadow-soft transition-all hover:shadow-lift ${
                  doc.id === highlightId
                    ? "border-brand-amber ring-2 ring-brand-amber/40"
                    : "border-line"
                }`}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div
                    dir="ltr"
                    className="flex h-9 w-9 flex-none items-center justify-center rounded-md text-[11px] font-bold uppercase"
                    style={{
                      background: ext === "pdf" ? "#FBE2DC" : "#DBF1E8",
                      color: ext === "pdf" ? "#B91C1C" : "#166049"
                    }}
                  >
                    {ext}
                  </div>
                  <div className="min-w-0">
                    <bdi className="block truncate text-sm font-semibold text-ink">
                      {doc.filename}
                    </bdi>
                    <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted">
                      <span>
                        {doc.status === "ready" ? `${doc.page_count ?? 0} صفحة · ` : ""}
                        {fmtDate(doc.created_at)}
                      </span>
                      {doc.version > 1 && (
                        <span className="rounded bg-info-soft px-1.5 py-0.5 font-semibold text-navy">
                          نسخة <bdi>{doc.version}</bdi>
                        </span>
                      )}
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
                    onClick={() => {
                      setReplacingId(doc.id);
                      replaceRef.current?.click();
                    }}
                    disabled={ACTIVE.includes(doc.status)}
                    aria-label={`استبدال ${doc.filename}`}
                    className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center px-1 text-sm font-medium text-muted transition hover:text-brand-amber disabled:opacity-40"
                  >
                    استبدال
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(doc.id)}
                    aria-label={`حذف ${doc.filename}`}
                    className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center text-sm font-medium text-muted transition hover:text-danger-strong"
                  >
                    حذف
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {!loading && (
        <div className="mt-4 rounded-control bg-info-soft px-4 py-2.5 text-xs font-medium text-navy">
          {docs.length} / {limit} وثيقة · خطة {planLabel} · الاستخدام {usagePct}%
        </div>
      )}
    </div>
  );
}

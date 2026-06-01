/**
 * LabBrain — Admin Dashboard Mockup
 * BRD Stories: S4 (Invoice activation), S5 (Observability)
 * Loops: money, observability
 *
 * Founder-only view. Shows:
 * - Key metrics (tenants, MRR, active questions, invoice queue)
 * - Tenant list with plan/status/usage
 * - Invoice queue (pending bank transfers to activate)
 * - Quick actions: pause account, mark paid, view usage
 *
 * NOTE: UX reference for Claude Code — not production code.
 * Admin accesses via /admin route (protected by founder email check).
 */

import { useState } from "react";

const TENANTS = [
  { id: 1, name: "مختبر الأردن للمعايرة", admin: "أحمد الخطيب", plan: "starter", status: "active", users: 4, docs: 23, queries: 142, joined: "2026-05-01", invoice: "paid" },
  { id: 2, name: "مختبرات الجامعة الأردنية", admin: "رانيا السعد", plan: "pro", status: "active", users: 12, docs: 67, queries: 318, joined: "2026-05-08", invoice: "paid" },
  { id: 3, name: "مختبر الفحص الوطني", admin: "خالد العمري", plan: "starter", status: "trial", users: 2, docs: 5, queries: 31, joined: "2026-05-22", invoice: "pending" },
  { id: 4, name: "مختبرات أميتك", admin: "سارة حداد", plan: "pro", status: "pending", users: 0, docs: 0, queries: 0, joined: "2026-05-28", invoice: "pending" },
  { id: 5, name: "Jordan Calibration Lab", admin: "Omar Nassar", plan: "starter", status: "paused", users: 3, docs: 18, queries: 89, joined: "2026-04-15", invoice: "paid" },
];

const StatusPill = ({ status }) => {
  const map = {
    active: { label: "نشط", bg: "#064e3b", color: "#6ee7b7" },
    trial: { label: "تجريبي", bg: "#1e3a5f", color: "#93c5fd" },
    pending: { label: "معلّق", bg: "#3b2008", color: "#fcd34d" },
    paused: { label: "موقوف", bg: "#4b0f0f", color: "#fca5a5" },
  };
  const s = map[status] || map.active;
  return (
    <span style={{ padding: "3px 10px", borderRadius: 999, fontSize: 11, fontWeight: 600, background: s.bg, color: s.color }}>
      {s.label}
    </span>
  );
};

const InvoicePill = ({ invoice }) => (
  <span style={{
    padding: "3px 10px", borderRadius: 999, fontSize: 11, fontWeight: 600,
    background: invoice === "paid" ? "#064e3b" : "#3b2008",
    color: invoice === "paid" ? "#6ee7b7" : "#fcd34d",
  }}>
    {invoice === "paid" ? "✓ مدفوع" : "⏳ بانتظار"}
  </span>
);

const MetricCard = ({ label, value, sub, accent }) => (
  <div style={{
    flex: 1, minWidth: 120, background: "#1B2A3D", borderRadius: 12,
    padding: "16px 18px", border: "1px solid #334155",
  }}>
    <div style={{ fontSize: 11, color: "#64748b", marginBottom: 6 }}>{label}</div>
    <div style={{ fontSize: 28, fontWeight: 800, color: accent || "#F59E0B" }}>{value}</div>
    {sub && <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>{sub}</div>}
  </div>
);

export default function AdminDashboard() {
  const [activeTab, setActiveTab] = useState("tenants");
  const [tenants, setTenants] = useState(TENANTS);

  const activeTenants = tenants.filter(t => t.status === "active").length;
  const pendingInvoices = tenants.filter(t => t.invoice === "pending").length;
  const mrr = tenants.filter(t => t.invoice === "paid" && t.status === "active")
    .reduce((s, t) => s + (t.plan === "pro" ? 70 : 35), 0);
  const totalQueries = tenants.reduce((s, t) => s + t.queries, 0);

  const activateTenant = (id) => {
    setTenants(prev => prev.map(t => t.id === id ? { ...t, status: "active", invoice: "paid" } : t));
  };
  const pauseTenant = (id) => {
    setTenants(prev => prev.map(t => t.id === id ? { ...t, status: t.status === "paused" ? "active" : "paused" } : t));
  };

  return (
    <div style={{
      background: "#0F172A", color: "#e2e8f0", minHeight: "100vh",
      fontFamily: "'IBM Plex Arabic', 'Segoe UI', sans-serif", direction: "rtl",
    }}>
      {/* Header */}
      <div style={{
        background: "#1B2A3D", padding: "14px 24px",
        display: "flex", justifyContent: "space-between", alignItems: "center",
        borderBottom: "1px solid #334155",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 32, height: 32, background: "#D97706", borderRadius: 8,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontWeight: 700, fontSize: 13, color: "#fff",
          }}>LB</div>
          <div>
            <span style={{ fontWeight: 700, fontSize: 15 }}>LabBrain Admin</span>
            <span style={{ fontSize: 11, color: "#9ca3af", marginRight: 8 }}>لوحة المؤسس</span>
          </div>
        </div>
        <div style={{ fontSize: 12, color: "#64748b" }}>yousef@labbrain.io</div>
      </div>

      <div style={{ maxWidth: 900, margin: "0 auto", padding: "24px 20px" }}>

        {/* Metrics */}
        <div style={{ display: "flex", gap: 12, marginBottom: 28, flexWrap: "wrap" }}>
          <MetricCard label="المختبرات النشطة" value={activeTenants} sub={`من ${tenants.length} مجموع`} />
          <MetricCard label="الإيراد الشهري (JOD)" value={`${mrr} د.أ`} sub="MRR" accent="#10b981" />
          <MetricCard label="فواتير بانتظار الدفع" value={pendingInvoices} sub="تحتاج تفعيل" accent={pendingInvoices > 0 ? "#f59e0b" : "#6ee7b7"} />
          <MetricCard label="أسئلة هذا الشهر" value={totalQueries} sub="عبر جميع المختبرات" accent="#818cf8" />
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
          {[
            { id: "tenants", label: "المختبرات" },
            { id: "invoices", label: `الفواتير المعلقة${pendingInvoices > 0 ? ` (${pendingInvoices})` : ""}` },
          ].map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)} style={{
              padding: "8px 18px", borderRadius: 8, fontSize: 13, fontWeight: 500,
              background: activeTab === t.id ? "#D97706" : "transparent",
              color: activeTab === t.id ? "#fff" : "#94a3b8",
              border: activeTab === t.id ? "none" : "1px solid #334155",
              cursor: "pointer",
            }}>{t.label}</button>
          ))}
        </div>

        {/* Tenants Table */}
        {activeTab === "tenants" && (
          <div style={{ background: "#1B2A3D", borderRadius: 12, border: "1px solid #334155", overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#0F172A", borderBottom: "1px solid #334155" }}>
                  {["المختبر", "الخطة", "الحالة", "المستخدمون", "الوثائق", "الأسئلة", "الفاتورة", ""].map(h => (
                    <th key={h} style={{ padding: "10px 14px", fontSize: 11, color: "#64748b", fontWeight: 600, textAlign: "right" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tenants.map((t, i) => (
                  <tr key={t.id} style={{ borderBottom: i < tenants.length - 1 ? "1px solid #1e293b" : "none" }}>
                    <td style={{ padding: "12px 14px" }}>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{t.name}</div>
                      <div style={{ fontSize: 11, color: "#64748b" }}>{t.admin}</div>
                    </td>
                    <td style={{ padding: "12px 14px" }}>
                      <span style={{
                        padding: "3px 10px", borderRadius: 999, fontSize: 11, fontWeight: 600,
                        background: t.plan === "pro" ? "#1e3a5f" : "#1a2438", color: "#93c5fd",
                      }}>{t.plan === "pro" ? "Pro" : "Starter"}</span>
                    </td>
                    <td style={{ padding: "12px 14px" }}><StatusPill status={t.status} /></td>
                    <td style={{ padding: "12px 14px", fontSize: 13, color: "#94a3b8" }}>
                      {t.users}/{t.plan === "pro" ? 20 : 5}
                    </td>
                    <td style={{ padding: "12px 14px", fontSize: 13, color: "#94a3b8" }}>
                      {t.docs}/{t.plan === "pro" ? 200 : 50}
                    </td>
                    <td style={{ padding: "12px 14px", fontSize: 13, color: "#94a3b8" }}>{t.queries}</td>
                    <td style={{ padding: "12px 14px" }}><InvoicePill invoice={t.invoice} /></td>
                    <td style={{ padding: "12px 14px" }}>
                      <div style={{ display: "flex", gap: 6 }}>
                        {t.invoice === "pending" && (
                          <button onClick={() => activateTenant(t.id)} style={{
                            padding: "4px 10px", background: "#064e3b", color: "#6ee7b7",
                            border: "none", borderRadius: 6, fontSize: 11, cursor: "pointer", fontWeight: 600,
                          }}>تفعيل</button>
                        )}
                        <button onClick={() => pauseTenant(t.id)} style={{
                          padding: "4px 10px",
                          background: t.status === "paused" ? "#064e3b" : "#4b0f0f",
                          color: t.status === "paused" ? "#6ee7b7" : "#fca5a5",
                          border: "none", borderRadius: 6, fontSize: 11, cursor: "pointer",
                        }}>
                          {t.status === "paused" ? "إعادة تفعيل" : "إيقاف"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Invoices Queue */}
        {activeTab === "invoices" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {tenants.filter(t => t.invoice === "pending").length === 0 && (
              <div style={{
                background: "#1B2A3D", borderRadius: 12, padding: 32,
                textAlign: "center", color: "#64748b", border: "1px solid #334155",
              }}>
                لا توجد فواتير معلقة ✅
              </div>
            )}
            {tenants.filter(t => t.invoice === "pending").map(t => (
              <div key={t.id} style={{
                background: "#1B2A3D", borderRadius: 12, padding: "18px 20px",
                border: "1px solid #D97706", display: "flex",
                justifyContent: "space-between", alignItems: "center",
              }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{t.name}</div>
                  <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>
                    {t.admin} · {t.plan === "pro" ? "Pro — 70 د.أ" : "Starter — 35 د.أ"} · انضم {t.joined}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <div style={{ fontSize: 11, color: "#64748b", textAlign: "center" }}>
                    تأكيد الاستلام<br />بالتحويل البنكي
                  </div>
                  <button onClick={() => activateTenant(t.id)} style={{
                    padding: "10px 20px", background: "#D97706", color: "#fff",
                    border: "none", borderRadius: 8, fontWeight: 700,
                    fontSize: 13, cursor: "pointer",
                  }}>تفعيل الحساب ✓</button>
                </div>
              </div>
            ))}
          </div>
        )}

      </div>
    </div>
  );
}

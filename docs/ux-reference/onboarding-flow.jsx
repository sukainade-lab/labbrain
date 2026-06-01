/**
 * LabBrain — Onboarding Flow Mockup
 * BRD Stories: S1 (Lab Onboarding & Auth), S4 (Pricing & Invoice Request)
 * Loops: auth, money
 *
 * Shows the new lab signup journey:
 * Step 1 → Create account (lab name, admin email, password)
 * Step 2 → Email verification prompt
 * Step 3 → Pricing selection (Starter 35 JOD / Pro 70 JOD)
 * Step 4 → Invoice request form (bank transfer)
 *
 * NOTE: UX reference for Claude Code — not production code.
 */

import { useState } from "react";

const STEPS = [
  { id: 1, label: "إنشاء الحساب" },
  { id: 2, label: "تأكيد البريد" },
  { id: 3, label: "اختيار الخطة" },
  { id: 4, label: "طلب الفاتورة" },
];

const Input = ({ label, placeholder, type = "text", value, onChange }) => (
  <div style={{ marginBottom: 16 }}>
    <label style={{ display: "block", fontSize: 13, color: "#94a3b8", marginBottom: 6 }}>{label}</label>
    <input
      type={type} value={value} onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        width: "100%", padding: "10px 14px", background: "#1B2A3D",
        border: "1px solid #334155", borderRadius: 8, color: "#e2e8f0",
        fontSize: 14, outline: "none", boxSizing: "border-box",
        fontFamily: "'IBM Plex Arabic', sans-serif", direction: "rtl",
      }}
    />
  </div>
);

const PlanCard = ({ plan, price, users, docs, selected, onSelect }) => (
  <div
    onClick={onSelect}
    style={{
      flex: 1, padding: 20, borderRadius: 12, cursor: "pointer",
      background: selected ? "#1e3a5f" : "#1B2A3D",
      border: selected ? "2px solid #D97706" : "1px solid #334155",
      transition: "all 0.15s",
    }}
  >
    <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>{plan}</div>
    <div style={{ fontSize: 28, fontWeight: 800, color: "#F59E0B", marginBottom: 4, direction: "ltr", textAlign: "right" }}>
      {price} <span style={{ fontSize: 14, fontWeight: 400, color: "#9ca3af" }}>د.أ / شهر</span>
    </div>
    <div style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.8 }}>
      <div>{users} مستخدمين</div>
      <div>{docs} وثيقة</div>
      <div>أسئلة وأجوبة غير محدودة</div>
      <div>استشهاد إلزامي بالمصدر</div>
      {plan === "Pro" && <div style={{ color: "#F59E0B" }}>دعم أولوية</div>}
    </div>
    {selected && (
      <div style={{ marginTop: 12, color: "#D97706", fontWeight: 600, fontSize: 13 }}>✓ تم الاختيار</div>
    )}
  </div>
);

export default function OnboardingFlow() {
  const [step, setStep] = useState(1);
  const [labName, setLabName] = useState("");
  const [adminName, setAdminName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [selectedPlan, setSelectedPlan] = useState("starter");
  const [billingName, setBillingName] = useState("");
  const [billingAddress, setBillingAddress] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const canNext = () => {
    if (step === 1) return labName && adminName && email && password;
    if (step === 2) return true;
    if (step === 3) return selectedPlan;
    if (step === 4) return billingName && billingAddress;
    return false;
  };

  if (submitted) return (
    <div style={{
      background: "#0F172A", minHeight: "100vh", display: "flex",
      alignItems: "center", justifyContent: "center",
      fontFamily: "'IBM Plex Arabic', 'Segoe UI', sans-serif", direction: "rtl",
    }}>
      <div style={{ textAlign: "center", maxWidth: 400 }}>
        <div style={{ fontSize: 56, marginBottom: 20 }}>✅</div>
        <h2 style={{ color: "#e2e8f0", fontWeight: 700, fontSize: 22, marginBottom: 8 }}>
          تم إرسال طلبك بنجاح
        </h2>
        <p style={{ color: "#94a3b8", fontSize: 14, lineHeight: 1.7 }}>
          سيصلك بريد إلكتروني بتفاصيل الفاتورة خلال ساعة.
          بعد تأكيد الدفع، يتم تفعيل حساب مختبركم فوراً.
        </p>
        <div style={{
          marginTop: 20, padding: "14px 20px", background: "#1B2A3D",
          borderRadius: 10, border: "1px solid #D97706",
        }}>
          <div style={{ fontSize: 12, color: "#94a3b8" }}>سيرسل المبلغ إلى</div>
          <div style={{ fontWeight: 600, color: "#F59E0B", marginTop: 4 }}>
            Jordan Ahli Bank — IBAN: JO12 ABCD 1234 5678
          </div>
          <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>
            {selectedPlan === "starter" ? "35" : "70"} د.أ شهرياً
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div style={{
      background: "#0F172A", minHeight: "100vh",
      fontFamily: "'IBM Plex Arabic', 'Segoe UI', sans-serif", direction: "rtl",
      display: "flex", flexDirection: "column", alignItems: "center", padding: "32px 16px",
    }}>
      {/* Logo */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 32 }}>
        <div style={{
          width: 36, height: 36, background: "#D97706", borderRadius: 8,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontWeight: 700, fontSize: 15, color: "#fff",
        }}>LB</div>
        <span style={{ fontWeight: 700, fontSize: 18, color: "#e2e8f0" }}>LabBrain</span>
      </div>

      {/* Step indicators */}
      <div style={{ display: "flex", gap: 0, marginBottom: 32, alignItems: "center" }}>
        {STEPS.map((s, i) => (
          <div key={s.id} style={{ display: "flex", alignItems: "center" }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
              <div style={{
                width: 32, height: 32, borderRadius: "50%",
                background: step > s.id ? "#059669" : step === s.id ? "#D97706" : "#1B2A3D",
                border: step === s.id ? "2px solid #F59E0B" : step < s.id ? "1px solid #334155" : "none",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontWeight: 700, fontSize: 13, color: "#fff",
                transition: "all 0.2s",
              }}>
                {step > s.id ? "✓" : s.id}
              </div>
              <span style={{ fontSize: 10, color: step >= s.id ? "#e2e8f0" : "#475569", whiteSpace: "nowrap" }}>
                {s.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div style={{
                width: 40, height: 1, background: step > s.id ? "#059669" : "#334155",
                margin: "0 4px", marginBottom: 20,
              }} />
            )}
          </div>
        ))}
      </div>

      {/* Card */}
      <div style={{
        width: "100%", maxWidth: 460, background: "#1B2A3D",
        borderRadius: 16, padding: 28, border: "1px solid #334155",
      }}>
        {/* Step 1 — Create Account */}
        {step === 1 && (
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4, color: "#e2e8f0" }}>إنشاء حساب مختبرك</h2>
            <p style={{ fontSize: 13, color: "#94a3b8", marginBottom: 20 }}>14 يوم تجريبي مجاناً — لا يلزم بطاقة</p>
            <Input label="اسم المختبر" placeholder="مختبر الأردن للمعايرة" value={labName} onChange={setLabName} />
            <Input label="اسمك الكامل" placeholder="أحمد الخطيب" value={adminName} onChange={setAdminName} />
            <Input label="البريد الإلكتروني للعمل" placeholder="ahmad@lab-jordan.jo" type="email" value={email} onChange={setEmail} />
            <Input label="كلمة المرور" placeholder="8 أحرف على الأقل" type="password" value={password} onChange={setPassword} />
          </div>
        )}

        {/* Step 2 — Email Verification */}
        {step === 2 && (
          <div style={{ textAlign: "center", padding: "12px 0" }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>📧</div>
            <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8, color: "#e2e8f0" }}>تحقق من بريدك الإلكتروني</h2>
            <p style={{ fontSize: 13, color: "#94a3b8", lineHeight: 1.7 }}>
              أرسلنا رابط التأكيد إلى<br />
              <strong style={{ color: "#F59E0B" }}>{email || "ahmad@lab-jordan.jo"}</strong>
            </p>
            <div style={{
              marginTop: 20, padding: 16, background: "#0F172A",
              borderRadius: 10, fontSize: 12, color: "#64748b",
            }}>
              لم يصلك البريد؟ تحقق من مجلد Spam، أو{" "}
              <span style={{ color: "#F59E0B", cursor: "pointer" }}>أعد الإرسال</span>
            </div>
            <p style={{ fontSize: 12, color: "#64748b", marginTop: 16 }}>
              للتجربة: انقر "التالي" لمحاكاة التأكيد
            </p>
          </div>
        )}

        {/* Step 3 — Pricing */}
        {step === 3 && (
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4, color: "#e2e8f0" }}>اختر خطتك</h2>
            <p style={{ fontSize: 13, color: "#94a3b8", marginBottom: 20 }}>
              الدفع بالتحويل البنكي + فاتورة رسمية بالدينار الأردني
            </p>
            <div style={{ display: "flex", gap: 12 }}>
              <PlanCard
                plan="Starter" price={35} users={5} docs={50}
                selected={selectedPlan === "starter"}
                onSelect={() => setSelectedPlan("starter")}
              />
              <PlanCard
                plan="Pro" price={70} users={20} docs={200}
                selected={selectedPlan === "pro"}
                onSelect={() => setSelectedPlan("pro")}
              />
            </div>
            <div style={{ marginTop: 14, padding: "10px 14px", background: "#0F172A", borderRadius: 8, fontSize: 12, color: "#64748b" }}>
              خصم 25% على الاشتراك السنوي — يُطبَّق عند طلب الفاتورة
            </div>
          </div>
        )}

        {/* Step 4 — Invoice Request */}
        {step === 4 && (
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4, color: "#e2e8f0" }}>تفاصيل الفاتورة</h2>
            <p style={{ fontSize: 13, color: "#94a3b8", marginBottom: 20 }}>
              الخطة المختارة: <strong style={{ color: "#F59E0B" }}>
                {selectedPlan === "starter" ? "Starter — 35 د.أ/شهر" : "Pro — 70 د.أ/شهر"}
              </strong>
            </p>
            <Input label="اسم الشركة / المختبر (للفاتورة)" placeholder="مختبر الأردن للمعايرة ش.م.م" value={billingName} onChange={setBillingName} />
            <Input label="العنوان البريدي" placeholder="عمّان، شارع الملك عبدالله، عمارة 12" value={billingAddress} onChange={setBillingAddress} />
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", fontSize: 13, color: "#94a3b8", marginBottom: 6 }}>طريقة الدفع</label>
              <div style={{
                padding: "12px 14px", background: "#0F172A", borderRadius: 8,
                border: "1px solid #334155", fontSize: 13, color: "#e2e8f0",
              }}>
                🏦 تحويل بنكي + فاتورة رسمية (الدينار الأردني)
              </div>
            </div>
          </div>
        )}

        {/* Navigation */}
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 24 }}>
          {step > 1 ? (
            <button onClick={() => setStep(s => s - 1)} style={{
              padding: "10px 20px", background: "transparent",
              border: "1px solid #334155", borderRadius: 8,
              color: "#94a3b8", fontSize: 13, cursor: "pointer",
            }}>
              ← السابق
            </button>
          ) : <div />}
          <button
            onClick={() => step < 4 ? setStep(s => s + 1) : setSubmitted(true)}
            disabled={!canNext()}
            style={{
              padding: "10px 24px",
              background: canNext() ? "#D97706" : "#374151",
              color: "#fff", border: "none", borderRadius: 8,
              fontSize: 14, fontWeight: 600,
              cursor: canNext() ? "pointer" : "default",
            }}
          >
            {step === 4 ? "إرسال طلب الفاتورة ←" : "التالي ←"}
          </button>
        </div>
      </div>

      <p style={{ marginTop: 24, fontSize: 12, color: "#475569", textAlign: "center" }}>
        لديك حساب؟ <span style={{ color: "#F59E0B", cursor: "pointer" }}>تسجيل الدخول</span>
      </p>
    </div>
  );
}

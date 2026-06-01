import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getDashboardStats } from "@/lib/dashboard/stats";
import { captureError } from "@/lib/observability/log";

// GET /api/dashboard — usage counters for the signed-in tenant (AC-4.5):
// documents X/limit, active users X/limit, questions this month. Auth-gated; the
// tenant is resolved from the session, then counts run with the admin client
// (scoped explicitly by tenant_id inside the helpers).
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });

  const { data: me } = await supabase
    .from("users")
    .select("tenant_id")
    .eq("id", user.id)
    .single();
  if (!me) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });

  try {
    const stats = await getDashboardStats(createAdminClient(), me.tenant_id);
    return NextResponse.json(stats);
  } catch (err) {
    captureError("dashboard", err);
    return NextResponse.json({ error: "تعذّر جلب الإحصائيات" }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { ask } from "@/lib/qa/ask";

// AC-3.1 — a question in either language; non-empty, bounded length.
const qaSchema = z.object({
  question: z.string().trim().min(1, "السؤال مطلوب").max(2000, "السؤال طويل جداً")
});

// POST /api/qa — retrieve tenant chunks, answer with mandatory citation, log the
// Q&A (AC-3.1…3.7). Runs on the user-scoped client so tenant isolation (RLS +
// current_tenant_id()) holds for both retrieval and the audit insert.
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = qaSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" },
      { status: 400 }
    );
  }

  const { data: me } = await supabase
    .from("users")
    .select("tenant_id")
    .eq("id", user.id)
    .single();
  if (!me) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });

  try {
    const result = await ask({
      supabase,
      tenantId: me.tenant_id,
      userId: user.id,
      question: parsed.data.question
    });
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "تعذّرت معالجة السؤال" }, { status: 500 });
  }
}

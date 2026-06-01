import { NextResponse } from "next/server";

// AC-5.1 — GET /api/health → 200 with { status, version, uptime_seconds }, < 200ms.
export const dynamic = "force-dynamic";

const VERSION = "1.0.0";

export function GET() {
  return NextResponse.json({
    status: "ok",
    version: VERSION,
    uptime_seconds: Math.floor(process.uptime())
  });
}

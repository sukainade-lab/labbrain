import { describe, it, expect } from "vitest";
import {
  computeMrrJod,
  summarizeOverview,
  type TenantOverviewRow
} from "@/lib/founder/stats";

// S8 — AC-8.2 / AC-8.3: pure summarization of the cross-tenant overview rows into
// the four founder metric cards. The RPC that produces these rows is exercised
// against live Supabase in the L2 suite (story-8-founder-db); here we pin the
// math: MRR run-rate (monthly vs annual), pending-invoice count, totals.

function row(over: Partial<TenantOverviewRow>): TenantOverviewRow {
  return {
    tenant_id: "t",
    name: "Lab",
    plan: "starter",
    status: "active",
    created_at: "2026-06-01T00:00:00Z",
    owner_email: "owner@lab.com",
    user_count: 1,
    doc_count: 0,
    questions_this_month: 0,
    active_interval: "month",
    ...over
  };
}

describe("computeMrrJod", () => {
  it("@AC-8.2 sums monthly active tenants at list price (starter 35 + pro 70)", () => {
    const rows = [row({ plan: "starter" }), row({ plan: "pro" })];
    expect(computeMrrJod(rows)).toBe(105);
  });

  it("@AC-8.2 annual subs contribute discounted monthly-equivalent, not the annual total", () => {
    // pro annual: 70 × (1 − 0.25) = 52.5 monthly-equivalent
    expect(computeMrrJod([row({ plan: "pro", active_interval: "year" })])).toBe(52.5);
  });

  it("@AC-8.2 excludes non-active tenants from MRR", () => {
    const rows = [
      row({ plan: "pro", status: "active" }),
      row({ plan: "pro", status: "inactive" }),
      row({ plan: "starter", status: "paused" }),
      row({ plan: "starter", status: "past_due" })
    ];
    expect(computeMrrJod(rows)).toBe(70);
  });

  it("@AC-8.2 null interval falls back to monthly", () => {
    expect(computeMrrJod([row({ plan: "starter", active_interval: null })])).toBe(35);
  });

  it("@AC-8.2 no active tenants → 0", () => {
    expect(computeMrrJod([row({ status: "inactive" })])).toBe(0);
  });
});

describe("summarizeOverview", () => {
  it("@AC-8.3 counts active tenants, pending invoices, sums questions", () => {
    const rows = [
      row({ status: "active", plan: "starter", questions_this_month: 12 }),
      row({ status: "active", plan: "pro", questions_this_month: 30 }),
      row({ status: "inactive", questions_this_month: 0 }),
      row({ status: "inactive", questions_this_month: 3 }),
      row({ status: "paused", questions_this_month: 5 })
    ];
    expect(summarizeOverview(rows)).toEqual({
      activeTenants: 2,
      mrrJod: 105,
      pendingInvoices: 2, // only 'inactive' — 'paused' is not pending
      questionsThisMonth: 50
    });
  });

  it("@AC-8.3 empty platform → all zeros", () => {
    expect(summarizeOverview([])).toEqual({
      activeTenants: 0,
      mrrJod: 0,
      pendingInvoices: 0,
      questionsThisMonth: 0
    });
  });
});

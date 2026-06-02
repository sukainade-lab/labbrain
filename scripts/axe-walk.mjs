#!/usr/bin/env node
// LabBrain — seeded-session axe-walk harness (Sprint 6 retro QA infra, lesson L7).
//
// WHY THIS EXISTS
// L7 caps QA at 9 for any UI story whose a11y verification is "static" (computed
// contrast + tap-target audit) instead of a live 375px + axe-core walk on the
// new surface. On auth/role-gated surfaces (/admin, /founder) the live walk is
// expensive to stand up by hand — you must seed a session, render real tenant
// rows, drive a browser — so it kept getting deferred to static (S10 → QA cap).
// This harness makes that walk a single command: it seeds a privileged session,
// signs in through the real login form, and runs axe-core at a 375px viewport
// against the gated surfaces. Run it during /4-eo-review so every gated-UI story
// clears L7 with a REAL walk.
//
// WHAT IT IS / IS NOT
// - It is a LOCAL, opt-in tool. It is NOT part of `npm test` and never runs in
//   CI (CI has no Chromium and no seeded session). The CI a11y gate stays the
//   static contrast guard (tests/a11y-button-contrast.test.ts).
// - It drives a real browser via puppeteer-core (already a dep, used by the PDF
//   render seam) against your locally-running dev server. It seeds its own user
//   + tenant via the service-role key and cleans them up afterward.
//
// PREREQUISITES
//   1. Local Supabase up + .env.local populated (NEXT_PUBLIC_SUPABASE_URL,
//      NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, PLATFORM_ADMIN_EMAILS).
//   2. The app running:  npm run dev   (default http://localhost:3000)
//   3. A local Chromium/Chrome. Set PUPPETEER_EXECUTABLE_PATH (or CHROMIUM_PATH),
//      else the harness probes the usual OS install locations.
//
// USAGE
//   npm run axe:walk                       # walk the default gated routes
//   npm run axe:walk -- /admin /founder    # walk specific routes
//   APP_URL=http://localhost:3001 npm run axe:walk
//   npm run axe:walk -- --keep             # don't delete the seeded user/tenant
//   npm run axe:walk -- --headed           # show the browser (debug)
//
// EXIT CODES: 0 = every route clean · 1 = a11y violations found · 2 = setup error.

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { createClient } from "@supabase/supabase-js";
import puppeteer from "puppeteer-core";

const require = createRequire(import.meta.url);

// ---- tiny .env.local loader (mirrors tests/setup.ts; real env wins) ----------
function loadEnvLocal() {
  try {
    const raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
    for (const line of raw.split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq === -1) continue;
      const key = t.slice(0, eq).trim();
      let val = t.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = val;
    }
  } catch {
    /* no .env.local — the env checks below will explain what's missing */
  }
}

// ---- config ------------------------------------------------------------------
const DEFAULT_ROUTES = ["/dashboard", "/admin", "/founder"];
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const VIEWPORT = { width: 375, height: 812, deviceScaleFactor: 2, isMobile: true };
const PASSWORD = "Axe-Walk-Passw0rd!";
const NAV_TIMEOUT = 30_000;

function parseArgs(argv) {
  const routes = [];
  let keep = false;
  let headed = false;
  for (const a of argv) {
    if (a === "--keep") keep = true;
    else if (a === "--headed") headed = true;
    else if (a.startsWith("/")) routes.push(a);
  }
  return { routes: routes.length ? routes : DEFAULT_ROUTES, keep, headed };
}

// Resolve a Chromium/Chrome binary the same way the PDF render seam does, then
// fall back to the usual per-OS install locations so the harness "just works".
function resolveChromium() {
  const explicit = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROMIUM_PATH;
  if (explicit && existsSync(explicit)) return explicit;
  const candidates = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser"
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
}

// The seeded admin email MUST be on the server's PLATFORM_ADMIN_EMAILS allowlist,
// otherwise /founder 404s and the walk would silently grade the wrong page. We
// read the SAME allowlist the server reads (.env.local) and pick the first
// .test address — guarding against ever deleting/recreating a real founder login.
function pickAdminEmail() {
  const raw = process.env.PLATFORM_ADMIN_EMAILS ?? "";
  const allow = raw.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  const testEmail = allow.find((e) => e.endsWith(".test"));
  if (testEmail) return { email: testEmail, allow };
  return { email: "founder@labbrain.test", allow };
}

function die(code, msg) {
  console.error(`\n✖ ${msg}`);
  process.exit(code);
}

// ---- seeding (service-role; mirrors tests/story-8-founder-db.test.ts) ---------
async function seedSession(admin, email) {
  // Idempotent: a prior aborted run may have left the user. Only ever touch a
  // .test address (guaranteed by pickAdminEmail), so this is safe.
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const tenantName = `Axe Walk Lab ${stamp}`;

  // Delete any pre-existing auth user with this email (list → match → delete).
  try {
    const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
    const existing = list?.users?.find((u) => u.email?.toLowerCase() === email);
    if (existing) {
      await admin.from("users").delete().eq("id", existing.id);
      await admin.auth.admin.deleteUser(existing.id);
    }
  } catch {
    /* best-effort cleanup of a stale seed */
  }

  const { data: tenantRow, error: tErr } = await admin
    .from("tenants")
    .insert({ name: tenantName, plan: "pro", status: "active" })
    .select("id")
    .single();
  if (tErr) throw new Error(`seed tenant failed: ${tErr.message}`);
  const tenantId = tenantRow.id;

  const { data: created, error: uErr } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true
  });
  if (uErr) throw new Error(`seed auth user failed: ${uErr.message}`);
  const userId = created.user.id;

  const { error: rowErr } = await admin
    .from("users")
    .insert({ id: userId, tenant_id: tenantId, email, role: "owner" });
  if (rowErr) throw new Error(`seed users row failed: ${rowErr.message}`);

  // A couple of rows so the gated tables render real content (not just empty
  // states) — a more honest surface for axe to inspect.
  await admin.from("documents").insert([
    { tenant_id: tenantId, filename: "iso17025.pdf", storage_path: `${tenantId}/a` }
  ]);
  await admin.from("queries").insert([
    { tenant_id: tenantId, question_text: "ما هو بند المعايرة؟" }
  ]);

  return { tenantId, userId };
}

async function cleanup(admin, seed) {
  if (!seed) return;
  const { tenantId, userId } = seed;
  try {
    await admin.from("subscriptions").delete().eq("tenant_id", tenantId);
    await admin.from("queries").delete().eq("tenant_id", tenantId);
    await admin.from("documents").delete().eq("tenant_id", tenantId);
    await admin.from("tenant_migrations").delete().eq("tenant_id", tenantId);
    await admin.from("users").delete().eq("id", userId);
    await admin.from("tenants").delete().eq("id", tenantId);
    await admin.auth.admin.deleteUser(userId);
  } catch {
    /* best-effort */
  }
}

// ---- browser walk ------------------------------------------------------------
async function login(page, appUrl, email) {
  await page.goto(`${appUrl}/login`, { waitUntil: "networkidle0", timeout: NAV_TIMEOUT });
  await page.waitForSelector('input[type="email"]', { timeout: NAV_TIMEOUT });
  await page.type('input[type="email"]', email);
  await page.type('input[type="password"]', PASSWORD);
  await Promise.all([
    page.waitForFunction(() => !location.pathname.startsWith("/login"), { timeout: NAV_TIMEOUT }),
    page.click('button[type="submit"]')
  ]);
}

async function runAxe(page, axeSource) {
  await page.evaluate(axeSource);
  return page.evaluate(async (tags) => {
    const res = await window.axe.run(document, { runOnly: { type: "tag", values: tags } });
    return {
      violations: res.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        help: v.help,
        helpUrl: v.helpUrl,
        nodes: v.nodes.map((n) => ({ target: n.target, summary: n.failureSummary }))
      })),
      passes: res.passes.length
    };
  }, AXE_TAGS);
}

async function walk(page, appUrl, routes, axeSource) {
  const results = [];
  for (const route of routes) {
    const url = `${appUrl}${route}`;
    const resp = await page.goto(url, { waitUntil: "networkidle0", timeout: NAV_TIMEOUT });
    const status = resp ? resp.status() : 0;
    const landed = new URL(page.url()).pathname;

    // Guard against grading the wrong page: a gated route that bounced us to
    // /login (session not established) or 404'd (allowlist mismatch) is a SETUP
    // failure, not an a11y pass.
    if (landed.startsWith("/login")) {
      results.push({ route, setupError: `redirected to /login (no session) — landed ${landed}` });
      continue;
    }
    if (status === 404 || landed.startsWith("/account-paused")) {
      results.push({ route, setupError: `gate rejected access (status ${status}, landed ${landed})` });
      continue;
    }

    const axe = await runAxe(page, axeSource);
    results.push({ route, status, landed, ...axe });
  }
  return results;
}

function report(results) {
  let violationCount = 0;
  let setupErrors = 0;
  console.log("\n══════ axe-walk @375px (wcag2a + wcag2aa) ══════\n");
  for (const r of results) {
    if (r.setupError) {
      setupErrors++;
      console.log(`  ⚠ ${r.route.padEnd(12)} SETUP ERROR — ${r.setupError}`);
      continue;
    }
    if (r.violations.length === 0) {
      console.log(`  ✓ ${r.route.padEnd(12)} 0 violations · ${r.passes} passes`);
      continue;
    }
    violationCount += r.violations.length;
    console.log(`  ✖ ${r.route.padEnd(12)} ${r.violations.length} violation(s) · ${r.passes} passes`);
    for (const v of r.violations) {
      console.log(`      • [${v.impact}] ${v.id} — ${v.help}`);
      for (const n of v.nodes) {
        console.log(`          ${JSON.stringify(n.target)}`);
        if (n.summary) console.log(`          ${n.summary.replace(/\n/g, "\n          ")}`);
      }
      console.log(`          ${v.helpUrl}`);
    }
  }
  console.log("");
  return { violationCount, setupErrors };
}

// ---- main --------------------------------------------------------------------
async function main() {
  loadEnvLocal();
  const { routes, keep, headed } = parseArgs(process.argv.slice(2));
  const appUrl = (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    die(2, "Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — start local Supabase and populate .env.local.");
  }

  const exec = resolveChromium();
  if (!exec) {
    die(2, "No Chromium found. Set PUPPETEER_EXECUTABLE_PATH (or CHROMIUM_PATH) to your Chrome/Chromium binary.");
  }

  // Preflight: app reachable?
  try {
    const res = await fetch(`${appUrl}/api/health`);
    if (!res.ok) throw new Error(`health ${res.status}`);
  } catch (e) {
    die(2, `App not reachable at ${appUrl} (${e.message}). Run \`npm run dev\` first, or set APP_URL.`);
  }

  const { email, allow } = pickAdminEmail();
  if (!allow.includes(email)) {
    console.warn(
      `⚠ Seeded admin ${email} is NOT in PLATFORM_ADMIN_EMAILS (${allow.join(", ") || "empty"}). ` +
        `/founder will 404 and be reported as a setup error. Add ${email} to the allowlist in .env.local.`
    );
  }

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  console.log(`→ App:    ${appUrl}`);
  console.log(`→ Chrome: ${exec}`);
  console.log(`→ User:   ${email} (owner + platform-admin)`);
  console.log(`→ Routes: ${routes.join(", ")}`);

  let seed = null;
  let browser = null;
  let exitCode = 0;
  try {
    seed = await seedSession(admin, email);
    browser = await puppeteer.launch({
      executablePath: exec,
      headless: !headed,
      args: ["--no-sandbox", "--disable-setuid-sandbox"]
    });
    const page = await browser.newPage();
    await page.setViewport(VIEWPORT);
    await login(page, appUrl, email);

    const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
    const results = await walk(page, appUrl, routes, axeSource);
    const { violationCount, setupErrors } = report(results);

    if (setupErrors > 0) {
      console.log(`✖ ${setupErrors} route(s) had a setup error — fix before trusting the walk.`);
      exitCode = 2;
    } else if (violationCount > 0) {
      console.log(`✖ ${violationCount} a11y violation(s) across gated surfaces.`);
      exitCode = 1;
    } else {
      console.log("✓ All gated surfaces pass axe-core (wcag2a + wcag2aa) at 375px.");
    }
  } catch (e) {
    console.error(`\n✖ Harness error: ${e.stack || e.message}`);
    exitCode = 2;
  } finally {
    if (browser) await browser.close();
    if (!keep) await cleanup(admin, seed);
    else if (seed) console.log(`\n(kept seed: tenant ${seed.tenantId}, user ${email})`);
  }
  process.exit(exitCode);
}

main();

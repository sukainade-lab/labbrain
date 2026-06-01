import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Load .env.local into process.env for tests (vitest doesn't read it the way
// Next.js does). Lines are KEY=VALUE; blank lines and # comments are ignored.
// Existing process.env values win, so CI can override.
try {
  const raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
} catch {
  // No .env.local — integration tests that need it will skip themselves.
}

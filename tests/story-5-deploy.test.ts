import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// Story 5 — AC-5.2 / AC-5.3. The live deploy to the Contabo VPS is founder-gated,
// so we verify the deploy infrastructure at the config level: the files exist and
// declare the contract (standalone image, app+caddy compose, auto-SSL proxy →
// :3000, zero-downtime health-gated roll). The runtime ACs (5.1 health, 5.4
// Sentry, 5.5 PostHog, 5.6 env-contract, 5.7 RLS) are covered in their own files.

const ROOT = resolve(__dirname, "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

describe("@AC-5.2 Contabo deploy via docker-compose", () => {
  it("ships a Dockerfile that builds the Next standalone image", () => {
    const df = read("Dockerfile");
    expect(df).toMatch(/FROM node:22-alpine/);
    expect(df).toMatch(/\.next\/standalone/);
    expect(df).toMatch(/CMD \["node", "server\.js"\]/);
    // next.config.mjs must emit standalone for the Dockerfile copy to exist.
    expect(read("next.config.mjs")).toMatch(/output:\s*["']standalone["']/);
  });

  it("docker-compose defines the app + caddy services with restart policy", () => {
    const compose = read("docker-compose.yml");
    expect(compose).toMatch(/^\s{2}app:/m);
    expect(compose).toMatch(/^\s{2}caddy:/m);
    expect(compose).toMatch(/restart:\s*unless-stopped/);
    // App reads production secrets from an env_file on the VPS, never baked in.
    expect(compose).toMatch(/env_file:/);
    expect(compose).toMatch(/\.env/);
  });

  it("deploy.sh does a health-gated, zero-downtime roll with rollback", () => {
    const sh = read("deploy.sh");
    expect(sh).toMatch(/docker compose build app/);
    expect(sh).toMatch(/--no-deps --wait app/);
    expect(sh).toMatch(/\/api\/health/);
    expect(sh).toMatch(/rollback/);
  });
});

describe("@AC-5.3 Caddy reverse proxy with auto-SSL", () => {
  it("has a Caddyfile that proxies the domain to the Next app on :3000", () => {
    expect(existsSync(resolve(ROOT, "Caddyfile"))).toBe(true);
    const caddy = read("Caddyfile");
    // Domain comes from the environment; Caddy auto-provisions Let's Encrypt TLS
    // for any real (non-localhost) hostname with no extra config.
    expect(caddy).toMatch(/\{\$LABBRAIN_DOMAIN\}/);
    expect(caddy).toMatch(/reverse_proxy app:3000/);
  });

  it("compose exposes 80 + 443 and mounts the Caddyfile + cert volume", () => {
    const compose = read("docker-compose.yml");
    expect(compose).toMatch(/"80:80"/);
    expect(compose).toMatch(/"443:443"/);
    expect(compose).toMatch(/Caddyfile:\/etc\/caddy\/Caddyfile/);
    expect(compose).toMatch(/caddy_data:/);
  });
});

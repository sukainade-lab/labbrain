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

describe("@AC-5.2 deploy hardening (pre-cutover audit)", () => {
  it("a .dockerignore keeps secrets + cruft out of the build context", () => {
    // The Dockerfile builder does `COPY . .`; without this the VPS .env would be
    // baked into the builder image layer. Assert env files + heavy dirs excluded.
    expect(existsSync(resolve(ROOT, ".dockerignore"))).toBe(true);
    const di = read(".dockerignore");
    expect(di).toMatch(/^\.env$/m);
    expect(di).toMatch(/^\.env\.local$/m);
    expect(di).toMatch(/^node_modules$/m);
    expect(di).toMatch(/^\.git$/m);
    expect(di).toMatch(/^\.next$/m);
  });

  it("compose pins a stable app image tag so rollback can reference it", () => {
    expect(read("docker-compose.yml")).toMatch(/image:\s*labbrain-app:latest/);
  });

  it("deploy.sh uses a real previous-image rollback, not the non-existent `compose rollback`", () => {
    const sh = read("deploy.sh");
    // The old script called `docker compose rollback` — not a real subcommand.
    expect(sh).not.toMatch(/docker compose rollback/);
    // Real strategy: tag the running image before build, retag it back on failure.
    expect(sh).toMatch(/labbrain-app:rollback/);
    expect(sh).toMatch(/docker tag/);
  });

  it("deploy.sh refuses to ship until prod DB migrations are confirmed applied", () => {
    const sh = read("deploy.sh");
    // Supabase is hosted/external — migrations must be pushed before code deploys.
    expect(sh).toMatch(/MIGRATIONS_APPLIED/);
    expect(sh).toMatch(/supabase db push/);
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

-- S7 — Optional SMS 2FA (second factor) via Unifonic, Jordan numbers.
--
-- Email/password (Supabase Auth) stays the PRIMARY factor. This migration adds an
-- OPTIONAL second factor a user can opt into on their own account (per-user opt-in;
-- tenant-enforced policy is an S7 follow-up). Two pieces:
--   1. users.* — the enrollment state (phone + whether 2FA is on + when verified)
--   2. mfa_challenges — short-lived OTP challenges (login | enroll | disable)
--
-- Security model (matches subscriptions: server-side writes via the service role):
--   • Challenges hold a HASH of the code, never the plaintext (AC-7.2).
--   • RLS is ENABLED on mfa_challenges with NO policies, so the anon/auth client can
--     never read or write a challenge — every access goes through the service role in
--     the /api/auth/2fa/* handlers (AC-7.5 fail-closed). users keeps its existing
--     policies from 0002; the new columns ride along under those.

-- ── 1. Enrollment state on users ─────────────────────────────────────────────
-- phone is stored E.164 (+9627XXXXXXXX). mfa_enabled flips true ONLY after a
-- successful enrollment OTP round-trip (AC-7.1) — never on phone-save alone.
alter table users add column phone text;
alter table users add column mfa_enabled boolean not null default false;
alter table users add column phone_verified_at timestamptz;

-- ── 2. OTP challenges (login | enroll | disable) ─────────────────────────────
-- One row per issued code. code_hash is HMAC-SHA256(code, MFA_COOKIE_SECRET) — the
-- plaintext never lands in the DB. attempts counts wrong guesses against this
-- challenge; consumed_at marks single-use (a correct verify or a disable burns it).
create table mfa_challenges (
  id            uuid primary key default uuid_generate_v4(),
  user_id       uuid not null references users(id) on delete cascade,
  purpose       text not null check (purpose in ('login', 'enroll', 'disable')),
  code_hash     text not null,
  expires_at    timestamptz not null,
  attempts      int not null default 0,
  consumed_at   timestamptz,
  created_at    timestamptz not null default now()
);

-- Lookups resolve the newest live challenge for a user (send-cooldown + verify both
-- query by user, newest-first), so index (user_id, created_at desc).
create index mfa_challenges_user_idx on mfa_challenges (user_id, created_at desc);

-- ── 3. RLS: enabled, no policies → client can never touch challenges ──────────
-- Deliberately policy-less. With RLS on and zero policies, every non-service-role
-- read/write returns nothing / is denied. The service role bypasses RLS, so only the
-- server-side 2FA handlers can issue, read, and consume challenges (AC-7.5).
alter table mfa_challenges enable row level security;

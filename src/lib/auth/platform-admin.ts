// AC-8.1 — the founder / platform-admin gate.
//
// LabBrain has no platform super-admin ROLE: users.role is tenant-scoped
// (owner/admin/member) and every RLS policy keys on tenant_id. Adding a role
// column value would let a tenant user be flipped to super-admin inside one
// tenant's data — the wrong trust boundary. Instead, platform access is granted
// by a server-side env allowlist (PLATFORM_ADMIN_EMAILS), evaluated only on the
// server, never bundled to the client (no NEXT_PUBLIC_ prefix). This is the
// ENTIRE security boundary for the cross-tenant founder panel, so it fails
// closed: no allowlist, no match, or no email → not an admin.

/** Parse the comma-separated allowlist into normalized (trimmed, lowercased) emails. */
export function parsePlatformAdmins(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * True only when `email` is on the PLATFORM_ADMIN_EMAILS allowlist. Matching is
 * case-insensitive and whitespace-tolerant. Fails closed on any missing input.
 */
export function isPlatformAdmin(
  email: string | null | undefined,
  raw: string | undefined = process.env.PLATFORM_ADMIN_EMAILS
): boolean {
  if (!email) return false;
  return parsePlatformAdmins(raw).includes(email.trim().toLowerCase());
}

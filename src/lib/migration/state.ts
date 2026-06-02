// S10 — the migration run state machine (AC-10.6). Status advances monotonically
// along the success path; any non-terminal state can fail; cutover and failed are
// terminal. Encoding the legal transitions here (not scattered across routes) is
// what makes "no double-cutover" and "a re-invoked run resumes safely" checkable.

export const MIGRATION_STATES = [
  "pending",
  "exported",
  "imported",
  "verified",
  "cutover",
  "failed"
] as const;

export type MigrationStatus = (typeof MIGRATION_STATES)[number];

// The linear success path. cutover/failed are absent → terminal.
const SUCCESS_PATH: MigrationStatus[] = ["pending", "exported", "imported", "verified", "cutover"];

export function isTerminal(status: MigrationStatus): boolean {
  return status === "cutover" || status === "failed";
}

// The single legal forward step from a status, or null if terminal.
export function nextState(status: MigrationStatus): MigrationStatus | null {
  const i = SUCCESS_PATH.indexOf(status);
  if (i === -1 || i === SUCCESS_PATH.length - 1) return null;
  return SUCCESS_PATH[i + 1];
}

// A transition is legal iff: it's the one forward step on the success path, OR
// it's a non-terminal state failing. Backwards, skip-ahead, and any move out of a
// terminal state are all rejected.
export function canTransition(from: MigrationStatus, to: MigrationStatus): boolean {
  if (isTerminal(from)) return false;
  if (to === "failed") return true;
  return nextState(from) === to;
}

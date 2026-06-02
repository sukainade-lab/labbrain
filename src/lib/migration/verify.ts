// S10 — parity verification (AC-10.4). Reduces source↔target equality to two
// comparable values: per-table row counts and the deterministic content checksum
// (from bundle.ts). A mismatch yields a human-readable diff and BLOCKS cutover —
// the source stays authoritative, zero data loss.

export interface ParitySide {
  checksum: string;
  rowCounts: Record<string, number>;
}

export interface ParityInput {
  source: ParitySide;
  target: ParitySide;
}

export interface ParityResult {
  match: boolean;
  diff: string[];
}

export function compareParity({ source, target }: ParityInput): ParityResult {
  const diff: string[] = [];

  const tables = new Set([
    ...Object.keys(source.rowCounts),
    ...Object.keys(target.rowCounts)
  ]);
  for (const table of [...tables].sort()) {
    const s = source.rowCounts[table] ?? 0;
    const t = target.rowCounts[table] ?? 0;
    if (s !== t) diff.push(`${table}: source ${s} ≠ target ${t}`);
  }

  if (source.checksum !== target.checksum) {
    diff.push(`checksum: source ${source.checksum} ≠ target ${target.checksum}`);
  }

  return { match: diff.length === 0, diff };
}

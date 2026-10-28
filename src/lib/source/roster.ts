import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { sanitizeName } from './sanitize';
import type { ParsedTeam } from './types';

export const MAX_ROSTER_BYTES = 64 * 1024;

/** Names only (D33): no members, no emails, no other fields. `strict` rejects anything else. */
export const rosterSchema = z.strictObject({
  teams: z
    .array(z.strictObject({ teamId: z.string().regex(/^[\x21-\x7e]{1,64}$/), displayName: z.string().min(1).max(200) }))
    .max(200),
});

export type Roster = z.infer<typeof rosterSchema>;

export function parseRoster(raw: unknown): Roster {
  const r = rosterSchema.parse(raw);
  const ids = new Set<string>();
  for (const t of r.teams) {
    if (ids.has(t.teamId)) throw new Error('roster: duplicate teamId');
    ids.add(t.teamId);
    if (!sanitizeName(t.displayName)) throw new Error('roster: empty display name');
  }
  return r;
}

/** Returns null when the file does not exist (the roster is optional). Throws on a malformed or oversized file. */
export function loadRoster(file = path.resolve(process.cwd(), 'data', 'roster.json')): Roster | null {
  if (!fs.existsSync(file)) return null;
  if (fs.statSync(file).size > MAX_ROSTER_BYTES) throw new Error('roster: file too large');
  return parseRoster(JSON.parse(fs.readFileSync(file, 'utf8')));
}

/** Overrides display names only. Ids, totals and everything else come from the source untouched. */
export function applyRoster<T extends ParsedTeam>(teams: readonly T[], roster: Roster | null): { teams: T[]; matched: number } {
  if (!roster) return { teams: [...teams], matched: 0 };
  const names = new Map(roster.teams.map((t) => [t.teamId, sanitizeName(t.displayName)]));
  let matched = 0;
  const out = teams.map((t) => {
    const n = names.get(t.teamId);
    if (!n) return t;
    matched++;
    return { ...t, name: n };
  });
  return { teams: out, matched };
}

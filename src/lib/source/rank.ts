import type { ParsedTeam, RankedTeam } from './types';

/** Stores keep 3 decimals (numeric(14,3)); ranking compares at the same precision so live and stored ranks agree. */
const totalKey = (v: number) => Math.round(v * 1000);

/**
 * Competition ranking ("1, 2, 2, 4"): `total` descending, equal totals share a rank and are `tied`. Secondary order is
 * the source order, which keeps the list deterministic. `rankDelta` = previous rank - current rank.
 */
export function rankTeams(teams: readonly ParsedTeam[], previousRanks?: ReadonlyMap<string, number>): RankedTeam[] {
  const sorted = teams
    .map((t, i) => ({ t, i, k: totalKey(t.total) }))
    // Source index is unique, so it fully determines equal-total order; no name comparison is needed.
    .sort((a, b) => b.k - a.k || a.i - b.i)
    .map((x) => x.t);

  const out: RankedTeam[] = [];
  let groupStart = 0;
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && totalKey(sorted[i].total) !== totalKey(sorted[i - 1].total)) groupStart = i;
    const rank = groupStart + 1;
    const prev = previousRanks?.get(sorted[i].teamId);
    out.push({ ...sorted[i], rank, tied: false, ...(prev !== undefined ? { rankDelta: prev - rank } : {}) });
  }
  for (let i = 0; i < out.length; i++) {
    out[i].tied = (i > 0 && out[i - 1].rank === out[i].rank) || (i < out.length - 1 && out[i + 1].rank === out[i].rank);
  }
  return out;
}

export type RoundDecision = 'new' | 'same' | 'older';

/** A round going backwards (source restart, stale mirror) must never overwrite stored history. */
export function decideRound(lastStored: number | undefined, incoming: number): RoundDecision {
  if (lastStored === undefined || incoming > lastStored) return 'new';
  return incoming === lastStored ? 'same' : 'older';
}

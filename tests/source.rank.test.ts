import { describe, expect, it } from 'vitest';
import { decideRound, rankTeams } from '../src/lib/source/rank';
import type { ParsedTeam } from '../src/lib/source/types';

const t = (teamId: string, total: number, name = teamId): ParsedTeam => ({ teamId, name, total });

describe('rankTeams', () => {
  it('sorts by total descending and ties share the better rank', () => {
    const r = rankTeams([t('a', 10), t('b', 20), t('c', 20), t('d', 5)]);
    expect(r.map((x) => [x.teamId, x.rank, x.tied])).toEqual([
      ['b', 1, true],
      ['c', 1, true],
      ['a', 3, false],
      ['d', 4, false],
    ]);
  });

  it('1,2,2,4 shape', () => {
    const r = rankTeams([t('a', 30), t('b', 20), t('c', 20), t('d', 5)]);
    expect(r.map((x) => x.rank)).toEqual([1, 2, 2, 4]);
    expect(r.map((x) => x.tied)).toEqual([false, true, true, false]);
  });

  it('three-way tie at the top', () => {
    const r = rankTeams([t('a', 7), t('b', 7), t('c', 7), t('d', 1)]);
    expect(r.map((x) => x.rank)).toEqual([1, 1, 1, 4]);
  });

  it('orders equal totals by source order, deterministically', () => {
    const a = rankTeams([t('x', 5, 'Zed'), t('y', 5, 'Amy')]).map((x) => x.teamId);
    const b = rankTeams([t('x', 5, 'Zed'), t('y', 5, 'Amy')]).map((x) => x.teamId);
    expect(a).toEqual(['x', 'y']);
    expect(b).toEqual(a);
  });

  it('computes rankDelta = previous - current and omits it without history', () => {
    const prev = new Map([['a', 3], ['b', 1]]);
    const r = rankTeams([t('a', 50), t('b', 40), t('c', 10)], prev);
    expect(r.find((x) => x.teamId === 'a')?.rankDelta).toBe(2); // 3 -> 1, moved up
    expect(r.find((x) => x.teamId === 'b')?.rankDelta).toBe(-1); // 1 -> 2, moved down
    expect('rankDelta' in r.find((x) => x.teamId === 'c')!).toBe(false);
  });

  it('compares at the 3-decimal precision the store keeps', () => {
    const r = rankTeams([t('a', 1.0001), t('b', 1.0004), t('c', 0.3), t('d', 0.1 + 0.2)]);
    expect(r.map((x) => x.rank)).toEqual([1, 1, 3, 3]);
    expect(r.map((x) => x.tied)).toEqual([true, true, true, true]);
  });

  it('does not mutate its input', () => {
    const input = [t('a', 1), t('b', 2)];
    rankTeams(input);
    expect(input.map((x) => x.teamId)).toEqual(['a', 'b']);
  });

  it('handles an empty list', () => {
    expect(rankTeams([])).toEqual([]);
  });
});

describe('decideRound', () => {
  it('accepts new, recognises same, ignores older', () => {
    expect(decideRound(undefined, 0)).toBe('new');
    expect(decideRound(5, 6)).toBe('new');
    expect(decideRound(5, 5)).toBe('same');
    expect(decideRound(5, 4)).toBe('older');
  });
});

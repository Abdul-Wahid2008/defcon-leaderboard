import { describe, it, expect } from 'vitest';
import { computeState, isFrozen, type StateInput } from '../src/lib/state';

const base: StateInput = { now: 1000, startMs: 0, freezeMs: 5000, revealed: false, hasVisibleData: true, lastOkAt: 990, failures: 0, staleAfterMs: 100 };

describe('computeState (injected clock)', () => {
  const rows: [string, Partial<StateInput>, string][] = [
    ['before start, with data', { now: -1, startMs: 0 }, 'pre_event'],
    ['before start, no data', { now: -1, hasVisibleData: false }, 'pre_event'],
    ['no start configured, no data, no failures yet', { startMs: undefined, hasVisibleData: false, lastOkAt: undefined }, 'pre_event'],
    ['no start configured, no data, source failing', { startMs: undefined, hasVisibleData: false, lastOkAt: undefined, failures: 3 }, 'unavailable'],
    ['started, no data at all', { hasVisibleData: false, lastOkAt: undefined }, 'unavailable'],
    ['live', {}, 'live'],
    ['live exactly at the stale boundary', { lastOkAt: 900 }, 'live'],
    ['stale one ms past the boundary', { lastOkAt: 899 }, 'stale'],
    ['stale when it never fetched since boot', { lastOkAt: undefined }, 'stale'],
    ['frozen at the freeze instant', { now: 5000, lastOkAt: 4990 }, 'frozen'],
    ['frozen wins over stale', { now: 9000, lastOkAt: 1 }, 'frozen'],
    ['frozen wins over a failing source', { now: 9000, failures: 9 }, 'frozen'],
    ['frozen but nothing captured before the freeze', { now: 9000, hasVisibleData: false }, 'unavailable'],
    ['revealed after the freeze', { now: 9000, revealed: true }, 'revealed'],
    ['reveal flag before the freeze time changes nothing', { now: 2000, lastOkAt: 1990, revealed: true }, 'live'],
    ['no freeze configured is never frozen', { now: 9e9, freezeMs: undefined, lastOkAt: 9e9 - 1 }, 'live'],
  ];
  it.each(rows)('%s', (_n, over, expected) => {
    expect(computeState({ ...base, ...over })).toBe(expected);
  });

  it('never reports live when the last good fetch is old (D29)', () => {
    for (const age of [101, 1000, 1e6]) expect(computeState({ ...base, lastOkAt: base.now - age })).not.toBe('live');
  });

  it('isFrozen is false once revealed and before the freeze', () => {
    expect([isFrozen(5000, 5000, false), isFrozen(4999, 5000, false), isFrozen(5000, 5000, true), isFrozen(5000, undefined, false)]).toEqual([true, false, false, false]);
  });
});

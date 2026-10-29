import { describe, it, expect } from 'vitest';
import { Collector } from '../src/lib/collector';
import { MemoryStore } from '../src/lib/store/memory';
import { loadSourceMap } from '../src/lib/source/source-map';
import { SourceError } from '../src/lib/source/types';

// PROVISIONAL field names, same as tests/fixtures/provisional-scoreboard.json.
const doc = (round: number, totals: Record<string, number> = { 1: 100, 2: 50 }) => ({
  currentRound: round,
  timestamp: '2026-10-31T10:00:00+05:30',
  teams: Object.entries(totals).map(([id, t]) => ({ teamId: Number(id), teamName: `T${id}`, totalPoints: t, attackPoints: 1, defensePoints: 1, serviceLevelAgreementPoints: 1, services: [{ serviceName: 'docuvault', status: 'OK' }] })),
});

function setup(initial: unknown) {
  const store = new MemoryStore({ slug: 's', name: 'n' });
  const clock = { t: 1_000_000 };
  const src = { next: initial as unknown, calls: 0, delayMs: 0 };
  const logs: string[] = [];
  const c = new Collector({
    store,
    map: loadSourceMap(),
    roster: () => null,
    now: () => clock.t,
    pollMs: 15_000,
    log: (m) => logs.push(m),
    fetchRaw: async () => {
      src.calls++;
      if (src.delayMs) await new Promise((r) => setTimeout(r, src.delayMs));
      if (src.next instanceof Error) throw src.next;
      return src.next;
    },
  });
  return { c, store, clock, src, logs };
}

describe('Collector', () => {
  it('stores a new round once, with our capture time, ranks and rankDelta', async () => {
    const { c, store, clock, src } = setup(doc(1));
    expect(await c.tick()).toBe('stored');
    clock.t += 15_000;
    src.next = doc(2, { 1: 100, 2: 500 });
    expect(await c.tick()).toBe('stored');
    const r = await store.rounds();
    expect(r.map((x) => x.round)).toEqual([1, 2]);
    expect(r[1].capturedAt).toBe(new Date(clock.t).toISOString());
    expect(r[1].teams.map((t) => [t.teamId, t.rank, t.rankDelta])).toEqual([['2', 1, 1], ['1', 2, -1]]);
  });

  it('does not store the same round twice but still counts as a good fetch', async () => {
    const { c, store, clock, src } = setup(doc(5));
    await c.tick();
    const storedAt = c.source.lastOkAt;
    clock.t += 15_000;
    expect(await c.tick()).toBe('same');
    expect(await store.rounds()).toHaveLength(1);
    expect(c.source.lastOkAt).toBe(storedAt); // a repeat is not a fresh round
    expect(src.calls).toBe(2);
  });

  it('a repeated round does not refresh freshness; it keeps the age of the stored round', async () => {
    const { c, clock } = setup(doc(5));
    await c.tick();
    const stored = c.source.lastOkAt;
    clock.t += 200_000;
    await c.tick();
    expect(c.source.lastOkAt).toBe(stored);
  });

  it('after a restart the same round is only as fresh as its capture time', async () => {
    const a = setup(doc(5));
    await a.c.tick();
    const b = new Collector({ store: a.store, map: loadSourceMap(), roster: () => null, now: () => a.clock.t + 999_000, pollMs: 1, fetchRaw: async () => doc(5) });
    await b.tick();
    expect(b.source.lastOkAt).toBe(a.clock.t);
  });

  it('a failing store makes the source look unhealthy, not live', async () => {
    const { c, store } = setup(doc(1));
    store.saveRound = async () => {
      throw new Error('disk full');
    };
    await c.tick();
    expect(c.source).toMatchObject({ consecutiveFailures: 1, lastErrorCode: 'store_write' });
    expect(c.source.lastOkAt).toBeUndefined();
  });

  it('an unexpected throw inside a tick is contained and counted', async () => {
    const { c, store } = setup(doc(1));
    store.latest = async () => {
      throw new Error('x');
    };
    expect(await c.tick()).toBe('error');
  });

  it('ignores a round that goes backwards and counts it as a failure (history untouched)', async () => {
    const { c, store, src } = setup(doc(9));
    await c.tick();
    src.next = doc(3);
    expect(await c.tick()).toBe('error');
    expect(c.source.lastErrorCode).toBe('round_backwards');
    expect((await store.latest())?.round).toBe(9);
  });

  it('keeps previous data on garbage or errors and records only an internal code', async () => {
    const { c, store, src, logs, clock } = setup(doc(1));
    await c.tick();
    const good = c.source.lastOkAt;
    clock.t += 15_000;
    src.next = { unexpected: true };
    expect(await c.tick()).toBe('error');
    src.next = new SourceError('timeout');
    expect(await c.tick()).toBe('error');
    src.next = new Error('boom with http://secret-host/x');
    expect(await c.tick()).toBe('error');
    expect(c.source).toMatchObject({ consecutiveFailures: 3, lastErrorCode: 'unknown', lastOkAt: good });
    expect((await store.latest())?.round).toBe(1);
    expect(logs.join('\n')).not.toContain('secret-host'); // raw error text is never logged
    expect(logs.filter((l) => l.includes('source error'))).toHaveLength(3); // one per change of code
  });

  it('resets the failure count on recovery', async () => {
    const { c, src } = setup(new SourceError('network'));
    await c.tick();
    await c.tick();
    expect(c.source.consecutiveFailures).toBe(2);
    src.next = doc(1);
    await c.tick();
    expect(c.source).toMatchObject({ consecutiveFailures: 0, lastErrorCode: undefined });
  });

  it('is single-flight: concurrent ticks share one fetch', async () => {
    const { c, src } = setup(doc(1));
    src.delayMs = 30;
    const results = await Promise.all([c.tick(), c.tick(), c.ensureFresh().then(() => 'x')]);
    expect(src.calls).toBe(1);
    expect(results[0]).toBe(results[1]);
  });

  it('ensureFresh pulls only when the last attempt is older than 2 x poll', async () => {
    const { c, clock, src } = setup(doc(1));
    await c.ensureFresh();
    expect(src.calls).toBe(1);
    clock.t += 29_000;
    await c.ensureFresh();
    expect(src.calls).toBe(1);
    clock.t += 2_000;
    await c.ensureFresh();
    expect(src.calls).toBe(2);
  });

  it('restart mid-event: a new collector over the same store continues without re-storing', async () => {
    const a = setup(doc(4));
    await a.c.tick();
    const b = new Collector({ store: a.store, map: loadSourceMap(), roster: () => null, now: () => a.clock.t, pollMs: 1, fetchRaw: async () => doc(4) });
    expect(await b.tick()).toBe('same');
    expect((await a.store.rounds()).map((r) => r.round)).toEqual([4]);
  });

  it('applies roster display names only', async () => {
    const store = new MemoryStore({ slug: 's', name: 'n' });
    const c = new Collector({
      store,
      map: loadSourceMap(),
      now: () => 1,
      pollMs: 1,
      fetchRaw: async () => doc(1),
      roster: () => ({ teams: [{ teamId: '1', displayName: '<b>Renamed</b>' }] }),
    });
    await c.tick();
    const t = (await store.latest())!.teams.find((x) => x.teamId === '1')!;
    expect([t.name, t.total]).toEqual(['<b>Renamed</b>', 100]); // text, rendered escaped by the UI; the score is untouched
  });

  it('a failing store write does not crash and is reported', async () => {
    const { c, store, logs } = setup(doc(1));
    store.saveRound = async () => {
      throw new Error('disk full');
    };
    expect(await c.tick()).toBe('store_error');
    expect(logs.some((l) => l.includes('store write failed'))).toBe(true);
  });

  it('start() polls and stop() halts it', async () => {
    const { c, src } = setup(doc(1));
    c.start();
    await new Promise((r) => setTimeout(r, 50));
    c.stop();
    const n = src.calls;
    expect(n).toBeGreaterThanOrEqual(1);
    await new Promise((r) => setTimeout(r, 50));
    expect(src.calls).toBe(n);
  });
});

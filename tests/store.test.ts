import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MemoryStore } from '../src/lib/store/memory';
import { JsonlStore } from '../src/lib/store/jsonl';
import { SupabaseStore, withRetry } from '../src/lib/store/supabase';
import { FallbackStore } from '../src/lib/store/fallback';
import type { SnapshotStore } from '../src/lib/store/types';
import { FakeLbDb, META, snap } from './helpers/fake-lbdb';

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lb-store-'));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const noSleep = { tries: 2, baseMs: 0, timeoutMs: 1000, sleep: async () => {} };

const impls: [string, () => SnapshotStore][] = [
  ['MemoryStore', () => new MemoryStore(META)],
  ['JsonlStore', () => new JsonlStore(path.join(dir, 'snapshots.jsonl'), META)],
  ['SupabaseStore (fake db)', () => new SupabaseStore(new FakeLbDb(), META, noSleep)],
  ['FallbackStore (no remote)', () => new FallbackStore(new MemoryStore(META), new JsonlStore(path.join(dir, 'f.jsonl'), META), null)],
];

describe.each(impls)('SnapshotStore contract: %s', (_name, make) => {
  it('is empty at first', async () => {
    const s = make();
    expect(await s.latest()).toBeNull();
    expect(await s.rounds()).toEqual([]);
  });

  it('returns rounds ascending, latest is the highest, upTo is inclusive', async () => {
    const s = make();
    for (const r of [3, 1, 2]) await s.saveRound(snap(r));
    expect((await s.rounds()).map((x) => x.round)).toEqual([1, 2, 3]);
    expect((await s.latest())?.round).toBe(3);
    expect((await s.rounds(2)).map((x) => x.round)).toEqual([1, 2]);
  });

  it('is idempotent: saving a round twice stores one copy', async () => {
    const s = make();
    await s.saveRound(snap(5, [30, 20, 20]));
    await s.saveRound(snap(5, [99, 1, 1]));
    expect(await s.rounds()).toHaveLength(1); // which copy wins is not part of the contract (the collector never re-saves a round)
  });

  it('round-trips ranks and ties', async () => {
    const s = make();
    await s.saveRound(snap(1));
    const t = (await s.latest())!.teams;
    expect(t.map((x) => [x.rank, x.tied])).toEqual([
      [1, false],
      [2, true],
      [2, true],
    ]);
  });

  it('reports event meta', async () => {
    expect((await make().eventMeta()).slug).toBe('test-event');
  });
});

describe('MemoryStore ring buffer', () => {
  it('drops the oldest round past capacity', async () => {
    const s = new MemoryStore(META, 3);
    for (let r = 1; r <= 5; r++) await s.saveRound(snap(r));
    expect((await s.rounds()).map((x) => x.round)).toEqual([3, 4, 5]);
  });
});

describe('JsonlStore durability', () => {
  it('survives a restart and tolerates a truncated last line', async () => {
    const file = path.join(dir, 's.jsonl');
    const a = new JsonlStore(file, META);
    await a.saveRound(snap(1));
    await a.saveRound(snap(2));
    await fs.appendFile(file, '{"round":3,"capturedAt":"2026-10-31T06:00:03.000Z","teams":[{"teamId":"t1"'); // crash mid-write
    const b = new JsonlStore(file, META);
    expect((await b.rounds()).map((x) => x.round)).toEqual([1, 2]);
    await b.saveRound(snap(3)); // must not be glued onto the partial line
    expect((await new JsonlStore(file, META).rounds()).map((x) => x.round)).toEqual([1, 2, 3]);
  });

  it('does not duplicate a round that is already on disk after a restart', async () => {
    const file = path.join(dir, 's.jsonl');
    await new JsonlStore(file, META).saveRound(snap(1));
    await new JsonlStore(file, META).saveRound(snap(1));
    expect((await fs.readFile(file, 'utf8')).trim().split('\n')).toHaveLength(1);
  });

  it('serialises concurrent saves into whole lines', async () => {
    const file = path.join(dir, 's.jsonl');
    const s = new JsonlStore(file, META);
    await Promise.all([1, 2, 3, 4, 5, 6].map((r) => s.saveRound(snap(r))));
    const lines = (await fs.readFile(file, 'utf8')).trim().split('\n');
    expect(lines).toHaveLength(6);
    lines.forEach((l) => JSON.parse(l));
  });
});

describe('withRetry', () => {
  it('retries with backoff and then succeeds', async () => {
    let n = 0;
    const waits: number[] = [];
    const v = await withRetry(
      async () => {
        if (++n < 3) throw new Error('x');
        return 'ok';
      },
      { tries: 3, baseMs: 100, timeoutMs: 1000, sleep: async (ms) => void waits.push(ms) },
    );
    expect([v, n, waits]).toEqual(['ok', 3, [100, 200]]);
  });

  it('is bounded: gives up after `tries` and rethrows', async () => {
    let n = 0;
    await expect(
      withRetry(async () => {
        n++;
        throw new Error('down');
      }, { ...noSleep, tries: 3 }),
    ).rejects.toThrow('down');
    expect(n).toBe(3);
  });

  it('times out a hung call', async () => {
    await expect(withRetry(() => new Promise(() => {}), { tries: 1, baseMs: 0, timeoutMs: 20 })).rejects.toThrow('timeout');
  });
});

describe('FallbackStore', () => {
  function build(db: FakeLbDb, file = path.join(dir, 'fb.jsonl'), clock = { t: 0 }) {
    const store = new FallbackStore(new MemoryStore(META), new JsonlStore(file, META), new SupabaseStore(db, META, { ...noSleep, tries: 1 }), {
      now: () => clock.t,
      cooldownMs: 1000,
    });
    return { store, clock, file };
  }

  it('writes through to the remote when it is healthy', async () => {
    const db = new FakeLbDb();
    const { store } = build(db);
    await store.saveRound(snap(1));
    await store.flush();
    expect([db.rows.size, store.status()]).toEqual([1, { remote: 'ok', pending: 0 }]);
  });

  it('keeps serving during an outage, then backfills without duplicates', async () => {
    const db = new FakeLbDb();
    const { store, clock } = build(db);
    await store.saveRound(snap(1));
    await store.flush();
    db.fail = true;
    await store.saveRound(snap(2)); // does not throw
    await store.flush();
    await store.saveRound(snap(3));
    await store.flush();
    expect((await store.rounds()).map((x) => x.round)).toEqual([1, 2, 3]); // reads unaffected
    expect(store.status()).toEqual({ remote: 'down', pending: 2 });
    const during = db.upserts;
    await store.saveRound(snap(4));
    await store.flush(); // inside cooldown: remote not even tried
    expect(db.upserts).toBe(during);

    db.fail = false;
    clock.t = 5000; // cooldown over
    await store.saveRound(snap(5));
    await store.flush();
    expect([...db.rows.keys()].sort()).toEqual([1, 2, 3, 4, 5]);
    expect(db.upserts).toBe(1 + 4); // round 1 once, then 2..5 once each; round 1 was not re-sent
    expect(store.status()).toEqual({ remote: 'ok', pending: 0 });
  });

  it('rebuilds after a restart from JSONL and backfills a remote that missed rounds', async () => {
    const db1 = new FakeLbDb();
    const first = build(db1);
    await first.store.saveRound(snap(1));
    await first.store.flush();
    db1.fail = true;
    await first.store.saveRound(snap(2));
    await first.store.flush();

    const db2 = new FakeLbDb(); // fresh remote that has nothing
    const second = build(db2, first.file);
    expect((await second.store.latest())?.round).toBe(2);
    await second.store.flush();
    expect([...db2.rows.keys()].sort()).toEqual([1, 2]);
  });

  it('rebuilds from the remote when the local file is gone, and writes it back locally', async () => {
    const db = new FakeLbDb();
    const a = build(db);
    await a.store.saveRound(snap(1));
    await a.store.flush();
    await a.store.saveRound(snap(2));
    await a.store.flush();
    await fs.rm(a.file);
    const b = build(db, a.file);
    expect((await b.store.rounds()).map((x) => x.round)).toEqual([1, 2]);
    expect((await new JsonlStore(a.file, META).rounds()).map((x) => x.round)).toEqual([1, 2]);
    expect(db.upserts).toBe(2); // nothing re-sent
  });

  it('starts empty and works when the remote is down at startup', async () => {
    const db = new FakeLbDb();
    db.fail = true;
    const { store } = build(db);
    expect(await store.latest()).toBeNull();
    await store.saveRound(snap(1));
    expect((await store.latest())?.round).toBe(1);
  });

  it('re-queues a round the remote holds only partially, and keeps local detail on overlap', async () => {
    const db = new FakeLbDb();
    const first = build(db);
    await first.store.saveRound({ ...snap(1), teams: snap(1).teams.map((t) => ({ ...t, services: [{ key: 'a', status: 'ok' as const }] })) });
    await first.store.flush();
    db.rows.set(1, { ...snap(1), teams: [] }); // remote lost the scores
    const second = build(db, first.file);
    expect((await second.store.latest())!.teams[0].services).toHaveLength(1);
    await second.store.flush();
    expect(db.rows.get(1)!.teams).toHaveLength(3);
  });

  it('does not wait for a hung remote on save', async () => {
    const db = new FakeLbDb();
    db.upsertRound = () => new Promise(() => {});
    const { store } = build(db);
    await store.saveRound(snap(1)); // resolves although the remote never answers
    expect((await store.latest())?.round).toBe(1);
  });

  it('reports remote disabled when none is configured', () => {
    const s = new FallbackStore(new MemoryStore(META), new JsonlStore(path.join(dir, 'x.jsonl'), META), null);
    expect(s.status()).toEqual({ remote: 'disabled', pending: 0 });
  });
});

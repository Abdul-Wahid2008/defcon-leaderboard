import { describe, it, expect, beforeEach } from 'vitest';
import { resetApiStateForTests, safely, serve } from '../src/lib/api';
import { FREEZE, T0, marked, world, type World } from './helpers/deps';
import { MemoryStore } from '../src/lib/store/memory';

const get = (path: string, init: RequestInit = {}) => new Request('http://x.test' + path, init);
const json = async (r: Response) => JSON.parse(await r.text());

beforeEach(() => resetApiStateForTests());

async function frozenWorld(): Promise<World> {
  // Rounds 1..10, captured one per 30 min starting at T0; the freeze (T0+3h) falls after round 6 (captured at T0+2.5h).
  const rounds = Array.from({ length: 10 }, (_, i) => marked(i + 1, T0 + i * 30 * 60_000 + 30 * 60_000));
  return world({}, rounds);
}

describe('freeze leak (D28, P9)', () => {
  it('serves nothing captured after the freeze, in board and history, until revealed', async () => {
    const w = await frozenWorld();
    w.clock.t = FREEZE + 60_000;
    w.source.lastOkAt = w.clock.t;

    const boardRes = await serve(get('/api/board'), 'board', w.deps);
    const histRes = await serve(get('/api/history?top=10'), 'history', w.deps);
    const boardText = await boardRes.text();
    const histText = await histRes.text();
    const board = JSON.parse(boardText);
    const hist = JSON.parse(histText);

    expect(board.meta.state).toBe('frozen');
    expect(board.meta.round).toBe(6);
    expect(board.meta.frozenAtRound).toBe(6);
    expect(hist.rounds).toEqual([1, 2, 3, 4, 5, 6]);
    for (const body of [boardText, histText]) {
      for (let r = 7; r <= 10; r++) {
        expect(body).not.toContain(String(90000 + r)); // later totals
        expect(body).not.toContain(String(80000 + r));
        expect(body).not.toContain(new Date(T0 + r * 30 * 60_000).toISOString()); // later capture times
      }
    }
    expect(boardText).toContain('90006');
  });

  it('shows the full history after reveal, and hides it again after unreveal', async () => {
    const w = await frozenWorld();
    w.clock.t = FREEZE + 60_000;
    w.source.lastOkAt = w.clock.t;
    w.ctl.revealed = true;
    let b = await json(await serve(get('/api/board'), 'board', w.deps));
    expect([b.meta.state, b.meta.round]).toEqual(['revealed', 10]);
    w.ctl.revealed = false; // takes effect at once: revealed is part of the cache key
    b = await json(await serve(get('/api/board'), 'board', w.deps));
    expect([b.meta.state, b.meta.round]).toEqual(['frozen', 6]);
  });

  it('a stale or failing source cannot unfreeze the board', async () => {
    const w = await frozenWorld();
    w.clock.t = FREEZE + 3_600_000;
    w.source.lastOkAt = T0;
    w.source.consecutiveFailures = 50;
    const b = await json(await serve(get('/api/board'), 'board', w.deps));
    expect([b.meta.state, b.meta.round]).toEqual(['frozen', 6]);
  });

  it('ignores round/t/at parameters on history and rejects them', async () => {
    const w = await frozenWorld();
    w.clock.t = FREEZE + 60_000;
    for (const q of ['round=9', 't=9999999999999', 'at=1', 'top=3&round=9', '__proto__=1', 'top=3&top=4']) {
      const r = await serve(get('/api/history?' + q), 'history', w.deps);
      expect(r.status, q).toBe(400);
      expect(await json(r)).toEqual({ error: 'bad_request' });
    }
  });
});

describe('public contract', () => {
  it('omits services unless SHOW_SERVICE_STATUS, and never emits unlisted fields', async () => {
    const w = await world({}, [marked(1, T0 + 1000)]);
    let b = await json(await serve(get('/api/board'), 'board', w.deps));
    expect(b.teams[0].services).toBeUndefined();
    expect(Object.keys(b.teams[0]).sort()).toEqual(['attack', 'defense', 'name', 'rank', 'sla', 'teamId', 'tied', 'total']);
    expect(Object.keys(b.meta).sort()).toEqual(['capturedAt', 'event', 'round', 'serverTime', 'showServiceStatus', 'state']);

    resetApiStateForTests();
    const w2 = await world({ SHOW_SERVICE_STATUS: 'true' }, [marked(1, T0 + 1000)]);
    b = await json(await serve(get('/api/board'), 'board', w2.deps));
    expect(b.teams[0].services).toEqual([{ key: 'svc', status: 'ok' }]);
  });

  it('reports stale, never live, when the last good fetch is old', async () => {
    const w = await world({}, [marked(1, T0 + 1000)]);
    w.source.lastOkAt = w.clock.t - 271_000;
    expect((await json(await serve(get('/api/board'), 'board', w.deps))).meta.state).toBe('stale');
  });

  it('reports unavailable with an empty team list when there is no data after the start', async () => {
    const w = await world();
    w.source.lastOkAt = undefined;
    const b = await json(await serve(get('/api/board'), 'board', w.deps));
    expect([b.meta.state, b.meta.round, b.teams]).toEqual(['unavailable', null, []]);
  });

  it('history: top is clamped by validation, null marks a missing team-round', async () => {
    const w = await world({}, [marked(1, T0 + 1000), { ...marked(2, T0 + 2000), teams: [marked(2, 0).teams[0]] }]);
    for (const q of ['top=0', 'top=31', 'top=NaN', 'top=-1', 'top=1e9', 'top=1.5', 'top=']) {
      expect((await serve(get('/api/history?' + q), 'history', w.deps)).status, q).toBe(400);
    }
    const h = await json(await serve(get('/api/history?top=2'), 'history', w.deps));
    expect(h.series.find((s: { teamId: string }) => s.teamId === 'a').points).toEqual([90001, 90002]);
  });
});

describe('caching, ETag, headers', () => {
  it('sends ETag and Cache-Control, and answers 304 to a matching If-None-Match', async () => {
    const w = await world({}, [marked(1, T0 + 1000)]);
    const a = await serve(get('/api/board'), 'board', w.deps);
    const etag = a.headers.get('etag')!;
    expect(etag).toMatch(/^"[A-Za-z0-9_-]+"$/);
    expect(a.headers.get('cache-control')).toBe('public, max-age=2');
    expect(a.headers.get('set-cookie')).toBeNull();
    expect(a.headers.get('access-control-allow-origin')).toBeNull();
    const b = await serve(get('/api/board', { headers: { 'if-none-match': etag } }), 'board', w.deps);
    expect(b.status).toBe(304);
    expect(await b.text()).toBe('');
    const c = await serve(get('/api/board', { headers: { 'if-none-match': '"other"' } }), 'board', w.deps);
    expect(c.status).toBe(200);
  });

  it('builds the body once per 3 s window', async () => {
    const w = await world({}, [marked(1, T0 + 1000)]);
    await serve(get('/api/board'), 'board', w.deps);
    await serve(get('/api/board?x=1'), 'board', w.deps); // a different query must not create a second entry
    expect(w.fresh.calls).toBe(1); // one build, so one source check
    w.clock.t += 3001;
    await serve(get('/api/board'), 'board', w.deps);
    expect(w.fresh.calls).toBe(2);
  });

  it('HEAD has headers and no body', async () => {
    const w = await world({}, [marked(1, T0 + 1000)]);
    const r = await serve(get('/api/board', { method: 'HEAD' }), 'board', w.deps);
    expect([r.status, await r.text()]).toEqual([200, '']);
  });

  it('does not wait for the source when it already has data', async () => {
    const w = await world({}, [marked(1, T0 + 1000)]);
    w.deps.ensureFresh = () => new Promise(() => {}); // a hung source
    const r = await Promise.race([serve(get('/api/board'), 'board', w.deps), new Promise<string>((res) => setTimeout(() => res('hung'), 500))]);
    expect(r).not.toBe('hung');
  });
});

describe('rate limiting', () => {
  it('limits per right-most X-Forwarded-For hop when TRUST_PROXY=true; a spoofed left entry does not help', async () => {
    const w = await world({ TRUST_PROXY: 'true', RATE_LIMIT_PER_MIN: '10' }, [marked(1, T0 + 1000)]);
    const hit = (xff: string) => serve(get('/api/board', { headers: { 'x-forwarded-for': xff } }), 'board', w.deps);
    for (let i = 0; i < 10; i++) expect((await hit(`1.1.1.${i}, 9.9.9.9`)).status).toBe(200); // different spoofed left entries
    const r = await hit('2.2.2.2, 9.9.9.9');
    expect(r.status).toBe(429);
    expect(r.headers.get('retry-after')).toBe('30');
    expect((await hit('5.5.5.5, 8.8.8.8')).status).toBe(200); // another real client is unaffected
  });

  it('does not limit at all when TRUST_PROXY=false: a shared bucket would let one client lock everyone out', async () => {
    const w = await world({ RATE_LIMIT_PER_MIN: '10' }, [marked(1, T0 + 1000)]);
    const codes = new Set<number>();
    for (let i = 0; i < 200; i++) codes.add((await serve(get('/api/board', { headers: { 'x-forwarded-for': '7.7.7.' + (i % 250) } }), 'board', w.deps)).status);
    expect([...codes]).toEqual([200]);
  });

  it('a missing or malformed forwarded address is not limited under TRUST_PROXY=true either', async () => {
    const w = await world({ TRUST_PROXY: 'true', RATE_LIMIT_PER_MIN: '10' }, [marked(1, T0 + 1000)]);
    for (let i = 0; i < 30; i++) expect((await serve(get('/api/board', { headers: { 'x-forwarded-for': 'not an ip!' } }), 'board', w.deps)).status).toBe(200);
  });
});

describe('fail closed', () => {
  it('turns any failure into a minimal 503 body', async () => {
    const r = await safely(get('/api/board'), 'board', async () => {
      throw new Error('SECRET_HOST=db.internal.example stack...');
    });
    expect(r.status).toBe(503);
    expect(await r.text()).toBe('{"error":"unavailable"}');
  });

  it('a store failure is a 503, not a 500', async () => {
    const w = await world();
    w.deps.store = Object.assign(new MemoryStore({ slug: 's', name: 'n' }), {
      latest: async () => {
        throw new Error('db down at host x');
      },
    });
    const r = await safely(get('/api/board'), 'board', async () => w.deps);
    expect([r.status, await r.text()]).toEqual([503, '{"error":"unavailable"}']);
  });
});

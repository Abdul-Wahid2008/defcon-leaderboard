import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appendAudit, cachedControl, controlPath, readControl, writeControl } from '../src/lib/control';
import { parseRosterText, renderFinalHtml, rosterDiff, slugConfirmed } from '../src/lib/cli-core';
import { RateLimiter, clientKey } from '../src/lib/ratelimit';
import { buildBoard } from '../src/lib/view';
import { marked, world } from './helpers/deps';

let dir: string;
beforeEach(() => void (dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-ctl-'))));
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('control file', () => {
  it('defaults to not revealed when missing, corrupt, wrong-typed or oversized', () => {
    expect(readControl(dir).revealed).toBe(false);
    for (const bad of ['{not json', '{"revealed":"yes"}', '[]', '{"revealed":true,"pad":"' + 'x'.repeat(5000) + '"}']) {
      fs.writeFileSync(controlPath(dir), bad);
      expect(readControl(dir).revealed, bad.slice(0, 20)).toBe(false);
    }
  });

  it('round-trips a reveal written by the CLI', () => {
    writeControl(dir, { revealed: true, updatedAt: 'x' });
    expect(readControl(dir)).toEqual({ revealed: true, updatedAt: 'x' });
    expect(fs.readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('is re-read at most every 5 s unless forced', () => {
    let t = 0;
    const c = cachedControl(dir, () => t);
    expect(c.get().revealed).toBe(false);
    writeControl(dir, { revealed: true });
    t = 4000;
    expect(c.get().revealed).toBe(false);
    t = 5000;
    expect(c.get().revealed).toBe(true);
    writeControl(dir, { revealed: false });
    expect(c.force().revealed).toBe(false);
  });

  it('appends audit lines', () => {
    appendAudit(dir, { action: 'reveal', actor: 'me' });
    appendAudit(dir, { action: 'unreveal', actor: 'me' });
    const lines = fs.readFileSync(path.join(dir, 'audit.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(lines.map((l) => l.action)).toEqual(['reveal', 'unreveal']);
  });
});

describe('cli-core', () => {
  it('requires the exact event slug', () => {
    expect([slugConfirmed('evt', 'evt'), slugConfirmed(' evt ', 'evt'), slugConfirmed('EVT', 'evt'), slugConfirmed('', 'evt'), slugConfirmed(undefined, 'evt'), slugConfirmed('evt', undefined), slugConfirmed('', undefined)]).toEqual([
      true, true, false, false, false, false, false,
    ]);
  });

  it('parses CSV (header optional, commas in names) and JSON rosters, names only', () => {
    expect(parseRosterText('teamId,displayName\n1,Alpha\n2,Bravo, the Second\n', 'r.csv').teams).toEqual([
      { teamId: '1', displayName: 'Alpha' },
      { teamId: '2', displayName: 'Bravo, the Second' },
    ]);
    expect(parseRosterText('7,Solo', 'r.csv').teams).toHaveLength(1);
    expect(parseRosterText('[{"teamId":"1","displayName":"A"}]', 'r.json').teams).toHaveLength(1);
    expect(() => parseRosterText('{"teams":[{"teamId":"1","displayName":"A","email":"x@y.z"}]}', 'r.json')).toThrow(); // extra field = PII risk
    expect(() => parseRosterText('1,A\n1,B', 'r.csv')).toThrow(/duplicate/);
    expect(() => parseRosterText('no-comma-row', 'r.csv')).toThrow();
  });

  it('diffs rosters', () => {
    const o = { teams: [{ teamId: '1', displayName: 'A' }, { teamId: '2', displayName: 'B' }] };
    const n = { teams: [{ teamId: '1', displayName: 'A2' }, { teamId: '3', displayName: 'C' }] };
    expect(rosterDiff(o, n)).toEqual({ added: ['3'], removed: ['2'], renamed: ['1: A -> A2'], unchanged: 0 });
    expect(rosterDiff(null, n).added).toEqual(['1', '3']);
  });

  it('final.html escapes names and contains no script or external reference', async () => {
    const w = await world({}, [{ ...marked(1, 1000), teams: [{ ...marked(1, 0).teams[0], name: '<script>alert(1)</script>' }] }]);
    const html = renderFinalHtml(buildBoard({ cfg: w.deps.cfg, rounds: await w.store.rounds(), revealed: false, source: w.source, now: w.clock.t }));
    expect(html).not.toContain('<script');
    expect(html).toContain('&#60;script&#62;');
    expect(html).not.toMatch(/https?:\/\//);
  });
});

describe('rate limiter', () => {
  it('counts per key per window and resets', () => {
    let t = 0;
    const l = new RateLimiter(2, 1000, 100, () => t);
    expect([l.allow('a'), l.allow('a'), l.allow('a'), l.allow('b')]).toEqual([true, true, false, true]);
    t = 1000;
    expect(l.allow('a')).toBe(true);
  });

  it('keeps memory bounded under many distinct keys', () => {
    const l = new RateLimiter(5, 60_000, 50);
    for (let i = 0; i < 1000; i++) l.allow('k' + i);
    expect((l as unknown as { windows: Map<string, unknown> }).windows.size).toBeLessThanOrEqual(50);
    expect(l.allow('brand-new')).toBe(true); // a full table fails open
  });

  it('clientKey uses the right-most hop only when trusted and well formed', () => {
    const h = (v?: string) => new Headers(v ? { 'x-forwarded-for': v } : {});
    expect(clientKey(h('1.1.1.1, 2.2.2.2'), false)).toBeNull();
    expect(clientKey(h('1.1.1.1, 2.2.2.2'), true)).toBe('2.2.2.2');
    expect(clientKey(h('bad value!'), true)).toBeNull();
    expect(clientKey(h(), true)).toBeNull();
    expect(clientKey(h('2001:db8::1'), true)).toBe('2001:db8::1');
  });
});

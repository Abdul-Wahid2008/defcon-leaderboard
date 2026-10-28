/* eslint-disable @typescript-eslint/no-explicit-any -- fixture mutation helpers take arbitrary JSON */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { getPath, parseScoreboard } from '../src/lib/source/parse';
import { loadSourceMap, parseSourceMap } from '../src/lib/source/source-map';
import { sanitizeName } from '../src/lib/source/sanitize';
import { SourceError } from '../src/lib/source/types';

const map = loadSourceMap();
const minimalMap = parseSourceMap({
  teamsPath: 'teams',
  round: 'currentRound',
  team: { id: 'teamId', name: 'teamName', total: 'totalPoints' },
});
const fixture = () => JSON.parse(fs.readFileSync(path.resolve(__dirname, 'fixtures', 'provisional-scoreboard.json'), 'utf8'));

function expectShapeError(doc: unknown) {
  try {
    parseScoreboard(doc, map);
  } catch (e) {
    expect(e).toBeInstanceOf(SourceError);
    expect((e as SourceError).code).toBe('SOURCE_SHAPE_UNKNOWN');
    return;
  }
  throw new Error('expected SOURCE_SHAPE_UNKNOWN');
}

describe('PROVISIONAL fixture parsing', () => {
  it('parses the provisional fixture through the field map', () => {
    const s = parseScoreboard(fixture(), map);
    expect(s.round).toBe(12);
    expect(s.teams).toHaveLength(4);
    expect(s.teams[0]).toMatchObject({ teamId: '1', name: 'Alpha', total: 1500.5, attack: 800, defense: 400.5, sla: 300 });
    expect(s.sourceTimestamp).toBe('2026-10-31T05:30:00.000Z'); // normalised to UTC ISO
  });

  it('maps listed service statuses and turns unlisted ones into unknown, never ok', () => {
    const s = parseScoreboard(fixture(), map);
    expect(s.teams[0].services).toEqual([{ key: 'docuvault', status: 'ok' }, { key: 'pulsechat', status: 'mumble' }]);
    expect(s.teams[1].services?.[0].status).toBe('offline');
    expect(s.teams[2].services?.[1].status).toBe('unknown');
  });

  it('works with a minimal map (no optional keys) and ignores fields it was not told about', () => {
    const minimal = parseSourceMap({ teamsPath: 'rows', round: 'r', team: { id: 'i', name: 'n', total: 't' } });
    const s = parseScoreboard({ r: 0, rows: [{ i: 'x', n: 'N', t: 0, attack: 99, services: [{}] }] }, minimal);
    expect(s.round).toBe(0);
    expect(s.teams[0]).toEqual({ teamId: 'x', name: 'N', total: 0 });
    expect(s.sourceTimestamp).toBeUndefined();
  });

  it('a field the map names is required: absent in the source is schema drift and fails closed', () => {
    for (const drop of ['attackPoints', 'defensePoints', 'serviceLevelAgreementPoints', 'services']) {
      const d = fixture();
      delete d.teams[0][drop];
      expectShapeError(d);
    }
    const d = fixture();
    delete d.timestamp;
    expectShapeError(d);
  });

  it('normalises -0 and bounds the total below the numeric(14,3) limit', () => {
    const d = fixture();
    d.teams[0].totalPoints = -0;
    expect(Object.is(parseScoreboard(d, map).teams[0].total, 0)).toBe(true);
    d.teams[0].totalPoints = 99999999999.999;
    expect(parseScoreboard(d, map).teams[0].total).toBe(99999999999.999);
    d.teams[0].totalPoints = 1e11;
    expectShapeError(d);
  });
});

describe('fail closed (PROVISIONAL shape)', () => {
  const mutations: [string, (d: any) => void][] = [
    ['missing round', (d) => delete d.currentRound],
    ['round as string', (d) => (d.currentRound = '12')],
    ['negative round', (d) => (d.currentRound = -1)],
    ['fractional round', (d) => (d.currentRound = 1.5)],
    ['missing teams', (d) => delete d.teams],
    ['empty teams', (d) => (d.teams = [])],
    ['teams not array', (d) => (d.teams = { a: 1 })],
    ['too many teams', (d) => (d.teams = Array.from({ length: 201 }, (_, i) => ({ ...d.teams[0], teamId: i })))],
    ['team not object', (d) => (d.teams[0] = 5)],
    ['missing id', (d) => delete d.teams[0].teamId],
    ['id object', (d) => (d.teams[0].teamId = {})],
    ['id with space', (d) => (d.teams[0].teamId = 'a b')],
    ['id negative number', (d) => (d.teams[0].teamId = -1)],
    ['duplicate id', (d) => (d.teams[1].teamId = d.teams[0].teamId)],
    ['missing name', (d) => delete d.teams[0].teamName],
    ['name number', (d) => (d.teams[0].teamName = 7)],
    ['name only control chars', (d) => (d.teams[0].teamName = '\u0000​‮')],
    ['missing total', (d) => delete d.teams[0].totalPoints],
    ['total string', (d) => (d.teams[0].totalPoints = '100')],
    ['total null', (d) => (d.teams[0].totalPoints = null)],
    ['total negative', (d) => (d.teams[0].totalPoints = -0.001)],
    ['total huge', (d) => (d.teams[0].totalPoints = 1e12)],
    ['attack string', (d) => (d.teams[0].attackPoints = 'x')],
    ['sla null', (d) => (d.teams[0].serviceLevelAgreementPoints = null)],
    ['services not array', (d) => (d.teams[0].services = 'ok')],
    ['service key missing', (d) => delete d.teams[0].services[0].serviceName],
    ['service key empty after sanitising', (d) => (d.teams[0].services[0].serviceName = '​ ')],
    ['too many services', (d) => (d.teams[0].services = Array.from({ length: 51 }, () => ({ serviceName: 's', status: 'OK' })))],
    ['id empty string', (d) => (d.teams[0].teamId = '')],
    ['service status number', (d) => (d.teams[0].services[0].status = 1)],
    ['timestamp garbage', (d) => (d.timestamp = 'soon')],
    ['timestamp V8 legacy "foo 2020"', (d) => (d.timestamp = 'foo 2020')],
    ['timestamp "1"', (d) => (d.timestamp = '1')],
    ['timestamp without offset', (d) => (d.timestamp = '2026-10-31T11:00:00')],
    ['timestamp too long', (d) => (d.timestamp = '2026-10-31T11:00:00Z' + ' '.repeat(100))],
  ];
  it.each(mutations)('rejects %s', (_n, mutate) => {
    const d = fixture();
    mutate(d);
    expectShapeError(d);
  });

  it.each([null, 5, 'x', [], [fixture()]])('rejects a non-object root %#', (root) => expectShapeError(root));

  it('rejects NaN and Infinity (only reachable by non-JSON callers)', () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      const d = fixture();
      d.teams[0].totalPoints = bad;
      expectShapeError(d);
    }
  });

  it('never leaks values in the internal detail', () => {
    const d = fixture();
    d.teams[0].totalPoints = 'SECRET-VALUE';
    try {
      parseScoreboard(d, map);
    } catch (e) {
      expect(String((e as SourceError).detail)).not.toContain('SECRET-VALUE');
    }
  });
});

describe('hostile documents', () => {
  it('ignores __proto__ and inherited members', () => {
    const d = JSON.parse(
      '{"__proto__":{"currentRound":99,"teams":[]},"currentRound":3,"teams":[{"teamId":1,"teamName":"A","totalPoints":1,"__proto__":{"totalPoints":999}}]}',
    );
    const s = parseScoreboard(d, minimalMap);
    expect(s.round).toBe(3);
    expect(s.teams[0].total).toBe(1);
    expect(({} as Record<string, unknown>).currentRound).toBeUndefined();
  });

  it('last duplicate key wins deterministically', () => {
    const d = JSON.parse('{"currentRound":1,"currentRound":2,"teams":[{"teamId":1,"teamName":"A","totalPoints":1}]}');
    expect(parseScoreboard(d, minimalMap).round).toBe(2);
  });

  it('getPath refuses inherited properties', () => {
    expect(getPath({}, 'toString')).toBeUndefined();
    expect(getPath({ a: { b: 1 } }, 'a.b')).toBe(1);
    expect(getPath({ a: [10, 20] }, 'a.1')).toBe(20);
    expect(getPath(null, 'a')).toBeUndefined();
  });

  it('team names with markup, bidi and zero-width characters are inert text', () => {
    const d = fixture();
    d.teams[0].teamName = '<img src=x onerror=alert(1)>‮evil​⁦x';
    const name = parseScoreboard(d, map).teams[0].name;
    expect(name).not.toMatch(/[‮​⁦]/u);
    expect(name).toContain('<img'); // kept as literal text; React escapes it on render
    expect(Array.from(name).length).toBeLessThanOrEqual(40);
  });
});

describe('sanitizeName', () => {
  it('strips control, bidi and zero-width characters and collapses whitespace', () => {
    expect(sanitizeName('  a\u0000b \t\n c‍d﻿ ')).toBe('a b cd');
    expect(sanitizeName('‭abc‬')).toBe('abc');
  });
  it('caps at 40 code points without splitting a surrogate pair', () => {
    const s = sanitizeName('😀'.repeat(60));
    expect(Array.from(s)).toHaveLength(40);
  });
  it('returns empty for nothing printable', () => {
    expect(sanitizeName('​‮ ')).toBe('');
  });
  it('removes lone surrogates (JSON can carry them) so storage never sees invalid text', () => {
    const s = sanitizeName(JSON.parse('"\\ud800AB\\udc00"'));
    expect(s).toBe('AB');
    expect(s.isWellFormed()).toBe(true);
  });
  it('treats blank-looking fillers as empty', () => {
    for (const filler of ['ㅤ', '⠀', 'ᅟᅠ', '͏', '️', '឴', 'ﾠ']) {
      expect(sanitizeName(filler + filler)).toBe('');
    }
    expect(sanitizeName('aㅤb')).toBe('ab');
  });
  it('caps stacked combining marks', () => {
    const zalgo = 'a' + '́'.repeat(30) + 'b';
    expect(Array.from(sanitizeName(zalgo)).length).toBeLessThanOrEqual(4);
    expect(sanitizeName('é')).toBe('é'); // a normal accent survives (NFC)
  });
});

describe('source map validation', () => {
  const base = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'config', 'source-map.json'), 'utf8'));
  it('rejects forbidden segments, bad paths and unknown keys', () => {
    expect(() => parseSourceMap({ ...base, teamsPath: '__proto__.teams' })).toThrow();
    expect(() => parseSourceMap({ ...base, round: 'a..b' })).toThrow();
    expect(() => parseSourceMap({ ...base, round: 'a[0]' })).toThrow();
    expect(() => parseSourceMap({ ...base, extra: 1 })).toThrow();
    expect(() => parseSourceMap({ ...base, team: { ...base.team, total: undefined } })).toThrow();
  });
  it('the committed map is PROVISIONAL and says so', () => {
    expect(base._note).toMatch(/PROVISIONAL/);
  });
});

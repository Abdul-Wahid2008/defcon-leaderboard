import { sanitizeName } from './sanitize';
import type { SourceMap } from './source-map';
import { SourceError, type ParsedService, type ParsedSnapshot, type ParsedTeam, type ServiceStatus } from './types';

const MAX_TEAMS = 200;
const MAX_SERVICES = 50;
const MAX_POINTS = 1e11; // numeric(14,3) holds < 1e11 (11 integer digits); the bound is exclusive
const ISO = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})$/;

function fail(detail: string): never {
  throw new SourceError('SOURCE_SHAPE_UNKNOWN', detail);
}

/** Walks own properties only, so `__proto__`/inherited members of an attacker-shaped document are never read. */
export function getPath(root: unknown, dotted: string): unknown {
  let cur: unknown = root;
  for (const seg of dotted.split('.')) {
    if (cur === null || typeof cur !== 'object' || !Object.hasOwn(cur, seg)) return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

function finiteNumber(v: unknown, what: string, opts: { min?: number } = {}): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(`${what}: not a finite number`);
  if (Math.abs(v) >= MAX_POINTS) fail(`${what}: out of range`);
  if (opts.min !== undefined && v < opts.min) fail(`${what}: below ${opts.min}`);
  return v + 0; // turns -0 into 0
}

/** A field the map names is required: absent in the source means schema drift, not "no data". Leave it out of the map to not read it. */
function mappedNumber(team: unknown, p: string | undefined, what: string): number | undefined {
  if (!p) return undefined;
  return finiteNumber(getPath(team, p), what);
}

function teamId(v: unknown): string {
  if (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0) return String(v);
  if (typeof v === 'string' && /^[\x21-\x7e]{1,64}$/.test(v)) return v;
  return fail('team id: expected a safe integer or a short printable string');
}

function parseServices(team: unknown, map: NonNullable<SourceMap['services']>): ParsedService[] {
  const arr = getPath(team, map.path);
  if (!Array.isArray(arr) || arr.length > MAX_SERVICES) return fail('services: expected a short array');
  return arr.map((s) => {
    const rawKey = getPath(s, map.key);
    if (typeof rawKey !== 'string') return fail('service key: not a string');
    const key = sanitizeName(rawKey, 40);
    if (!key) return fail('service key: empty');
    const rawStatus = getPath(s, map.status);
    if (typeof rawStatus !== 'string') return fail('service status: not a string');
    const status: ServiceStatus = Object.hasOwn(map.statusMap, rawStatus) ? map.statusMap[rawStatus] : 'unknown';
    return { key, status };
  });
}

/**
 * Reads a decoded scoreboard document through the field map. All-or-nothing: any missing field, wrong type, NaN,
 * Infinity, negative total or duplicate team id rejects the whole snapshot with SOURCE_SHAPE_UNKNOWN. It never
 * substitutes a default and never guesses a total.
 */
export function parseScoreboard(raw: unknown, map: SourceMap): ParsedSnapshot {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return fail('root: expected an object');

  const round = getPath(raw, map.round);
  if (typeof round !== 'number' || !Number.isSafeInteger(round) || round < 0) return fail('round: expected a non-negative integer');

  let sourceTimestamp: string | undefined;
  if (map.timestamp) {
    const t = getPath(raw, map.timestamp);
    if (typeof t !== 'string' || t.length > 40 || !ISO.test(t) || !Number.isFinite(Date.parse(t))) return fail('timestamp: not an ISO-8601 string');
    sourceTimestamp = new Date(t).toISOString();
  }

  const rows = getPath(raw, map.teamsPath);
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > MAX_TEAMS) return fail('teams: expected a non-empty array');

  const seen = new Set<string>();
  const teams: ParsedTeam[] = rows.map((row) => {
    if (row === null || typeof row !== 'object') return fail('team: expected an object');
    const id = teamId(getPath(row, map.team.id));
    if (seen.has(id)) return fail('team id: duplicate');
    seen.add(id);

    const rawName = getPath(row, map.team.name);
    if (typeof rawName !== 'string') return fail('team name: not a string');
    const name = sanitizeName(rawName);
    if (!name) return fail('team name: empty after sanitising');

    const t: ParsedTeam = { teamId: id, name, total: finiteNumber(getPath(row, map.team.total), 'total', { min: 0 }) };
    const attack = mappedNumber(row, map.team.attack, 'attack');
    const defense = mappedNumber(row, map.team.defense, 'defense');
    const sla = mappedNumber(row, map.team.sla, 'sla');
    if (attack !== undefined) t.attack = attack;
    if (defense !== undefined) t.defense = defense;
    if (sla !== undefined) t.sla = sla;
    if (map.services) t.services = parseServices(row, map.services);
    return t;
  });

  return { round, ...(sourceTimestamp ? { sourceTimestamp } : {}), teams };
}

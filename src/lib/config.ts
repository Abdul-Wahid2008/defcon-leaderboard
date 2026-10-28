import { z } from 'zod';

/**
 * Typed, lazy, fail-closed configuration. Nothing here runs at import time: callers use getConfig() inside a handler or
 * the collector, so a missing variable becomes a handled ConfigError instead of a bare 500 during module load.
 */

export class ConfigError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super(`Invalid configuration: ${issues.join('; ')}`);
    this.name = 'ConfigError';
    this.issues = issues;
  }
}

const emptyToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const opt = <T extends z.ZodType>(schema: T) => z.preprocess(emptyToUndefined, schema.optional());
const bool = (def: boolean) =>
  z.preprocess(emptyToUndefined, z.enum(['true', 'false', '1', '0']).optional()).transform((v) => (v === undefined ? def : v === 'true' || v === '1'));
const posInt = (def: number, min = 1, max = 86_400) =>
  z.preprocess(emptyToUndefined, z.coerce.number().int().min(min).max(max).optional()).transform((v) => v ?? def);
const isoDate = opt(z.string().refine((s) => Number.isFinite(Date.parse(s)) && /[zZ]|[+-]\d{2}:?\d{2}$/.test(s), 'must be ISO-8601 with an offset'));
const httpUrl = opt(
  z.string().refine((s) => {
    try {
      const u = new URL(s);
      return (u.protocol === 'http:' || u.protocol === 'https:') && !u.username && !u.password;
    } catch {
      return false;
    }
  }, 'must be an http(s) URL without credentials'),
);

const schema = z.object({
  SCOREBOARD_URL: httpUrl,
  SCOREBOARD_ALLOWED_HOSTS: opt(z.string()),
  POLL_SEC: posInt(15, 5, 300),
  STALE_AFTER_SEC: posInt(270, 30, 3600),
  ROUND_SEC: posInt(90, 5, 3600),
  EVENT_SLUG: opt(z.string().regex(/^[a-z0-9][a-z0-9-]{1,40}$/, 'lowercase letters, digits and hyphens, 2-41 chars')),
  EVENT_NAME: z.preprocess(emptyToUndefined, z.string().max(80).optional()).transform((v) => v ?? 'DEFCON 2.0'),
  EVENT_START_ISO: isoDate,
  FREEZE_AT_ISO: isoDate,
  EVENT_END_ISO: isoDate,
  SHOW_SERVICE_STATUS: bool(false),
  BASE_PATH: opt(
    z.string().regex(/^\/[A-Za-z0-9/_-]*$/, 'must start with / and contain no query or dots').refine((s) => !s.includes('//'), 'must not contain //'),
  ),
  SUPABASE_URL: httpUrl,
  SUPABASE_SECRET_KEY: opt(z.string().min(20)),
  RATE_LIMIT_PER_MIN: posInt(120, 10, 10_000),
  TRUST_PROXY: bool(false),
  DATA_DIR: z.preprocess(emptyToUndefined, z.string().optional()).transform((v) => v ?? './data'),
});

export type AppConfig = Omit<z.infer<typeof schema>, 'SCOREBOARD_ALLOWED_HOSTS'> & {
  /** Lower-cased hosts the collector may contact. */
  allowedHosts: string[];
};

export function parseConfig(env: Record<string, string | undefined>): AppConfig {
  const r = schema.safeParse(env);
  if (!r.success) {
    throw new ConfigError(r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`));
  }
  const { SCOREBOARD_ALLOWED_HOSTS, ...rest } = r.data;
  const hosts = (SCOREBOARD_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  if (hosts.length === 0 && rest.SCOREBOARD_URL) hosts.push(new URL(rest.SCOREBOARD_URL).host.toLowerCase());
  const times = [rest.EVENT_START_ISO, rest.FREEZE_AT_ISO, rest.EVENT_END_ISO].filter((t): t is string => !!t).map(Date.parse);
  if (times.some((t, i) => i > 0 && t < times[i - 1])) {
    throw new ConfigError(['EVENT_START_ISO, FREEZE_AT_ISO and EVENT_END_ISO must be in order']);
  }
  return { ...rest, allowedHosts: hosts };
}

let cached: AppConfig | null = null;

/** Memoised on success only; a failure is re-evaluated on the next call so fixing the env needs no code path. */
export function getConfig(): AppConfig {
  if (!cached) cached = parseConfig(process.env);
  return cached;
}

export function resetConfigForTests(): void {
  cached = null;
}

import { describe, expect, it } from 'vitest';
import { ConfigError, parseConfig } from '../src/lib/config';

describe('parseConfig', () => {
  it('accepts an empty environment with documented defaults', () => {
    const c = parseConfig({});
    expect(c.POLL_SEC).toBe(15);
    expect(c.STALE_AFTER_SEC).toBe(270);
    expect(c.ROUND_SEC).toBe(90);
    expect(c.SHOW_SERVICE_STATUS).toBe(false);
    expect(c.TRUST_PROXY).toBe(false);
    expect(c.EVENT_NAME).toBe('DEFCON 2.0');
    expect(c.allowedHosts).toEqual([]);
  });

  it('treats empty strings as unset', () => {
    const c = parseConfig({ SCOREBOARD_URL: '', POLL_SEC: '', FREEZE_AT_ISO: '  ' });
    expect(c.SCOREBOARD_URL).toBeUndefined();
    expect(c.POLL_SEC).toBe(15);
    expect(c.FREEZE_AT_ISO).toBeUndefined();
  });

  it('defaults the allowed host to the source URL host and lower-cases explicit hosts', () => {
    expect(parseConfig({ SCOREBOARD_URL: 'http://Score.Example:8080/data/scoreboard.json' }).allowedHosts).toEqual(['score.example:8080']);
    expect(parseConfig({ SCOREBOARD_URL: 'http://a.test/x', SCOREBOARD_ALLOWED_HOSTS: 'B.test, c.test' }).allowedHosts).toEqual(['b.test', 'c.test']);
  });

  it.each([
    [{ SCOREBOARD_URL: 'ftp://x.test/a' }, 'SCOREBOARD_URL'],
    [{ SCOREBOARD_URL: 'not a url' }, 'SCOREBOARD_URL'],
    [{ SCOREBOARD_URL: 'http://user:pw@x.test/a' }, 'SCOREBOARD_URL'],
    [{ POLL_SEC: '1' }, 'POLL_SEC'],
    [{ POLL_SEC: 'abc' }, 'POLL_SEC'],
    [{ EVENT_SLUG: 'Bad Slug' }, 'EVENT_SLUG'],
    [{ FREEZE_AT_ISO: '2026-10-31T10:00:00' }, 'FREEZE_AT_ISO'],
    [{ FREEZE_AT_ISO: 'tomorrow' }, 'FREEZE_AT_ISO'],
    [{ SHOW_SERVICE_STATUS: 'maybe' }, 'SHOW_SERVICE_STATUS'],
    [{ BASE_PATH: '/a?b=1' }, 'BASE_PATH'],
    [{ SUPABASE_SECRET_KEY: 'short' }, 'SUPABASE_SECRET_KEY'],
  ])('rejects %j', (env, name) => {
    expect(() => parseConfig(env)).toThrowError(ConfigError);
    try {
      parseConfig(env);
    } catch (e) {
      expect((e as ConfigError).issues.join(' ')).toContain(name);
    }
  });

  it('rejects event times out of order', () => {
    expect(() =>
      parseConfig({ EVENT_START_ISO: '2026-10-31T12:00:00+05:30', FREEZE_AT_ISO: '2026-10-31T10:00:00+05:30' }),
    ).toThrowError(/in order/);
  });

  it('never echoes a secret value in its error', () => {
    try {
      parseConfig({ SUPABASE_SECRET_KEY: 'tiny-secret' });
    } catch (e) {
      expect(String((e as Error).message)).not.toContain('tiny-secret');
    }
  });
});

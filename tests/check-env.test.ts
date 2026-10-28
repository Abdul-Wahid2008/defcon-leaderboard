import { describe, expect, it } from 'vitest';
import { checkEnv } from '../src/lib/check-env';

const good = {
  CHECK_RELEASE: '1',
  EVENT_SLUG: 'defcon-2',
  FREEZE_AT_ISO: '2026-10-31T13:00:00+05:30',
  SCOREBOARD_URL: 'http://score.example/data/scoreboard.json',
};

describe('checkEnv', () => {
  it('passes a minimal release environment', () => {
    const r = checkEnv(good);
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('does not enforce release rules without CHECK_RELEASE', () => {
    expect(checkEnv({}).ok).toBe(true);
  });

  it.each(['FREEZE_AT_ISO', 'EVENT_SLUG', 'SCOREBOARD_URL'])('release refuses a missing %s', (k) => {
    const env: Record<string, string | undefined> = { ...good };
    delete env[k];
    const r = checkEnv(env);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toContain(k);
  });

  it('release refuses a non-http source URL', () => {
    const r = checkEnv({ ...good, SCOREBOARD_URL: 'file:///etc/passwd' });
    expect(r.ok).toBe(false);
  });

  it('release refuses a non-loopback bind and accepts loopback', () => {
    expect(checkEnv({ ...good, HOSTNAME: '0.0.0.0' }).ok).toBe(false);
    expect(checkEnv({ ...good, HOSTNAME: '127.0.0.1' }).ok).toBe(true);
  });

  it('refuses a credential exposed through a NEXT_PUBLIC_ name in every mode', () => {
    const r = checkEnv({ NEXT_PUBLIC_SUPABASE_SECRET_KEY: 'x'.repeat(30) });
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toContain('NEXT_PUBLIC_SUPABASE_SECRET_KEY');
    expect(checkEnv({ NEXT_PUBLIC_EVENT_LABEL: 'ok' }).ok).toBe(true);
  });

  it('prints names and rules, never values', () => {
    const secret = 'sb_secret_' + 'a'.repeat(30);
    const r = checkEnv({ ...good, SUPABASE_SECRET_KEY: secret, NEXT_PUBLIC_API_TOKEN: secret, SCOREBOARD_URL: 'ftp://h/' });
    expect(JSON.stringify(r)).not.toContain(secret);
  });

  it('warns when a Supabase key has no URL', () => {
    const r = checkEnv({ SUPABASE_SECRET_KEY: 'k'.repeat(30) });
    expect(r.warnings.join(' ')).toContain('SUPABASE_URL');
  });
});

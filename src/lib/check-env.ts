import { ConfigError, parseConfig } from './config';

export type CheckResult = { ok: boolean; errors: string[]; warnings: string[] };

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);

/**
 * Pure release-gate check. It returns variable NAMES and rules only, never values, so its output is safe to paste.
 * `release` is true when CHECK_RELEASE is 1/true.
 */
export function checkEnv(env: Record<string, string | undefined>): CheckResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  // Fail closed: any non-empty CHECK_RELEASE that is not a clear "off" value turns the release rules on.
  const flag = (env.CHECK_RELEASE ?? '').trim().toLowerCase();
  const release = flag !== '' && !['0', 'false', 'no', 'off'].includes(flag);

  try {
    parseConfig(env);
  } catch (e) {
    if (e instanceof ConfigError) errors.push(...e.issues);
    else errors.push('configuration could not be parsed');
  }

  // A public-prefixed variable is bundled into browser code. Flag any that look like a credential, in every mode.
  for (const key of Object.keys(env)) {
    if (/^NEXT_PUBLIC_/.test(key) && /(SECRET|KEY|TOKEN|PASSWORD|SERVICE_ROLE)/i.test(key)) {
      errors.push(`${key}: a NEXT_PUBLIC_ variable is sent to every browser; rename it`);
    }
  }
  if (env.SUPABASE_SECRET_KEY && !env.SUPABASE_URL) warnings.push('SUPABASE_SECRET_KEY is set without SUPABASE_URL; Supabase stays disabled');

  if (release) {
    if (!env.FREEZE_AT_ISO?.trim()) errors.push('FREEZE_AT_ISO: required in release mode (an unset freeze would leak scores)');
    if (!env.EVENT_SLUG?.trim()) errors.push('EVENT_SLUG: required in release mode');
    if (!env.SCOREBOARD_URL?.trim()) errors.push('SCOREBOARD_URL: required in release mode');
    else {
      try {
        const u = new URL(env.SCOREBOARD_URL);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') errors.push('SCOREBOARD_URL: must be http or https');
      } catch {
        errors.push('SCOREBOARD_URL: not a valid URL');
      }
    }
    const bind = (env.HOSTNAME ?? env.HOST ?? '').trim().toLowerCase();
    if (bind && !LOOPBACK.has(bind)) errors.push('HOSTNAME/HOST: the Node server must bind to loopback; nginx is the public listener');
    if (env.TRUST_PROXY === 'true' || env.TRUST_PROXY === '1') warnings.push('TRUST_PROXY is on: make sure nginx sets X-Forwarded-For and the app is not reachable directly');
    if (!env.EVENT_START_ISO?.trim()) warnings.push('EVENT_START_ISO is unset: the board cannot show pre_event');
    if (!env.EVENT_END_ISO?.trim()) warnings.push('EVENT_END_ISO is unset');
  }

  return { ok: errors.length === 0, errors, warnings };
}

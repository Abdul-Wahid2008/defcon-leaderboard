import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { parseConfig } from '../src/lib/config';
import { metaFromConfig } from '../src/lib/store';

describe('metaFromConfig', () => {
  it('maps event settings and defaults the slug', () => {
    const m = metaFromConfig(parseConfig({ FREEZE_AT_ISO: '2026-10-31T10:00:00+05:30', EVENT_NAME: 'X' }));
    expect(m).toEqual({ slug: 'defcon', name: 'X', freezeAt: '2026-10-31T04:30:00.000Z' });
  });
});

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

// Needs `npm run build` first; skipped (not passed) when there is no build output.
const staticDir = path.resolve('.next/static');
describe.skipIf(!existsSync(staticDir))('client bundle secrets', () => {
  it('contains no Supabase client, key names or service-role markers', () => {
    const bad = /SUPABASE_SECRET_KEY|service_role|@supabase|sb_secret_|lb_scores|lb_audit/;
    const hits = walk(staticDir)
      .filter((f) => /\.(js|css|html|json|map|txt)$/.test(f))
      .filter((f) => bad.test(readFileSync(f, 'utf8')));
    expect(hits).toEqual([]);
  });
});

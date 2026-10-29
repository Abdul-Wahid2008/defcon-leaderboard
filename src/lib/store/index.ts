import 'server-only';
import path from 'node:path';
import { getConfig, type AppConfig } from '../config';
import { FallbackStore } from './fallback';
import { JsonlStore } from './jsonl';
import { MemoryStore } from './memory';
import { SupabaseStore } from './supabase';
import type { EventMeta } from './types';

export function metaFromConfig(c: AppConfig): EventMeta {
  return {
    slug: c.EVENT_SLUG ?? 'defcon',
    name: c.EVENT_NAME,
    ...(c.EVENT_START_ISO ? { startsAt: new Date(c.EVENT_START_ISO).toISOString() } : {}),
    ...(c.FREEZE_AT_ISO ? { freezeAt: new Date(c.FREEZE_AT_ISO).toISOString() } : {}),
    ...(c.EVENT_END_ISO ? { endsAt: new Date(c.EVENT_END_ISO).toISOString() } : {}),
  };
}

export async function createStore(c: AppConfig): Promise<FallbackStore> {
  const meta = metaFromConfig(c);
  let remote: SupabaseStore | null = null;
  if (c.SUPABASE_URL && c.SUPABASE_SECRET_KEY) {
    const { createLbDb } = await import('./supabase-db');
    remote = new SupabaseStore(createLbDb(c.SUPABASE_URL, c.SUPABASE_SECRET_KEY), meta);
  } else {
    console.warn('[store] Supabase disabled: SUPABASE_URL or SUPABASE_SECRET_KEY not set. Using memory + local JSONL only.');
  }
  return new FallbackStore(new MemoryStore(meta), new JsonlStore(path.join(c.DATA_DIR, 'snapshots.jsonl'), meta), remote);
}

const g = globalThis as unknown as { __lbStore?: Promise<FallbackStore> };

/** One store per process (survives dev HMR). Created on first use, never at import time. */
export function getStore(): Promise<FallbackStore> {
  g.__lbStore ??= createStore(getConfig()).catch((e) => {
    g.__lbStore = undefined;
    throw e;
  });
  return g.__lbStore;
}

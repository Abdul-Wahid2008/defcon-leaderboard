import { createHash } from 'node:crypto';
import { z } from 'zod';
import { clientKey, RateLimiter } from './ratelimit';
import type { Deps } from './runtime';
import { buildBoard, buildHistory, type ViewInput } from './view';

const MAX_BODY_BYTES = 512 * 1024;
const CACHE_MS = 3000;

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff' };

/** Minimal error body: a code and nothing else (no message, stack, host or URL). */
export function errorJson(status: number, code: string, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ error: code }), { status, headers: { ...JSON_HEADERS, 'Cache-Control': 'no-store', ...extra } });
}

// Per-process state, keyed on globalThis because route bundles may be instantiated more than once.
interface ApiState {
  limiter?: RateLimiter;
  limiterKey?: string;
  cache: Map<string, { at: number; body: string; etag: string }>;
}
const g = globalThis as unknown as { __lbApi?: ApiState };
const state = (): ApiState => (g.__lbApi ??= { cache: new Map() });

function limiterFor(deps: Deps): RateLimiter {
  const s = state();
  const limit = deps.cfg.RATE_LIMIT_PER_MIN;
  const k = `${limit}`;
  if (!s.limiter || s.limiterKey !== k) {
    s.limiter = new RateLimiter(limit);
    s.limiterKey = k;
  }
  return s.limiter;
}

export function resetApiStateForTests(): void {
  g.__lbApi = undefined;
}

const historyQuery = z.strictObject({ top: z.string().regex(/^\d{1,2}$/).transform(Number).pipe(z.number().int().min(1).max(30)).optional() });

export async function viewInput(deps: Deps): Promise<ViewInput> {
  return { cfg: deps.cfg, rounds: await deps.store.rounds(), revealed: deps.control().revealed, source: deps.source(), now: deps.now() };
}

type Kind = 'board' | 'history';

/** Shared pipeline for the two public JSON routes: limiter -> params -> 3 s cache -> build -> ETag/304. */
export async function serve(req: Request, kind: Kind, deps: Deps): Promise<Response> {
  const head = req.method === 'HEAD';
  const key = clientKey(req.headers, deps.cfg.TRUST_PROXY);
  if (key !== null && !limiterFor(deps).allow(key)) return errorJson(429, 'rate_limited', { 'Retry-After': '30' });

  const url = new URL(req.url);
  let top = 10;
  if (kind === 'history') {
    const keys = [...url.searchParams.keys()];
    if (new Set(keys).size !== keys.length) return errorJson(400, 'bad_request');
    const q = historyQuery.safeParse(Object.fromEntries(url.searchParams));
    if (!q.success) return errorJson(400, 'bad_request');
    top = q.data.top ?? 10;
  }
  // The board takes no parameters, so the key ignores the query: a unique query string cannot grow the cache.
  // `revealed` is part of the key so an unreveal takes effect at once instead of after the 3 s window.
  const cacheKey = `${kind === 'history' ? `history:${top}` : 'board'}:${deps.control().revealed}`;

  const s = state();
  const nowMs = deps.now();
  let hit = s.cache.get(cacheKey);
  if (!hit || nowMs - hit.at >= CACHE_MS) {
    const fresh = deps.ensureFresh().catch(() => undefined);
    // Only wait for the source when there is nothing at all to show.
    if ((await deps.store.latest()) === null) await fresh;
    const input = await viewInput(deps);
    const body = JSON.stringify(kind === 'board' ? buildBoard(input) : buildHistory(input, top));
    if (Buffer.byteLength(body) > MAX_BODY_BYTES) return errorJson(503, 'unavailable');
    hit = { at: nowMs, body, etag: `"${createHash('sha1').update(body).digest('base64url')}"` };
    s.cache.set(cacheKey, hit);
  }

  const headers = { ...JSON_HEADERS, 'Cache-Control': 'public, max-age=2', ETag: hit.etag };
  if (req.headers.get('if-none-match') === hit.etag) return new Response(null, { status: 304, headers });
  return new Response(head ? null : hit.body, { status: 200, headers });
}

/** Wraps a handler so a missing env, a store failure or a bug becomes a minimal 503, never a bare 500. */
export async function safely(req: Request, kind: Kind, getDeps: () => Promise<Deps>): Promise<Response> {
  try {
    return await serve(req, kind, await getDeps());
  } catch {
    return errorJson(503, 'unavailable');
  }
}

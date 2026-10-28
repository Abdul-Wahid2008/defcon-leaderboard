import { describe, expect, it } from 'vitest';
import { fetchSource } from '../src/lib/source/fetcher';
import { SourceError } from '../src/lib/source/types';

const URL_OK = 'http://score.test:8080/data/scoreboard.json';
const base = { url: URL_OK, allowedHosts: ['score.test:8080'] };
const json = (body: string, init: ResponseInit = {}) =>
  new Response(body, { status: 200, headers: { 'content-type': 'application/json' }, ...init });

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(SourceError);
    expect((e as SourceError).message).not.toContain('score.test'); // no host in a message
    expect(JSON.stringify(e, Object.getOwnPropertyNames(e))).not.toContain('score.test');
    return (e as SourceError).code;
  }
  return 'no error';
}

describe('fetchSource', () => {
  it('returns the decoded document and sends a locked-down request', async () => {
    let init: RequestInit | undefined;
    const out = await fetchSource({ ...base, fetchImpl: async (_u, i) => ((init = i), json('{"a":1}')) });
    expect(out).toEqual({ a: 1 });
    expect(init?.redirect).toBe('error');
    expect(init?.credentials).toBe('omit');
    expect(init?.method).toBe('GET');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('refuses an unconfigured, malformed, credentialed or non-http URL', async () => {
    expect(await code(fetchSource({ url: undefined, allowedHosts: [] }))).toBe('not_configured');
    expect(await code(fetchSource({ url: 'nope', allowedHosts: [] }))).toBe('not_configured');
    expect(await code(fetchSource({ url: 'http://u:p@score.test:8080/x', allowedHosts: ['score.test:8080'] }))).toBe('not_configured');
    expect(await code(fetchSource({ url: 'file:///etc/passwd', allowedHosts: ['score.test:8080'] }))).toBe('not_configured');
  });

  it('refuses a host that is not allow-listed without calling fetch', async () => {
    let called = false;
    const c = await code(fetchSource({ url: URL_OK, allowedHosts: ['other.test'], fetchImpl: async () => ((called = true), json('{}')) }));
    expect(c).toBe('host_not_allowed');
    expect(called).toBe(false);
  });

  it('maps HTTP errors to a status code only', async () => {
    expect(await code(fetchSource({ ...base, fetchImpl: async () => new Response('x', { status: 503 }) }))).toBe('http_503');
    expect(await code(fetchSource({ ...base, fetchImpl: async () => new Response('x', { status: 404 }) }))).toBe('http_404');
  });

  it('rejects redirects (status or fetch-level)', async () => {
    expect(await code(fetchSource({ ...base, fetchImpl: async () => new Response(null, { status: 302, headers: { location: 'http://evil.test/' } }) }))).toBe('redirect');
    expect(
      await code(
        fetchSource({
          ...base,
          fetchImpl: async () => {
            throw new TypeError('fetch failed', { cause: new Error('unexpected redirect') });
          },
        }),
      ),
    ).toBe('redirect');
  });

  it('times out', async () => {
    const hang: typeof fetch = (_u, i) =>
      new Promise((_res, rej) => i?.signal?.addEventListener('abort', () => rej(i.signal!.reason)));
    expect(await code(fetchSource({ ...base, timeoutMs: 30, fetchImpl: hang }))).toBe('timeout');
  });

  it('maps network failures without leaking the cause', async () => {
    expect(
      await code(fetchSource({ ...base, fetchImpl: async () => { throw new TypeError('connect ECONNREFUSED 10.1.2.3:8080'); } })),
    ).toBe('network');
  });

  it('rejects a wrong content type', async () => {
    expect(await code(fetchSource({ ...base, fetchImpl: async () => new Response('{}', { headers: { 'content-type': 'text/html' } }) }))).toBe('bad_content_type');
    expect(await code(fetchSource({ ...base, fetchImpl: async () => new Response('{}') }))).toBe('bad_content_type');
  });

  it('accepts json with a charset and +json types', async () => {
    const mk = (ct: string) => async () => new Response('{"a":2}', { headers: { 'content-type': ct } });
    expect(await fetchSource({ ...base, fetchImpl: mk('application/json; charset=utf-8') })).toEqual({ a: 2 });
    expect(await fetchSource({ ...base, fetchImpl: mk('application/vnd.api+json') })).toEqual({ a: 2 });
  });

  it('caps the body by declared length and by streamed size', async () => {
    expect(await code(fetchSource({ ...base, maxBytes: 10, fetchImpl: async () => json('{}', { headers: { 'content-type': 'application/json', 'content-length': '999999' } }) }))).toBe('too_large');
    const big = '{"a":"' + 'x'.repeat(5000) + '"}';
    expect(await code(fetchSource({ ...base, maxBytes: 1000, fetchImpl: async () => json(big) }))).toBe('too_large');
  });

  it('caps a response that exposes no stream', async () => {
    const noBody = (text: string) =>
      ({ status: 200, ok: true, headers: new Headers({ 'content-type': 'application/json' }), body: null, text: async () => text }) as unknown as Response;
    expect(await code(fetchSource({ ...base, maxBytes: 10, fetchImpl: async () => noBody('x'.repeat(50)) }))).toBe('too_large');
    expect(await fetchSource({ ...base, fetchImpl: async () => noBody('{"a":3}') })).toEqual({ a: 3 });
  });

  it('rejects garbage and truncated JSON', async () => {
    expect(await code(fetchSource({ ...base, fetchImpl: async () => json('<html>') }))).toBe('bad_json');
    expect(await code(fetchSource({ ...base, fetchImpl: async () => json('{"a":') }))).toBe('bad_json');
    expect(await code(fetchSource({ ...base, fetchImpl: async () => json('') }))).toBe('bad_json');
  });

  it('host comparison is case-insensitive on the URL side', async () => {
    const out = await fetchSource({ url: 'http://SCORE.test:8080/x', allowedHosts: ['score.test:8080'], fetchImpl: async () => json('[]') });
    expect(out).toEqual([]);
  });
});

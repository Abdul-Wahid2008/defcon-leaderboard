import { SourceError } from './types';

export interface FetchSourceOptions {
  url: string | undefined;
  /** Lower-cased `host[:port]` values. The request host must be listed. */
  allowedHosts: readonly string[];
  timeoutMs?: number;
  maxBytes?: number;
  /** Injected in tests. */
  fetchImpl?: typeof fetch;
}

export const DEFAULT_TIMEOUT_MS = 5_000;
export const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;

const JSON_TYPE = /^(application\/([a-z0-9.+-]+\+)?json|text\/json)\s*(;|$)/i;

/**
 * Fetches and decodes the scoreboard document. Every failure is a SourceError with a short code; neither the URL nor
 * the host ever appears in a message. No credentials, cookies or redirects are followed.
 */
export async function fetchSource(opts: FetchSourceOptions): Promise<unknown> {
  if (!opts.url) throw new SourceError('not_configured');
  let u: URL;
  try {
    u = new URL(opts.url);
  } catch {
    throw new SourceError('not_configured', 'url: not parseable');
  }
  if ((u.protocol !== 'http:' && u.protocol !== 'https:') || u.username || u.password) throw new SourceError('not_configured', 'url: scheme or credentials');
  if (!opts.allowedHosts.includes(u.host.toLowerCase())) throw new SourceError('host_not_allowed');

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const doFetch = opts.fetchImpl ?? fetch;

  let res: Response;
  try {
    res = await doFetch(u, {
      method: 'GET',
      redirect: 'error',
      credentials: 'omit',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    throw classify(e);
  }

  // Release the socket before refusing a response whose body we will not read.
  const refuse = async (e: SourceError): Promise<never> => {
    await res.body?.cancel().catch(() => undefined);
    throw e;
  };
  if (res.status >= 300 && res.status < 400) return refuse(new SourceError('redirect'));
  if (!res.ok) return refuse(new SourceError(`http_${res.status}`));
  if (!JSON_TYPE.test(res.headers.get('content-type') ?? '')) return refuse(new SourceError('bad_content_type'));
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) return refuse(new SourceError('too_large'));

  let text: string;
  try {
    text = await readCapped(res, maxBytes);
  } catch (e) {
    throw classify(e);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new SourceError('bad_json');
  }
}

function classify(e: unknown): SourceError {
  if (e instanceof SourceError) return e;
  const name = (e as { name?: string })?.name;
  if (name === 'TimeoutError' || name === 'AbortError') return new SourceError('timeout');
  const cause = String((e as { cause?: { message?: string } })?.cause?.message ?? (e as Error)?.message ?? '');
  if (/redirect/i.test(cause)) return new SourceError('redirect');
  return new SourceError('network');
}

async function readCapped(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) {
    const t = await res.text();
    if (Buffer.byteLength(t) > maxBytes) throw new SourceError('too_large');
    return t;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new SourceError('too_large');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

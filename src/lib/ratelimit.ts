/** Fixed-window per-key limiter with bounded memory. */
export class RateLimiter {
  private windows = new Map<string, { start: number; n: number }>();
  constructor(
    private readonly limit: number,
    private readonly windowMs = 60_000,
    private readonly maxKeys = 10_000,
    private readonly now: () => number = Date.now,
  ) {}

  /** True when the request is allowed. */
  allow(key: string): boolean {
    const t = this.now();
    if (!this.windows.has(key) && this.windows.size >= this.maxKeys) {
      this.sweep(t);
      // Still full of live windows (many distinct keys): fail open rather than lock out newcomers; nginx is the real limiter.
      if (this.windows.size >= this.maxKeys) return true;
    }
    let w = this.windows.get(key);
    if (!w || t - w.start >= this.windowMs) {
      w = { start: t, n: 0 };
      this.windows.set(key, w);
    }
    w.n++;
    return w.n <= this.limit;
  }

  private sweep(t: number) {
    for (const [k, w] of this.windows) if (t - w.start >= this.windowMs) this.windows.delete(k);
  }
}

/**
 * Next.js route handlers do not expose the socket address, so the client key comes from X-Forwarded-For and only when
 * TRUST_PROXY is on: then the RIGHT-most entry is used (the hop our own proxy appended; anything to its left is
 * client-controlled). Without a usable key the request is not limited here: a shared bucket would let one noisy client lock
 * everyone out, so per-client limiting is then nginx's job (docs/DEPLOY.md).
 */
export function clientKey(headers: Headers, trustProxy: boolean): string | null {
  if (!trustProxy) return null;
  const xff = headers.get('x-forwarded-for');
  const last = xff?.split(',').at(-1)?.trim();
  return last && last.length <= 64 && /^[0-9a-fA-F:.]+$/.test(last) ? last : null;
}

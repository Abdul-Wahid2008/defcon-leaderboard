import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { contentSecurityPolicy, newNonce, staticSecurityHeaders } from '../src/lib/security-headers';
import { proxy } from '../src/proxy';
import nextConfig from '../next.config';

describe('security headers', () => {
  it('CSP forbids inline scripts without the nonce, framing, objects and forms', () => {
    const csp = contentSecurityPolicy('abc', false);
    expect(csp).toContain("script-src 'self' 'nonce-abc' 'strict-dynamic'");
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(csp).not.toMatch(/script-src[^;]*unsafe-eval/);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("form-action 'none'");
    expect(csp).not.toMatch(/https?:\/\//); // no third-party origin anywhere
  });

  it('unsafe-eval is development only', () => {
    expect(contentSecurityPolicy('n', true)).toContain("'unsafe-eval'");
  });

  it('nonces are unique', () => {
    expect(newNonce()).not.toBe(newNonce());
  });

  it('static headers include the required set and no CORS or HSTS', () => {
    const keys = staticSecurityHeaders.map((h) => h.key.toLowerCase());
    for (const k of ['x-content-type-options', 'x-frame-options', 'referrer-policy', 'permissions-policy', 'x-robots-tag']) {
      expect(keys).toContain(k);
    }
    expect(keys.some((k) => k.startsWith('access-control-'))).toBe(false);
    expect(keys).not.toContain('strict-transport-security');
    expect(staticSecurityHeaders.find((h) => h.key === 'Referrer-Policy')?.value).toBe('no-referrer');
  });

  it('next.config applies them to every path and hides X-Powered-By', async () => {
    const rules = await nextConfig.headers!();
    expect(rules[0].source).toBe('/:path*');
    expect(rules[0].headers).toEqual(staticSecurityHeaders);
    expect(nextConfig.poweredByHeader).toBe(false);
    expect(nextConfig.productionBrowserSourceMaps).toBe(false);
  });
});

describe('proxy', () => {
  it('stamps a fresh CSP nonce on pages', () => {
    const a = proxy(new NextRequest('http://localhost/'));
    const b = proxy(new NextRequest('http://localhost/'));
    const ca = a.headers.get('content-security-policy')!;
    const cb = b.headers.get('content-security-policy')!;
    expect(ca).toMatch(/'nonce-[A-Za-z0-9+/=]+'/);
    expect(ca).not.toBe(cb);
  });

  it('answers a malformed percent escape with 400', () => {
    expect(proxy(new NextRequest('http://localhost/%E0%A4%A')).status).toBe(400);
  });

  it('adds no CSP to JSON routes', () => {
    expect(proxy(new NextRequest('http://localhost/api/healthz')).headers.get('content-security-policy')).toBeNull();
  });
});

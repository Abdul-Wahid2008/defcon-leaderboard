/**
 * Security headers shared by next.config.ts (static headers) and src/proxy.ts (per-request CSP), and by their tests.
 * The leaderboard is public: no CORS headers are ever added, no cookies are ever set.
 */

export function contentSecurityPolicy(nonce: string, isDev: boolean): string {
  return [
    "default-src 'self'",
    // 'strict-dynamic' lets Next's own bootstrap load its chunks; an injected inline script has no nonce and cannot run.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    // Tailwind output is a same-origin file; React inline style attributes need 'unsafe-inline' (a nonce cannot cover them).
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self'${isDev ? ' ws:' : ''}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

export const staticSecurityHeaders: { key: string; value: string }[] = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()' },
  { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
];

export function newNonce(): string {
  return Buffer.from(crypto.randomUUID()).toString('base64');
}

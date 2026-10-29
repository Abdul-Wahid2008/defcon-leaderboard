import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { contentSecurityPolicy, newNonce } from './lib/security-headers';

const isDev = process.env.NODE_ENV !== 'production';

export function proxy(req: NextRequest) {
  // A malformed percent-escape must be a clean 400, not a framework 500.
  try {
    decodeURIComponent(req.nextUrl.pathname);
  } catch {
    return new NextResponse('{"error":"bad_request"}', { status: 400, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
  }

  // Public and read-only: anything but GET, HEAD or OPTIONS gets a minimal 405 (the framework answers TRACE with a 500).
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return new NextResponse('{"error":"method_not_allowed"}', { status: 405, headers: { Allow: 'GET, HEAD, OPTIONS', 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
  }

  // JSON routes carry no markup, so they need no CSP.
  if (req.nextUrl.pathname.startsWith('/api/')) return NextResponse.next();

  const nonce = newNonce();
  const csp = contentSecurityPolicy(nonce, isDev);
  const headers = new Headers(req.headers);
  headers.set('x-nonce', nonce);
  headers.set('Content-Security-Policy', csp);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set('Content-Security-Policy', csp);
  return res;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};

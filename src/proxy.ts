import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { contentSecurityPolicy, newNonce } from './lib/security-headers';

const isDev = process.env.NODE_ENV !== 'production';

export function proxy(req: NextRequest) {
  // A malformed percent-escape must be a clean 400, not a framework 500.
  try {
    decodeURIComponent(req.nextUrl.pathname);
  } catch {
    return new NextResponse('Bad request', { status: 400 });
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

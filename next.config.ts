import type { NextConfig } from 'next';
import { staticSecurityHeaders } from './src/lib/security-headers';

// The Content-Security-Policy carries a per-request nonce and is set in src/proxy.ts.
// HSTS is deliberately absent: it is only correct over HTTPS, so nginx adds it under TLS.
const nextConfig: NextConfig = {
  poweredByHeader: false,
  productionBrowserSourceMaps: false,
  async headers() {
    return [{ source: '/:path*', headers: staticSecurityHeaders }];
  },
};

export default nextConfig;

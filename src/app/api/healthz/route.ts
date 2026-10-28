// Liveness only: no config, no store, no upstream. It must answer even when the configuration is broken.
export const dynamic = 'force-dynamic';

const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };

export function GET() {
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
}

export function HEAD() {
  return new Response(null, { status: 200, headers });
}

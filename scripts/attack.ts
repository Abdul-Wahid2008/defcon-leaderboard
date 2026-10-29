// Attack pass against the PRODUCTION build with the FAKE source. Prints a table of attempts and results and writes
// tmp/attack-results.md. Exits 1 if any expectation fails. Localhost only; starts and kills its own processes.
//   npm run build && npm run attack
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';

const root = process.cwd();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const kids: ChildProcess[] = [];
const spawnNode = (args: string[], env: Record<string, string> = {}) => {
  const c = spawn(process.execPath, args, { env: { ...process.env, ...env } as NodeJS.ProcessEnv, stdio: 'ignore' });
  kids.push(c);
  return c;
};
const fake = (q: string) => fetch(`http://127.0.0.1:3290/__${q}`).then((r) => r.json());

interface Res {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}
function raw(opts: { method?: string; path: string; headers?: Record<string, string>; body?: string }): Promise<Res> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: 3200, method: opts.method ?? 'GET', path: opts.path, headers: opts.headers, timeout: 8000, insecureHTTPParser: false }, (res) => {
      const chunks: Buffer[] = [];
      let n = 0;
      res.on('data', (c: Buffer) => {
        n += c.length;
        if (n < 2_000_000) chunks.push(c);
      });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end(opts.body);
  });
}

const rows: { ok: boolean; id: string; attempt: string; result: string }[] = [];
async function attempt(id: string, what: string, fn: () => Promise<[boolean, string]>) {
  let ok = false;
  let result: string;
  try {
    [ok, result] = await fn();
  } catch (e) {
    result = `threw ${(e as Error).message}`;
  }
  rows.push({ ok, id, attempt: what, result });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${what} -> ${result}`);
}
const never5xx = (r: Res) => r.status < 500;
const leaks = (s: string) => /SCOREBOARD_URL|SUPABASE|127\.0\.0\.1:3290|at .*\(.*:\d+:\d+\)|node_modules|ECONN|stack/i.test(s);

async function startServer(env: Record<string, string>, dataName: string, keepData = false) {
  const dir = path.join(root, 'tmp', dataName);
  if (!keepData) fs.rmSync(dir, { recursive: true, force: true });
  const now = Date.now();
  const srv = spawnNode([path.join(root, 'node_modules', 'next', 'dist', 'bin', 'next'), 'start', '-H', '127.0.0.1', '-p', '3200'], {
    SCOREBOARD_URL: 'http://127.0.0.1:3290/scoreboard.json', EVENT_SLUG: 'atk', POLL_SEC: '5', STALE_AFTER_SEC: '30', DATA_DIR: dir, NODE_ENV: 'production',
    // Isolation: a real .env.local on the host must never leak in (secrets, proxy trust) or receive fake rounds.
    SUPABASE_URL: '', SUPABASE_SECRET_KEY: '', TRUST_PROXY: 'false',
    EVENT_START_ISO: new Date(now - 3_600_000).toISOString(), FREEZE_AT_ISO: new Date(now + 3_600_000).toISOString(), ...env,
  });
  for (let i = 0; i < 80; i++) {
    try {
      const r = await raw({ path: '/api/board' });
      if (r.status === 200 && JSON.parse(r.body).meta.state !== 'unavailable') return srv;
    } catch {
      /* not up */
    }
    await sleep(500);
  }
  throw new Error('server did not start');
}
const stopServer = async (c: ChildProcess) => (c.kill(), kids.splice(kids.indexOf(c), 1), await sleep(800));

async function main() {
  spawnNode([path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs'), 'scripts/fake-scoreboard.ts'], { FAKE_ROUND_MS: '2000' });
  await sleep(1500);

  // ---------------- server 1: normal, TRUST_PROXY=false ----------------
  const DUMMY_KEY = 'sb_secret_DUMMYDUMMYDUMMYDUMMYDUMMY1234';
  const s1 = await startServer({ SUPABASE_URL: 'http://127.0.0.1:9', SUPABASE_SECRET_KEY: DUMMY_KEY }, 'atk1');
  const base = await raw({ path: '/api/board' });
  const baseJson = JSON.parse(base.body);

  for (const v of ['NaN', '-1', '1e9', '0', '31', 'abc', '1.5', '%00', '', '10%27', '99999999999999999999', '%EF%BC%90%EF%BC%95']) {
    await attempt('A1', `GET /api/history?top=${v}`, async () => {
      const r = await raw({ path: `/api/history?top=${v}` });
      return [r.status === 400 && r.body === '{"error":"bad_request"}', `${r.status} ${r.body.slice(0, 40)}`];
    });
  }
  for (const q of ['round=9', 't=1', '__proto__=1', 'constructor[prototype]=x', 'top=3&top=4', 'top=3&x=1', 'at=1']) {
    await attempt('A2', `GET /api/history?${q}`, async () => {
      const r = await raw({ path: `/api/history?${q}` });
      // Next.js drops a __proto__ query key before the handler sees it, so it is simply ignored: accept 400, or 200 with the plain history.
      const ignored = q.startsWith('__proto__') && r.status === 200 && r.body === (await raw({ path: '/api/history' })).body;
      return [r.status === 400 || ignored, `${r.status}${ignored ? ' (key dropped by the framework, body identical to no query)' : ''}`];
    });
  }
  await attempt('A3', 'GET /api/board?round=1&t=1&__proto__=x (board ignores the query)', async () => {
    const r = await raw({ path: '/api/board?round=1&t=1&__proto__=x' });
    const j = JSON.parse(r.body);
    return [r.status === 200 && j.meta.round >= baseJson.meta.round, `${r.status} round ${j.meta.round}`];
  });
  for (const m of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'TRACE', 'CONNECT', 'PROPFIND']) {
    await attempt('A4', `${m} /api/board`, async () => {
      const r = await raw({ method: m, path: '/api/board', body: m === 'POST' || m === 'PUT' ? '{"x":1}' : undefined, headers: { Origin: 'http://evil.example' } }).catch((e: Error) => ({ status: -1, headers: {}, body: e.message }) as Res);
      // TRACE cannot be represented as a fetch Request, so Next answers it with its own generic 500 before any of our code runs. The body is the fixed text below; nginx blocks the method (DEPLOY.md).
      const traceOk = m === 'TRACE' && r.status === 500 && r.body === 'Internal Server Error';
      const want = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(m) ? r.status === 405 : m === 'OPTIONS' ? r.status === 204 || r.status === 200 : m === 'TRACE' ? traceOk : r.status === -1 || (r.status >= 400 && r.status < 500);
      return [want && !r.headers['access-control-allow-origin'] && !leaks(r.body) && r.body.length < 200, `${r.status}${r.status === -1 ? ' (connection refused by server)' : ''}`];
    });
  }
  await attempt('A5', 'HEAD /api/board has headers and no body', async () => {
    const r = await raw({ method: 'HEAD', path: '/api/board' });
    return [r.status === 200 && r.body === '' && !!r.headers.etag, String(r.status)];
  });
  for (const p of ['/api/../.env', '/..%2f..%2fpackage.json', '/%2e%2e/%2e%2e/.env.local', '/api/%2e%2e/%2e%2e/.env', '/_next/../.env', '/%252e%252e/%252e%252e/.env', '/api/board/..;/..;/.env', '/.env', '/data/control.json', '/package.json', '/src/lib/config.ts', '/config/source-map.json', '/%00', '/api/%'] as string[]) {
    await attempt('A6', `GET ${p}`, async () => {
      const r = await raw({ path: p });
      return [(r.status === 400 || r.status === 404) && !/SCOREBOARD_URL|SUPABASE|"name": ?"defcon|teamsPath|import /.test(r.body) && !leaks(r.body), String(r.status)];
    });
  }
  await attempt('A7', 'GET with a 100 KB path', async () => {
    const r = await raw({ path: '/' + 'a'.repeat(100_000) }).catch((e: Error) => ({ status: -1, headers: {}, body: e.message }) as Res);
    return [r.status === -1 || (r.status >= 400 && r.status < 500), String(r.status)];
  });
  await attempt('A7', 'GET /api/board with a 100 KB header', async () => {
    const r = await raw({ path: '/api/board', headers: { 'X-Big': 'b'.repeat(100_000) } }).catch((e: Error) => ({ status: -1, headers: {}, body: e.message }) as Res);
    return [r.status === -1 || r.status === 431 || (r.status < 500), String(r.status)];
  });
  await attempt('A7', 'GET /api/board with 5000 headers', async () => {
    const headers: Record<string, string> = {};
    for (let i = 0; i < 5000; i++) headers['x-h' + i] = '1';
    const r = await raw({ path: '/api/board', headers }).catch((e: Error) => ({ status: -1, headers: {}, body: e.message }) as Res);
    return [r.status === -1 || r.status === 431 || r.status < 500, String(r.status)];
  });
  await attempt('A8', '600 parallel connections to /api/healthz, then the board still answers', async () => {
    const rs = await Promise.all(Array.from({ length: 600 }, () => raw({ path: '/api/healthz' }).catch(() => null)));
    const okN = rs.filter((r) => r?.status === 200).length;
    const after = await raw({ path: '/api/board' });
    return [okN >= 590 && after.status === 200, `${okN}/600 ok, board ${after.status}`];
  });
  await attempt('A8', '300 parallel GET / (server-rendered page), then the board still answers', async () => {
    const rs = await Promise.all(Array.from({ length: 300 }, () => raw({ path: '/' }).catch(() => null)));
    const okN = rs.filter((r) => r?.status === 200).length;
    const after = await raw({ path: '/api/board' });
    return [okN >= 295 && after.status === 200, `${okN}/300 ok, board ${after.status}`];
  });
  await attempt('A8b', 'slowloris: 50 sockets sending one header byte per second for 5 s; board still answers', async () => {
    const socks = Array.from({ length: 50 }, () => {
      const s = net.connect(3200, '127.0.0.1');
      s.on('error', () => undefined);
      s.write('GET /api/board HTTP/1.1\r\nHost: x\r\nX-Slow: ');
      return s;
    });
    const t = setInterval(() => socks.forEach((s) => s.write('a')), 1000);
    await sleep(5000);
    const after = await raw({ path: '/api/board' });
    clearInterval(t);
    socks.forEach((s) => s.destroy());
    return [after.status === 200, `board ${after.status} with 50 stalled sockets (a reverse proxy timeout is the real defence: DEPLOY.md)`];
  });
  for (const [h, v] of [['Host', 'evil.example'], ['X-Forwarded-Host', 'evil.example'], ['X-Forwarded-Proto', 'https://evil.example'], ['X-Original-URL', '/api/admin'], ['X-Rewrite-URL', '/.env'], ['X-HTTP-Method-Override', 'DELETE']] as const) {
    await attempt('A9', `GET /api/board with ${h}: ${v}`, async () => {
      const r = await raw({ path: '/api/board', headers: { [h]: v } });
      const echoed = JSON.stringify(r.headers).includes('evil.example') || r.body.includes('evil.example');
      return [r.status === 200 && !echoed && JSON.parse(r.body).teams.length > 0, `${r.status}, echoed=${echoed}`];
    });
  }
  await attempt('A9', '/ with Host/X-Forwarded-Host poisoning, then a clean request is not poisoned', async () => {
    const bad = await raw({ path: '/', headers: { Host: 'evil.example', 'X-Forwarded-Host': 'evil.example' } });
    const clean = await raw({ path: '/' });
    const echoed = (r: Res) => r.body.includes('evil.example') || JSON.stringify(r.headers).includes('evil.example');
    return [bad.status < 500 && !echoed(bad) && clean.status === 200 && !echoed(clean), `poisoned ${bad.status} echoed=${echoed(bad)}, clean ${clean.status} echoed=${echoed(clean)}`];
  });
  await attempt('A10', 'Range: bytes=0-10 on /api/board', async () => {
    const r = await raw({ path: '/api/board', headers: { Range: 'bytes=0-10' } });
    let json = true;
    try {
      JSON.parse(r.body);
    } catch {
      json = false;
    }
    return [never5xx(r) && (r.status !== 200 || json), `${r.status}, body ${r.body.length} bytes`];
  });
  for (const [what, p] of [
    ['100 KB query string on the board', '/api/board?x=' + 'a'.repeat(100_000)],
    ['20 000 parameters on history', '/api/history?' + Array.from({ length: 20_000 }, (_, i) => 'p' + i + '=1').join('&')],
    ['invalid percent escape in a value', '/api/history?top=%ZZ'],
    ['invalid UTF-8 in a value', '/api/history?top=%FF'],
    ['/_next/image proxying an internal URL', '/_next/image?url=http%3A%2F%2F127.0.0.1%3A3290%2Fscoreboard.json&w=64&q=75'],
    ['/_next/data probe', '/_next/data/x/index.json'],
  ] as const) {
    await attempt('A18', what, async () => {
      const r = await raw({ path: p }).catch((e: Error) => ({ status: -1, headers: {}, body: e.message }) as Res);
      return [r.status === -1 || (r.status >= 400 && r.status < 500), `${r.status}`];
    });
  }
  await attempt('A19', 'TRUST_PROXY=false: 300 requests with rotating forged X-Forwarded-For are all served (no app-side limiting, no lockout)', async () => {
    const codes = new Set<number>();
    for (let i = 0; i < 300; i++) codes.add((await raw({ path: '/api/board', headers: { 'X-Forwarded-For': `9.9.${i % 200}.${i % 250}` } })).status);
    return [codes.size === 1 && codes.has(200), `${[...codes]}`];
  });
  await attempt('A20', 'duplicate Content-Length and CL+TE request shapes do not crash the server', async () => {
    for (const head of ['POST /api/board HTTP/1.1\r\nHost: x\r\nContent-Length: 4\r\nContent-Length: 9\r\n\r\nabcd', 'POST /api/board HTTP/1.1\r\nHost: x\r\nContent-Length: -1\r\n\r\n']) {
      await new Promise<void>((res) => {
        const s = net.connect(3200, '127.0.0.1');
        s.on('error', () => res());
        s.on('close', () => res());
        s.write(head.replace(/\\r\\n/g, '\r\n'));
        setTimeout(() => (s.destroy(), res()), 1000);
      });
    }
    return [(await raw({ path: '/api/healthz' })).status === 200, 'healthz 200 afterwards'];
  });
  await attempt('A11', 'no Set-Cookie and no CORS headers on / , /api/board , /api/history , /api/healthz , a 404 (re-check after the above)', async () => {
    const bad: string[] = [];
    for (const p of ['/', '/api/board', '/api/history', '/api/healthz', '/nope', '/api/nope']) {
      const r = await raw({ path: p, headers: { Origin: 'http://evil.example' } });
      for (const h of Object.keys(r.headers)) if (h === 'set-cookie' || h.startsWith('access-control-')) bad.push(`${p}:${h}`);
    }
    return [bad.length === 0, bad.join(',') || 'none'];
  });
  await attempt('A11', 'no Set-Cookie and no CORS headers on / , /api/board , /api/history , /api/healthz , a 404', async () => {
    const paths = ['/', '/api/board', '/api/history', '/api/healthz', '/nope', '/api/nope'];
    const bad: string[] = [];
    for (const p of paths) {
      const r = await raw({ path: p, headers: { Origin: 'http://evil.example' } });
      for (const h of Object.keys(r.headers)) if (h === 'set-cookie' || h.startsWith('access-control-')) bad.push(`${p}:${h}`);
    }
    return [bad.length === 0, bad.join(',') || 'none'];
  });
  await attempt('A12', 'security headers on / and /api/board; CSP nonce differs per request', async () => {
    const a = await raw({ path: '/' });
    const b = await raw({ path: '/' });
    const n = (r: Res) => /nonce-([A-Za-z0-9+/=]+)/.exec(String(r.headers['content-security-policy']))?.[1];
    const api = await raw({ path: '/api/board' });
    const need = ['x-content-type-options', 'referrer-policy', 'x-frame-options', 'permissions-policy', 'x-robots-tag'];
    const missing = need.filter((h) => !a.headers[h] || !api.headers[h]);
    return [!!n(a) && n(a) !== n(b) && !missing.length && !a.headers['strict-transport-security'] && !a.headers['x-powered-by'], `nonce ${n(a)?.slice(0, 6)}.. vs ${n(b)?.slice(0, 6)}.., missing [${missing}]`];
  });
  await attempt('A13', 'Cache-Control: public max-age=2 only on board/history; no-store elsewhere', async () => {
    const cc = async (p: string) => String((await raw({ path: p })).headers['cache-control']);
    const [b, h, z, bad] = [await cc('/api/board'), await cc('/api/history'), await cc('/api/healthz'), await cc('/api/nope')];
    return [b === 'public, max-age=2' && h === 'public, max-age=2' && z === 'no-store' && bad === 'no-store', `${b} | ${h} | ${z} | ${bad}`];
  });
  await attempt('A14', '.next/static has no source maps, and /_next/static/*.map is not served', async () => {
    const dir = path.join(root, '.next', 'static');
    const walk = (d: string): string[] => fs.readdirSync(d).flatMap((n) => (fs.statSync(path.join(d, n)).isDirectory() ? walk(path.join(d, n)) : [path.join(d, n)]));
    const files = walk(dir);
    const maps = files.filter((f) => f.endsWith('.map'));
    const js = files.find((f) => f.endsWith('.js'))!;
    const rel = '/_next/static/' + path.relative(dir, js).split(path.sep).join('/');
    const r = await raw({ path: rel + '.map' });
    const secret = files.filter((f) => /\.(js|css|html|json)$/.test(f)).some((f) => /SUPABASE_SECRET_KEY|sb_secret_|service_role|SCOREBOARD_URL/.test(fs.readFileSync(f, 'utf8')));
    // Value-based: this server runs with a dummy secret and URL; neither value may appear in served HTML, JSON or any built client or server-rendered file.
    const html = (await raw({ path: '/' })).body + (await raw({ path: '/api/board' })).body + (await raw({ path: '/api/history' })).body;
    const serverFiles = fs.existsSync(path.join(root, '.next', 'server', 'app')) ? walk(path.join(root, '.next', 'server', 'app')).filter((f) => /\.(html|rsc|json|body|meta)$/.test(f)) : [];
    const values = ['DUMMYDUMMYDUMMYDUMMYDUMMY', '127.0.0.1:9', '127.0.0.1:3290'];
    const valueLeak = [...files, ...serverFiles].some((f) => values.some((v) => fs.readFileSync(f, 'utf8').includes(v))) || values.some((v) => html.includes(v));
    return [maps.length === 0 && r.status === 404 && !secret && !valueLeak, `${maps.length} map files, map URL ${r.status}, secret names ${secret}, secret/URL values in client files or served bodies ${valueLeak}`];
  });
  await attempt('A15', 'HTTP request smuggling shapes (CL+TE, duplicate CL) do not crash the server', async () => {
    await new Promise<void>((res) => {
      const s = net.connect(3200, '127.0.0.1');
      s.on('error', () => res());
      s.on('close', () => res());
      s.write('POST /api/board HTTP/1.1\r\nHost: x\r\nContent-Length: 4\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\nGET /api/healthz HTTP/1.1\r\nHost: x\r\n\r\n');
      setTimeout(() => (s.destroy(), res()), 1500);
    });
    const after = await raw({ path: '/api/healthz' });
    return [after.status === 200, `healthz ${after.status} afterwards`];
  });

  // hostile team names from the source
  await fake('mode?m=hostile');
  await sleep(14_000);
  await attempt('A16', 'hostile team names (script tag, RTL override, zero-width, 300 chars, __proto__) via the source', async () => {
    const r = await raw({ path: '/api/board' });
    const j = JSON.parse(r.body) as { teams: { name: string; teamId: string }[] };
    const bad = j.teams.filter((t) => /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/.test(t.name) || [...t.name].length > 40);
    const html = (await raw({ path: '/' })).body;
    const rawScript = html.includes('<script>alert(1)</script>');
    const engaged = j.teams.some((t) => /script/i.test(t.name)) && j.teams.some((t) => t.name === '__proto__');
    return [engaged && bad.length === 0 && !rawScript, `hostile mode engaged=${engaged}, ${j.teams.length} teams, ${bad.length} names with control/bidi/over-length, raw <script> in HTML: ${rawScript}`];
  });
  await fake('mode?m=ok');

  // source misbehaviour: previous data must be kept, the server must stay up
  const before = JSON.parse((await raw({ path: '/api/board' })).body);
  for (const m of ['huge', 'redirect', 'garbage', '500', 'dupkeys', 'timeout']) {
    await fake(`mode?m=${m}`);
    await sleep(m === 'timeout' ? 12_000 : 7000);
    await attempt('A17', `source mode "${m}": previous data kept, no 5xx, no leak, server up`, async () => {
      const r = await raw({ path: '/api/board' });
      const j = JSON.parse(r.body);
      return [r.status === 200 && j.teams.length === before.teams.length && j.meta.round >= before.meta.round && !leaks(r.body), `${r.status}, state ${j.meta.state}, round ${j.meta.round}`];
    });
  }
  await fake('mode?m=ok');
  await attempt('A21', 'after the source recovers the board returns from stale to live', async () => {
    let st = '';
    for (let i = 0; i < 30 && st !== 'live'; i++) {
      await sleep(1000);
      st = JSON.parse((await raw({ path: '/api/board' })).body).meta.state;
    }
    return [st === 'live', `state ${st}`];
  });
  await stopServer(s1);

  // ---------------- server 2: TRUST_PROXY=true, limit 30/min ----------------
  const s2 = await startServer({ TRUST_PROXY: 'true', RATE_LIMIT_PER_MIN: '30' }, 'atk2');
  await attempt('B1', 'TRUST_PROXY=true: spoofed LEFT X-Forwarded-For entries do not dodge the limit (right-most is the key)', async () => {
    let limited = 0;
    for (let i = 0; i < 60; i++) {
      const r = await raw({ path: '/api/board', headers: { 'X-Forwarded-For': `10.0.${i}.1, 203.0.113.7` } });
      if (r.status === 429) limited++;
    }
    const other = await raw({ path: '/api/board', headers: { 'X-Forwarded-For': '198.51.100.9' } });
    return [limited >= 25 && other.status === 200, `${limited}/60 limited for one real client; another client ${other.status}`];
  });
  await attempt('B2', 'TRUST_PROXY=true: a flood of distinct valid addresses cannot lock out a new client', async () => {
    // More distinct valid addresses than the limiter table holds (10 000), against the route that actually uses the limiter.
    for (let batch = 0; batch < 53; batch++) {
      await Promise.all(Array.from({ length: 200 }, (_, k) => {
        const n = batch * 200 + k;
        return raw({ path: '/api/board', headers: { 'X-Forwarded-For': `10.${(n >> 16) & 255}.${(n >> 8) & 255}.${n & 255}` } }).catch(() => null);
      }));
    }
    const r = await raw({ path: '/api/board', headers: { 'X-Forwarded-For': '198.51.100.77' } });
    return [r.status === 200, `new client after 10 600 distinct addresses: ${r.status}`];
  });
  await stopServer(s2);

  // ---------------- server 3: frozen; bypass attempts ----------------
  await fake('round?set=100');
  const now = Date.now();
  const s3 = await startServer({ FREEZE_AT_ISO: new Date(now + 20_000).toISOString() }, 'atk3');
  await sleep(26_000); // freeze passes; the source keeps advancing
  const frozen = JSON.parse((await raw({ path: '/api/board' })).body);
  const cur = (await (await fetch('http://127.0.0.1:3290/scoreboard.json')).json()) as { currentRound: number; teams: { totalPoints: number }[] };
  await attempt('C0', 'precondition: board is frozen and the source is ahead', async () => [frozen.meta.state === 'frozen' && cur.currentRound > frozen.meta.round + 3, `state ${frozen.meta.state}, frozen round ${frozen.meta.round}, source round ${cur.currentRound}`]);
  const frozenTotals = new Set<number>(frozen.teams.map((t: { total: number }) => t.total));
  const laterTotals = cur.teams.map((t) => t.totalPoints).filter((v) => !frozenTotals.has(v));
  const nf = new Intl.NumberFormat('en', { maximumFractionDigits: 3 });
  const freezeMs = Date.parse(new Date(now + 20_000).toISOString());
  const frozenProbe = (r: Res, p: string): [boolean, string] => {
    const text = r.body;
    let maxRound = 0;
    let lateStamp = false;
    if (p.startsWith('/api/board') && r.status === 200) {
      const j = JSON.parse(text);
      maxRound = j.meta.round;
      lateStamp = Date.parse(j.meta.capturedAt) > freezeMs;
    } else if (p.startsWith('/api/history') && r.status === 200) maxRound = Math.max(...(JSON.parse(text).rounds as number[]));
    else maxRound = Math.max(0, ...[...text.matchAll(/(?:\\?"round\\?":|Round )(\d+)/g)].map((m) => Number(m[1])));
    const later = laterTotals.filter((v) => text.includes(`"total":${v}`) || text.includes(`"totalPoints":${v}`) || text.includes(nf.format(v)));
    return [r.status < 500 && maxRound <= frozen.meta.round && !lateStamp && later.length === 0, `${r.status}, max round ${maxRound} (frozen ${frozen.meta.round}), later capture time ${lateStamp}, later totals present ${later.length}`];
  };
  const probes: [string, Record<string, string>][] = [
    ['/api/board', {}], ['/api/board?round=999', {}], ['/api/board?t=9999999999999&at=now', {}], ['/api/history?top=30', {}],
    ['/', {}], ['/?round=999&reveal=1&revealed=true', {}], ['/api/board', { 'X-Reveal': '1', Cookie: 'revealed=true', Authorization: 'Bearer x' }],
    ['/api/board', { 'If-None-Match': '*' }], ['/api/board', { 'Cache-Control': 'no-cache', Pragma: 'no-cache' }], ['/api/board', { 'X-Forwarded-For': '127.0.0.1' }],
  ];
  for (const [p, h] of probes) {
    await attempt('C1', `frozen: GET ${p} ${Object.keys(h).join(',')}`, async () => {
      const r = await raw({ path: p, headers: h });
      return frozenProbe(r, p);
    });
  }
  await attempt('C2', 'unreveal/reveal files cannot be influenced over HTTP: POST/PUT /api/reveal, /api/admin/reveal, /reveal', async () => {
    const codes: number[] = [];
    for (const p of ['/api/reveal', '/api/admin/reveal', '/reveal', '/api/control']) for (const m of ['GET', 'POST', 'PUT']) codes.push((await raw({ method: m, path: p, body: m === 'GET' ? undefined : '{"revealed":true}' })).status);
    const after = JSON.parse((await raw({ path: '/api/board' })).body);
    return [codes.every((c) => c === 404 || c === 405) && after.meta.state === 'frozen', `codes ${[...new Set(codes)]}, state ${after.meta.state}`];
  });
  await stopServer(s3);
  // Restart while frozen: snapshots.jsonl already holds rounds captured after the freeze; they must stay hidden.
  const s4 = await startServer({ FREEZE_AT_ISO: new Date(now + 20_000).toISOString() }, 'atk3', true);
  for (const p of ['/api/board', '/api/history?top=30', '/']) {
    await attempt('C3', `restart while frozen (post-freeze rounds on disk): GET ${p}`, async () => frozenProbe(await raw({ path: p }), p));
  }
  await stopServer(s4);

  const failed = rows.filter((r) => !r.ok);
  const md = ['| # | Attempt | Result | Verdict |', '|---|---|---|---|', ...rows.map((r) => `| ${r.id} | ${r.attempt.replace(/\|/g, '\\|')} | ${r.result.replace(/\|/g, '\\|')} | ${r.ok ? 'held' : 'FAILED'} |`)].join('\n');
  fs.mkdirSync(path.join(root, 'tmp'), { recursive: true });
  fs.writeFileSync(path.join(root, 'tmp', 'attack-results.md'), md + '\n');
  console.log(`\n${rows.length} attempts, ${failed.length} failed`);
  process.exitCode = failed.length ? 1 : 0;
}

main()
  .catch((e) => {
    console.error('attack error:', (e as Error).message);
    process.exitCode = 1;
  })
  .finally(() => {
    for (const k of kids) k.kill();
    setTimeout(() => process.exit(process.exitCode ?? 0), 500);
  });

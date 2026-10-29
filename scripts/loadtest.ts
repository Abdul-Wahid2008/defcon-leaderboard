// Load test against a production build with the FAKE source: 300 viewers poll /api/board every 10 s (+-20%), 30 also
// poll /api/history. Starts and stops its own fake (3290) and server (3200). Prints before/after numbers and PASS/FAIL.
//   npm run build && npm run loadtest -- --minutes 10     (default 10; use --minutes 2 for a short run)
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const arg = (n: string, d: number) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? Number(process.argv[i + 1]) : d;
};
const minutes = arg('minutes', 10);
const viewers = arg('viewers', 300);
const histViewers = arg('history', 30);
const POLL_SEC = 15;
const root = process.cwd();
const dataDir = path.join(root, 'tmp', 'load-data');
fs.rmSync(dataDir, { recursive: true, force: true });
const base = 'http://127.0.0.1:3200';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const kids: ChildProcess[] = [];
const spawnNode = (args: string[], env: Record<string, string> = {}) => {
  const c = spawn(process.execPath, args, { env: { ...process.env, ...env } as NodeJS.ProcessEnv, stdio: 'ignore' });
  kids.push(c);
  return c;
};

function rssMb(pid: number): number {
  if (process.platform === 'win32') {
    const r = spawnSync('powershell', ['-NoProfile', '-Command', `(Get-Process -Id ${pid}).WorkingSet64`], { encoding: 'utf8' });
    return Number(r.stdout.trim()) / 1048576;
  }
  return Number(spawnSync('ps', ['-o', 'rss=', '-p', String(pid)], { encoding: 'utf8' }).stdout.trim()) / 1024;
}

const lat: number[] = [];
const pageLat: number[] = [];
const codes = new Map<number, number>();
let stop = false;

async function viewer(path_: string) {
  await sleep(Math.random() * 10_000);
  if (path_ === '/api/board') {
    // A fresh viewer first loads the server-rendered page (dynamic: it carries a per-request nonce).
    const t = performance.now();
    try {
      const r = await fetch(base + '/');
      await r.arrayBuffer();
      pageLat.push(performance.now() - t);
      codes.set(r.status, (codes.get(r.status) ?? 0) + 1);
    } catch {
      codes.set(0, (codes.get(0) ?? 0) + 1);
    }
  }
  while (!stop) {
    const t = performance.now();
    try {
      const r = await fetch(base + path_);
      await r.arrayBuffer();
      lat.push(performance.now() - t);
      codes.set(r.status, (codes.get(r.status) ?? 0) + 1);
    } catch {
      codes.set(0, (codes.get(0) ?? 0) + 1);
    }
    await sleep(10_000 * (0.8 + Math.random() * 0.4));
  }
}
const pct = (a: number[], p: number) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor((p / 100) * a.length))] ?? NaN;

async function main() {
  spawnNode([path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs'), 'scripts/fake-scoreboard.ts'], { FAKE_ROUND_MS: '5000' });
  const srv = spawnNode([path.join(root, 'node_modules', 'next', 'dist', 'bin', 'next'), 'start', '-H', '127.0.0.1', '-p', '3200'], {
    SCOREBOARD_URL: 'http://127.0.0.1:3290/scoreboard.json', EVENT_SLUG: 'load', POLL_SEC: String(POLL_SEC), DATA_DIR: dataDir, NODE_ENV: 'production', SUPABASE_URL: '', SUPABASE_SECRET_KEY: '', TRUST_PROXY: 'false',
    EVENT_START_ISO: new Date(Date.now() - 60_000).toISOString(), FREEZE_AT_ISO: new Date(Date.now() + 86_400_000).toISOString(),
  });
  for (let i = 0; i < 60; i++) {
    try {
      if ((await (await fetch(`${base}/api/board`)).json()).meta.state === 'live') break;
    } catch {
      /* not up yet */
    }
    await sleep(500);
  }
  const hits0 = ((await (await fetch('http://127.0.0.1:3290/__stats')).json()) as { hits: number }).hits;
  const rssBefore = rssMb(srv.pid!);
  console.log(`start: ${viewers} board viewers + ${histViewers} history viewers for ${minutes} min; server RSS ${rssBefore.toFixed(0)} MB`);
  const t0 = Date.now();
  const workers = [...Array.from({ length: viewers }, () => viewer('/api/board')), ...Array.from({ length: histViewers }, () => viewer('/api/history?top=10'))];
  const rssSamples: number[] = [];
  while (Date.now() - t0 < minutes * 60_000) {
    await sleep(Math.min(60_000, minutes * 60_000 - (Date.now() - t0)));
    rssSamples.push(rssMb(srv.pid!));
    console.log(`  t+${Math.round((Date.now() - t0) / 1000)}s requests ${lat.length}, RSS ${rssSamples.at(-1)!.toFixed(0)} MB`);
  }
  stop = true;
  const elapsedSec = (Date.now() - t0) / 1000;
  const hits1 = ((await (await fetch('http://127.0.0.1:3290/__stats')).json()) as { hits: number }).hits;
  await Promise.race([Promise.all(workers), sleep(15_000)]);
  const rssAfter = rssSamples.at(-1) ?? rssMb(srv.pid!);
  // Cold RSS includes JIT, module loading and the first page renders, so the leak check compares against a warmed-up
  // baseline (the third one-minute sample) and reports the cold figure for information.
  const meaningful = rssSamples.length >= 4; // needs a warmed-up baseline (sample 3) and at least one later sample
  const rssWarm = rssSamples[Math.min(2, rssSamples.length - 1)] ?? rssBefore;

  const lines = fs.readFileSync(path.join(dataDir, 'snapshots.jsonl'), 'utf8').trim().split('\n').map((l) => (JSON.parse(l) as { round: number }).round);
  const dupes = lines.length - new Set(lines).size;
  const upstreamPerSec = (hits1 - hits0) / elapsedSec;
  const fivexx = [...codes].filter(([c]) => c >= 500 || c === 0).reduce((a, [, n]) => a + n, 0);
  const growth = ((rssAfter - rssWarm) / rssWarm) * 100;
  const rows: [string, string, boolean][] = [
    ['requests', `${lat.length} (${(lat.length / elapsedSec).toFixed(1)}/s), codes ${JSON.stringify(Object.fromEntries(codes))}`, true],
    ['latency p50/p95/p99 ms', `${pct(lat, 50).toFixed(1)} / ${pct(lat, 95).toFixed(1)} / ${pct(lat, 99).toFixed(1)}`, pct(lat, 95) < 100],
    ['page load (/) p50/p95 ms', `${pct(pageLat, 50).toFixed(1)} / ${pct(pageLat, 95).toFixed(1)} (${pageLat.length} loads)`, pageLat.length > 0 && pct(pageLat, 95) < 250],
    ['5xx or connection errors', String(fivexx), fivexx === 0],
    ['server RSS MB warmed-up -> end', `${rssWarm.toFixed(0)} -> ${rssAfter.toFixed(0)} (${growth.toFixed(1)}%${meaningful ? '' : ', NOT MEANINGFUL: run at least 4 minutes'}; cold start was ${rssBefore.toFixed(0)}; samples ${rssSamples.map((x) => x.toFixed(0)).join(' ')})`, !meaningful || growth < 15],
    ['upstream fetches per POLL_SEC', `${(upstreamPerSec * POLL_SEC).toFixed(2)} (${hits1 - hits0} in ${elapsedSec.toFixed(0)} s)`, upstreamPerSec * POLL_SEC <= 1.15],
    ['store writes', `${lines.length} lines, ${dupes} duplicate rounds`, dupes === 0 && lines.length <= Math.ceil(elapsedSec / 5) + 2],
  ];
  for (const [k, v, ok] of rows) console.log(`${ok ? 'ok  ' : 'FAIL'} ${k}: ${v}`);
  const failed = rows.some(([, , ok]) => !ok);
  console.log(failed ? 'RESULT: FAIL' : 'RESULT: PASS');
  process.exitCode = failed ? 1 : 0;
}

main()
  .catch((e) => {
    console.error('loadtest error:', (e as Error).message);
    process.exitCode = 1;
  })
  .finally(() => {
    for (const k of kids) k.kill();
    setTimeout(() => process.exit(process.exitCode ?? 0), 500);
  });

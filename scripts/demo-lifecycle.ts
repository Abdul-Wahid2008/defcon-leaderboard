// Scripted lifecycle demo against the FAKE scoreboard and a production build:
// pre_event -> live -> (garbage source) stale -> recovery -> frozen -> revealed. Prints evidence; exits 1 on a mismatch.
// Starts only the child processes it needs (fake on 3290, next start on 3200) and kills exactly those PIDs.
//   npm run build && npm run demo:lifecycle
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const dataDir = path.join(root, 'tmp', 'demo-data');
fs.rmSync(dataDir, { recursive: true, force: true });
const T = Date.now();
const iso = (offsetSec: number) => new Date(T + offsetSec * 1000).toISOString();
const env = {
  ...process.env,
  SCOREBOARD_URL: 'http://127.0.0.1:3290/scoreboard.json',
  EVENT_SLUG: 'demo',
  EVENT_NAME: 'Demo event (fake source)',
  EVENT_START_ISO: iso(12),
  FREEZE_AT_ISO: iso(125),
  POLL_SEC: '5',
  STALE_AFTER_SEC: '30',
  DATA_DIR: dataDir,
  FAKE_ROUND_MS: '2000',
  NODE_ENV: 'production',
} as unknown as NodeJS.ProcessEnv;

const kids: ChildProcess[] = [];
const run = (args: string[], extra: Record<string, string> = {}) => {
  const c = spawn(process.execPath, args, { env: { ...env, ...extra }, stdio: 'ignore' });
  kids.push(c);
  console.log(`started pid ${c.pid}: node ${args[0].split(/[\\/]/).slice(-2).join('/')}`);
  return c;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fake = (q: string) => fetch(`http://127.0.0.1:3290/__${q}`).then((r) => r.json());
const board = async () => (await fetch('http://127.0.0.1:3200/api/board', { cache: 'no-store' })).json() as Promise<{ meta: { state: string; round: number | null; frozenAtRound?: number }; teams: { name: string; total: number }[] }>;
const hist = async () => (await fetch('http://127.0.0.1:3200/api/history?top=3', { cache: 'no-store' })).json() as Promise<{ rounds: number[] }>;
const cli = (cmd: string, ...a: string[]) =>
  spawnSync(process.execPath, [path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs'), '--conditions=react-server', 'scripts/cli.ts', cmd, ...a], { env, encoding: 'utf8' });

let failed = false;
const t0 = Date.now();
const stamp = () => `T+${String(Math.round((Date.now() - t0) / 1000)).padStart(3)}s`;
async function waitFor(label: string, want: string, timeoutSec: number) {
  const end = Date.now() + timeoutSec * 1000;
  let b = await board();
  while (b.meta.state !== want && Date.now() < end) {
    await sleep(1000);
    b = await board();
  }
  const ok = b.meta.state === want;
  if (!ok) failed = true;
  console.log(`${stamp()}  ${ok ? 'ok  ' : 'FAIL'} ${label}: state=${b.meta.state} round=${b.meta.round} (wanted ${want})`);
  return b;
}

async function main() {
  run([path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs'), 'scripts/fake-scoreboard.ts']);
  run([path.join(root, 'node_modules', 'next', 'dist', 'bin', 'next'), 'start', '-H', '127.0.0.1', '-p', '3200']);
  for (let i = 0; i < 40; i++) {
    try {
      await board();
      await fake('round?set=1');
      break;
    } catch {
      await sleep(500);
    }
  }
  await waitFor('before the start time', 'pre_event', 20);
  await waitFor('after the start time', 'live', 30);

  console.log(`${stamp()}  source -> garbage`);
  await fake('mode?m=garbage');
  const before = await board();
  const stale = await waitFor('no good fetch for 30 s', 'stale', 60);
  console.log(`${stamp()}  previous data kept while stale: ${stale.teams.length} teams, round ${stale.meta.round} (was ${before.meta.round})`);
  await fake('mode?m=ok');
  await waitFor('source recovered', 'live', 30);

  const frozenAt = Date.parse(env.FREEZE_AT_ISO!);
  await sleep(Math.max(0, frozenAt - Date.now()) + 7000); // freeze + one cache window + one poll
  const f = await board();
  await sleep(12_000);
  const f2 = await board();
  const peek = cli('peek').stdout.split('\n')[0];
  const h = await hist();
  const frozenOk = f.meta.state === 'frozen' && f2.meta.round === f.meta.round && f2.meta.frozenAtRound === f.meta.round && Math.max(...h.rounds) === f.meta.round;
  if (!frozenOk) failed = true;
  console.log(`${stamp()}  ${frozenOk ? 'ok  ' : 'FAIL'} frozen: round ${f.meta.round} then ${f2.meta.round}; history max ${Math.max(...h.rounds)}; host-side ${peek}`);

  console.log(cli('reveal', '--slug', 'wrong').stderr.trim() || '(wrong slug accepted?!)');
  console.log(cli('reveal', '--slug', 'demo').stdout.trim());
  const r = await waitFor('after reveal', 'revealed', 20);
  const h2 = await hist();
  if (!(r.meta.round! > f.meta.round! && Math.max(...h2.rounds) === r.meta.round)) failed = true;
  console.log(`${stamp()}  revealed round ${r.meta.round} > frozen round ${f.meta.round}; history max ${Math.max(...h2.rounds)}`);

  console.log(cli('unreveal', '--slug', 'demo').stdout.trim());
  await waitFor('after unreveal', 'frozen', 20);
  console.log(cli('status').stdout);
}

main()
  .catch((e) => {
    failed = true;
    console.error('demo error:', (e as Error).message);
  })
  .finally(() => {
    for (const k of kids) k.kill();
    console.log(failed ? 'RESULT: FAIL' : 'RESULT: PASS');
    setTimeout(() => process.exit(failed ? 1 : 0), 500);
  });

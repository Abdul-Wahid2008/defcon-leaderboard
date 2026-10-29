// Host-side control CLI (D27: there is no HTTP admin surface). Usage: npm run <status|peek|reveal|unreveal|refresh|snapshot|import-roster>
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import { parseConfig, type AppConfig } from '../src/lib/config';
import { appendAudit, readControl, writeControl } from '../src/lib/control';
import { renderFinalHtml, parseRosterText, rosterDiff, slugConfirmed } from '../src/lib/cli-core';
import { fetchSource } from '../src/lib/source/fetcher';
import { parseScoreboard } from '../src/lib/source/parse';
import { rankTeams } from '../src/lib/source/rank';
import { loadRoster } from '../src/lib/source/roster';
import { loadSourceMap } from '../src/lib/source/source-map';
import { readJsonl } from '../src/lib/store/jsonl';
import { buildBoard, buildHistory, type SourceState, type ViewInput } from '../src/lib/view';
import { loadEnv } from './env';

const [cmd, ...rest] = process.argv.slice(2);
const flag = (name: string) => rest.includes(`--${name}`);
const opt = (name: string) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : undefined;
};
const die = (msg: string): never => {
  console.error(msg);
  process.exit(1);
};

function config(): AppConfig {
  try {
    return parseConfig(loadEnv());
  } catch (e) {
    return die(`config invalid: ${(e as Error).message}`);
  }
}

async function view(cfg: AppConfig): Promise<{ input: ViewInput; heartbeatAgeSec: number | null }> {
  const rounds = await readJsonl(path.resolve(cfg.DATA_DIR, 'snapshots.jsonl'));
  let source: SourceState = { consecutiveFailures: 0 };
  let heartbeatAgeSec: number | null = null;
  try {
    const rt = JSON.parse(fs.readFileSync(path.resolve(cfg.DATA_DIR, 'runtime.json'), 'utf8'));
    source = { lastOkAt: rt.lastOkAt, lastAttemptAt: rt.lastAttemptAt, consecutiveFailures: rt.consecutiveFailures ?? 0, lastErrorCode: rt.lastErrorCode };
    heartbeatAgeSec = Math.round((Date.now() - rt.writtenAt) / 1000);
  } catch {
    // no heartbeat: the server has not run here
  }
  return { input: { cfg, rounds, revealed: readControl(cfg.DATA_DIR).revealed, source, now: Date.now() }, heartbeatAgeSec };
}

async function confirm(cfg: AppConfig, action: string): Promise<void> {
  if (!cfg.EVENT_SLUG) die('EVENT_SLUG is not set; refusing to ' + action);
  let typed = opt('slug');
  if (typed === undefined) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    typed = await rl.question(`This changes what the PUBLIC sees. Type the event slug to ${action}: `);
    rl.close();
  }
  if (!slugConfirmed(typed, cfg.EVENT_SLUG)) die('Slug did not match. Nothing changed.');
}

async function main() {
  switch (cmd) {
    case 'status': {
      const cfg = config();
      const { input, heartbeatAgeSec } = await view(cfg);
      const b = buildBoard(input);
      const ctl = readControl(cfg.DATA_DIR);
      const rt = (() => {
        try {
          return JSON.parse(fs.readFileSync(path.resolve(cfg.DATA_DIR, 'runtime.json'), 'utf8'));
        } catch {
          return null;
        }
      })();
      const latest = input.rounds.at(-1);
      const roster = (() => {
        try {
          return loadRoster(path.resolve(cfg.DATA_DIR, 'roster.json'));
        } catch {
          return 'invalid' as const;
        }
      })();
      console.log(`state            ${b.meta.state} (as the public sees it)`);
      console.log(`visible round    ${b.meta.round ?? 'none'}`);
      console.log(`stored rounds    ${input.rounds.length}${latest ? `, newest round ${latest.round} at ${latest.capturedAt}` : ''}`);
      console.log(`freeze at        ${cfg.FREEZE_AT_ISO ?? 'NOT SET'}`);
      console.log(`revealed         ${ctl.revealed}`);
      console.log(`collector        ${heartbeatAgeSec === null ? 'no heartbeat (server not running here?)' : `heartbeat ${heartbeatAgeSec}s ago`}`);
      if (rt) console.log(`last good fetch  ${rt.lastOkAt ? Math.round((Date.now() - rt.lastOkAt) / 1000) + 's ago' : 'never'}; failures in a row ${rt.consecutiveFailures}; last error ${rt.lastErrorCode ?? 'none'}`);
      if (rt?.store) console.log(`history store    supabase ${rt.store.remote}, ${rt.store.pending} round(s) not yet pushed`);
      console.log(`roster           ${roster === null ? 'none' : roster === 'invalid' ? 'INVALID FILE' : `${roster.teams.length} names, ${latest ? latest.teams.filter((t) => roster.teams.some((r) => r.teamId === t.teamId)).length : 0} match the newest round`}`);
      return;
    }
    case 'peek': {
      const cfg = config();
      const parsed = parseScoreboard(await fetchSource({ url: cfg.SCOREBOARD_URL, allowedHosts: cfg.allowedHosts }), loadSourceMap());
      console.log(`LIVE view, round ${parsed.round}. Printed only; never served. Do not share while the board is frozen.`);
      for (const t of rankTeams(parsed.teams).slice(0, 10)) console.log(`${String(t.rank).padStart(3)}  ${t.name.padEnd(40)} ${t.total}`);
      return;
    }
    case 'reveal':
    case 'unreveal': {
      const cfg = config();
      const on = cmd === 'reveal';
      if (on && cfg.FREEZE_AT_ISO && Date.now() < Date.parse(cfg.FREEZE_AT_ISO)) console.log('Note: the freeze time has not passed yet; revealing now means the board will not freeze at all.');
      await confirm(cfg, cmd);
      const prev = readControl(cfg.DATA_DIR);
      appendAudit(cfg.DATA_DIR, { action: cmd, actor: os.userInfo().username, event: cfg.EVENT_SLUG });
      writeControl(cfg.DATA_DIR, { ...prev, revealed: on, updatedAt: new Date().toISOString() });
      console.log(`${cmd}: done. The server picks it up within 5 s.`);
      return;
    }
    case 'refresh': {
      const cfg = config();
      const prev = readControl(cfg.DATA_DIR);
      writeControl(cfg.DATA_DIR, { ...prev, refreshRequestedAt: new Date().toISOString() });
      appendAudit(cfg.DATA_DIR, { action: 'refresh', actor: os.userInfo().username });
      console.log('refresh requested. The running server pulls within about 2 s (check: npm run status).');
      return;
    }
    case 'snapshot': {
      const cfg = config();
      const { input } = await view(cfg);
      const board = buildBoard(input);
      const dir = path.resolve(cfg.DATA_DIR, 'static');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'final.json'), JSON.stringify({ board, history: buildHistory(input, 30) }));
      fs.writeFileSync(path.join(dir, 'final.html'), renderFinalHtml(board));
      console.log(`wrote ${path.join(dir, 'final.json')} and final.html (state ${board.meta.state}, round ${board.meta.round ?? 'none'})`);
      return;
    }
    case 'import-roster': {
      const cfg = config();
      const file = rest.find((a) => !a.startsWith('--'));
      if (!file) die('usage: npm run import-roster -- <file.csv|file.json> [--yes]');
      const next = parseRosterText(fs.readFileSync(file!, 'utf8'), file!);
      const target = path.resolve(cfg.DATA_DIR, 'roster.json');
      let old = null;
      try {
        old = loadRoster(target);
      } catch {
        console.log('existing roster file is invalid and will be replaced');
      }
      const d = rosterDiff(old, next);
      console.log(`added ${d.added.length}, removed ${d.removed.length}, renamed ${d.renamed.length}, unchanged ${d.unchanged}`);
      d.renamed.forEach((r) => console.log('  renamed ' + r));
      d.removed.forEach((r) => console.log('  removed ' + r));
      if (!flag('yes')) return console.log('Dry run. Re-run with --yes to write data/roster.json.');
      fs.mkdirSync(cfg.DATA_DIR, { recursive: true });
      // Temp file + rename so the running server never reads half a roster; the old file is kept as roster.json.bak.
      if (fs.existsSync(target)) fs.copyFileSync(target, target + '.bak');
      fs.writeFileSync(target + '.tmp', JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
      fs.renameSync(target + '.tmp', target);
      appendAudit(cfg.DATA_DIR, { action: 'import-roster', actor: os.userInfo().username, teams: next.teams.length });
      console.log(`wrote ${target}`);
      return;
    }
    default:
      die('usage: cli <status|peek|reveal|unreveal|refresh|snapshot|import-roster>');
  }
}

main().catch((e) => {
  // Short message only: fetcher/parser errors are codes, never URLs.
  console.error(`failed: ${(e as Error).message}`);
  process.exit(1);
});

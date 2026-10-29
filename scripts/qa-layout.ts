// Layout / accessibility QA over headless Chrome (CDP on 9333, Node's built-in WebSocket). Drives the FAKE source on 3290
// and one production server (3200) per state. Exits non-zero on any violation.
//   npm run build && npm run qa:layout            full run (screenshots to docs/screens/)
//   npm run qa:layout -- --prove                  injects one deliberate violation per check and requires it to be caught
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const prove = process.argv.includes('--prove');
const CHROME = [process.env.CHROME_PATH, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => p && fs.existsSync(p));
if (!CHROME) throw new Error('No Chrome/Edge found; set CHROME_PATH');
const WIDTHS = [390, 768, 1024, 1280, 1440, 1920];
const shots = path.join(root, 'docs', 'screens');
fs.mkdirSync(shots, { recursive: true });

const kids: ChildProcess[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const node = (args: string[], env: Record<string, string> = {}) => {
  const c = spawn(process.execPath, args, { env: { ...process.env, ...env } as NodeJS.ProcessEnv, stdio: 'ignore' });
  kids.push(c);
  return c;
};
const stop = (c: ChildProcess) => {
  c.kill();
  kids.splice(kids.indexOf(c), 1);
};
const fake = (q: string) => fetch(`http://127.0.0.1:3290/__${q}`).then((r) => r.json());

// ---------- minimal CDP client ----------
class Cdp {
  private id = 0;
  private pending = new Map<number, (v: { result?: unknown; error?: { message: string } }) => void>();
  readonly problems: string[] = [];
  constructor(private ws: WebSocket) {
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(String(ev.data));
      if (m.id && this.pending.has(m.id)) return this.pending.get(m.id)!(m);
      if (m.method === 'Runtime.exceptionThrown') this.problems.push(`exception: ${m.params.exceptionDetails.text}`);
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') this.problems.push(`console.error: ${m.params.args.map((a: { value?: string }) => a.value).join(' ')}`);
      if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') this.problems.push(`log error: ${m.params.entry.text}`);
    });
  }
  send<T = unknown>(method: string, params: object = {}): Promise<T> {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, (m) => (m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result as T)));
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval<T>(expr: string): Promise<T> {
    const r = await this.send<{ result: { value: T }; exceptionDetails?: { text: string } }>('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('eval failed: ' + r.exceptionDetails.text);
    return r.result.value;
  }
  async key(key: string, code = key) {
    for (const type of ['keyDown', 'keyUp']) await this.send('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: key === 'Tab' ? 9 : key === 'Escape' ? 27 : 13, ...(key === 'Enter' && type === 'keyDown' ? { text: String.fromCharCode(13) } : {}) });
  }
}

async function launchChrome(): Promise<{ cdp: Cdp; proc: ChildProcess }> {
  const profile = path.join(root, 'tmp', 'chrome-qa');
  fs.rmSync(profile, { recursive: true, force: true });
  const proc = spawn(CHROME!, ['--headless=new', '--remote-debugging-port=9333', `--user-data-dir=${profile}`, '--no-first-run', '--disable-gpu', 'about:blank'], { stdio: 'ignore' });
  kids.push(proc);
  let target: { webSocketDebuggerUrl: string } | undefined;
  for (let i = 0; i < 50 && !target; i++) {
    try {
      const list = (await (await fetch('http://127.0.0.1:9333/json/list')).json()) as { type: string; webSocketDebuggerUrl: string }[];
      target = list.find((t) => t.type === 'page');
    } catch {
      await sleep(200);
    }
  }
  if (!target) throw new Error('Chrome did not start');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  const cdp = new Cdp(ws);
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Page.enable');
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.__cls=0;new PerformanceObserver(l=>{for(const e of l.getEntries()){if(e.hadRecentInput)continue;const rows=e.sources.length>0&&e.sources.every(s=>{const inRows=s.node&&s.node.parentElement&&s.node.parentElement.closest&&s.node.parentElement.closest('tbody');const moved=s.previousRect.x!==s.currentRect.x||s.previousRect.y!==s.currentRect.y;return inRows||!moved});if(rows){window.__rowmoves=(window.__rowmoves||0)+e.value;continue}window.__cls+=e.value;(window.__clsSrc=window.__clsSrc||[]).push(e.sources.map(s=>s.node&&(s.node.nodeName+'.'+(s.node.className||s.node.parentElement&&s.node.parentElement.className||''))).join(','))}}).observe({type:'layout-shift',buffered:true});`,
  });
  return { cdp, proc };
}

// ---------- in-page checks (returns violation strings) ----------
const CHECKS = `(() => {
  const out = [];
  const vw = innerWidth;
  const sel = (e) => e.tagName.toLowerCase() + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\\s+/)[0] : '');
  if (document.documentElement.scrollWidth > vw) out.push('overflow: page scrollWidth ' + document.documentElement.scrollWidth + ' > ' + vw);
  for (const e of document.querySelectorAll('body *')) {
    const r = e.getBoundingClientRect();
    if (r.width && !e.closest('.sr-only') && !e.closest('dialog:not([open])') && r.right > vw + 1) { out.push('overflow: ' + sel(e) + ' right edge ' + Math.round(r.right) + ' > ' + vw); break; }
  }
  const parse = (c) => { const m = /rgba?\\(([^)]+)\\)/.exec(c); if (!m) return null; const p = m[1].split(/[ ,\\/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const blend = (f, b) => ({ r: f.r * f.a + b.r * (1 - f.a), g: f.g * f.a + b.g * (1 - f.a), b: f.b * f.a + b.b * (1 - f.a), a: 1 });
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const bgOf = (e) => { let stack = []; for (let n = e; n; n = n.parentElement) { const c = parse(getComputedStyle(n).backgroundColor); if (c && c.a > 0) { stack.push(c); if (c.a === 1) break; } } let base = { r: 11, g: 18, b: 32, a: 1 }; for (const c of stack.reverse()) base = blend(c, base); return base; };
  const sizes = new Set();
  const seen = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let t; (t = walker.nextNode()); ) {
    if (!t.nodeValue.trim()) continue;
    const e = t.parentElement;
    if (!e || e.closest('.sr-only') || e.closest('dialog:not([open])') || e.closest('script,style')) continue;
    const cs = getComputedStyle(e);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    sizes.add(cs.fontSize); (window.__fs = window.__fs || {})[cs.fontSize] = sel(e) + ' "' + t.nodeValue.trim().slice(0, 20) + '"';
    const fg = parse(cs.color); if (!fg) { if (!seen.has('unparsable')) { seen.add('unparsable'); out.push('contrast: unparsable colour ' + cs.color); } continue; }
    const bg = bgOf(e); const f = blend(fg, bg);
    const L1 = lum(f), L2 = lum(bg); const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const px = parseFloat(cs.fontSize); const large = px >= 24 || (px >= 18.66 && Number(cs.fontWeight) >= 700);
    const need = large ? 3 : 4.5;
    const key = sel(e) + ratio.toFixed(1);
    if (ratio < need && !seen.has(key)) { seen.add(key); out.push('contrast: ' + sel(e) + ' ' + ratio.toFixed(2) + ':1 < ' + need + ' ("' + t.nodeValue.trim().slice(0, 24) + '")'); }
  }
  const probe = document.createElement('div'); (document.querySelector('.page') || document.body).appendChild(probe);
  const allowed = new Set(['--fs-title', '--fs-section', '--fs-body', '--fs-secondary', '--fs-caption'].map((v) => { probe.style.fontSize = 'var(' + v + ')'; return getComputedStyle(probe).fontSize; }));
  probe.remove();
  for (const s of sizes) if (!allowed.has(s)) out.push('type scale: font-size ' + s + ' on ' + (window.__fs[s] || '?') + ' is not one of ' + [...allowed].join(', '));
  for (const i of document.querySelectorAll('svg.icon')) { const r = i.getBoundingClientRect(); if (r.width && (Math.round(r.width) !== 16 || Math.round(r.height) !== 16)) { out.push('icon: svg is ' + r.width + 'x' + r.height + ', not 16x16'); break; } }
  if (/seamless|powerful|elevate|effortless|robust|leverage|journey|blazing|cutting-edge/i.test(document.body.innerText)) out.push('copy: banned word on page');
  return out;
})()`;

const FOCUS_CHECK = `(() => { const e = document.activeElement; if (!e || e === document.body) return null; const cs = getComputedStyle(e); const ring = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || (cs.boxShadow && cs.boxShadow !== 'none'); return ring ? null : 'focus: no visible ring on ' + e.tagName.toLowerCase() + '.' + (e.className || ''); })()`;

async function go(cdp: Cdp, url: string, w: number, h: number) {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 600 });
  await cdp.send('Page.navigate', { url });
  for (let i = 0; i < 60; i++) {
    await sleep(150);
    if ((await cdp.eval<string>('document.readyState')) === 'complete' && (await cdp.eval<boolean>("!!document.querySelector('.page')"))) break;
  }
  await sleep(800); // hydration
}
async function shot(cdp: Cdp, name: string) {
  const r = await cdp.send<{ data: string }>('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(shots, name + '.png'), Buffer.from(r.data, 'base64'));
}
async function focusRings(cdp: Cdp, max = 12): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < max; i++) {
    await cdp.key('Tab');
    const v = await cdp.eval<string | null>(FOCUS_CHECK);
    if (v && !out.includes(v)) out.push(v);
  }
  return out;
}

// ---------- scenarios ----------
type Sc = { state: string; mode: string; env: (now: number) => Record<string, string>; seed?: (dir: string, now: number) => void };
const iso = (ms: number) => new Date(ms).toISOString();
function seedRounds(dir: string, rounds: [number, number][]) {
  fs.mkdirSync(dir, { recursive: true });
  const lines = rounds.map(([round, capturedMs]) =>
    JSON.stringify({
      round,
      capturedAt: iso(capturedMs),
      teams: Array.from({ length: 30 }, (_, i) => ({ teamId: String(i + 1), name: `Team ${String(i + 1).padStart(2, '0')}`, total: (30 - i) * 100 + round, attack: 1, defense: 1, sla: 1, rank: i + 1, tied: false })),
    }),
  );
  fs.writeFileSync(path.join(dir, 'snapshots.jsonl'), lines.join('\n') + '\n');
}
const SCENARIOS: Sc[] = [
  { state: 'live', mode: 'ok', env: (n) => ({ EVENT_START_ISO: iso(n - 60_000), FREEZE_AT_ISO: iso(n + 3_600_000) }) },
  { state: 'pre_event', mode: 'ok', env: (n) => ({ EVENT_START_ISO: iso(n + 3_600_000), FREEZE_AT_ISO: iso(n + 7_200_000) }) },
  {
    state: 'stale',
    mode: '500',
    env: (n) => ({ EVENT_START_ISO: iso(n - 3_600_000), FREEZE_AT_ISO: iso(n + 3_600_000) }),
    seed: (d, n) => seedRounds(d, [[10, n - 600_000], [11, n - 590_000]]),
  },
  {
    state: 'frozen',
    mode: 'ok',
    env: (n) => ({ EVENT_START_ISO: iso(n - 3_600_000), FREEZE_AT_ISO: iso(n - 30_000) }),
    seed: (d, n) => seedRounds(d, [[10, n - 120_000], [11, n - 100_000], [12, n - 60_000]]),
  },
  { state: 'unavailable', mode: '500', env: (n) => ({ EVENT_START_ISO: iso(n - 3_600_000), FREEZE_AT_ISO: iso(n + 3_600_000) }) },
];

async function withServer<T>(sc: Sc, fn: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const dir = path.join(root, 'tmp', `qa-${sc.state}`);
  fs.rmSync(dir, { recursive: true, force: true });
  sc.seed?.(dir, now);
  await fake(`mode?m=${sc.mode}`);
  if (sc.state === 'frozen') await fake('round?set=40');
  const srv = node([path.join(root, 'node_modules', 'next', 'dist', 'bin', 'next'), 'start', '-H', '127.0.0.1', '-p', '3200'], {
    SCOREBOARD_URL: 'http://127.0.0.1:3290/scoreboard.json', EVENT_SLUG: 'qa', EVENT_NAME: 'DEFCON 2.0', POLL_SEC: '5', STALE_AFTER_SEC: '30', DATA_DIR: dir, NODE_ENV: 'production', ...sc.env(now),
  });
  try {
    let st = '';
    for (let i = 0; i < 80 && st !== sc.state; i++) {
      await sleep(500);
      try {
        st = ((await (await fetch('http://127.0.0.1:3200/api/board')).json()) as { meta: { state: string } }).meta.state;
      } catch {
        st = '';
      }
    }
    if (st !== sc.state) throw new Error(`server never reached state ${sc.state} (last ${st || 'none'})`);
    return await fn();
  } finally {
    stop(srv);
    await sleep(700);
  }
}

const failures: string[] = [];
const fail = (ctx: string, v: string) => (failures.push(`${ctx}: ${v}`), console.log(`FAIL ${ctx}: ${v}`));

async function main() {
  node([path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs'), 'scripts/fake-scoreboard.ts'], { FAKE_ROUND_MS: '4000' });
  await sleep(1500);
  const { cdp } = await launchChrome();

  if (prove) return proveChecks(cdp);

  const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;
  for (const sc of SCENARIOS.filter((x) => !only || x.state === only)) {
    await withServer(sc, async () => {
      const widths = sc.state === 'live' ? WIDTHS : [390, 1280];
      for (const w of widths) {
        cdp.problems.length = 0;
        await go(cdp, 'http://127.0.0.1:3200/', w, w >= 1280 ? 900 : 844);
        const ctx = `${sc.state}@${w}`;
        const rows = await cdp.eval<number>("document.querySelectorAll('.board tbody tr').length");
        if (sc.state === 'unavailable' && rows !== 0) fail(ctx, `unavailable should show no rows, got ${rows}`);
        if (sc.state !== 'unavailable' && rows === 0 && sc.state !== 'pre_event') fail(ctx, 'no rows rendered');
        for (const v of await cdp.eval<string[]>(CHECKS)) fail(ctx, v);
        if (w >= 768) for (const v of await focusRings(cdp)) fail(ctx, v);
        for (const p of cdp.problems) fail(ctx, p);
        console.log(`ok   ${ctx} (${rows} rows)`);
        if (sc.state !== 'live' || [390, 768, 1280, 1920].includes(w)) await shot(cdp, `${sc.state}-${w}`);
      }
      if (sc.state === 'live' || sc.state === 'frozen') {
        cdp.problems.length = 0;
        await go(cdp, 'http://127.0.0.1:3200/?tv=1', 1920, 1080);
        const ctx = `${sc.state}@tv1920x1080`;
        const m = await cdp.eval<{ rows: number; sh: number; ih: number; lastBottom: number }>(
          `({ rows: document.querySelectorAll('.board tbody tr').length, sh: document.documentElement.scrollHeight, ih: innerHeight, lastBottom: Math.round(document.querySelector('.board tbody tr:last-child').getBoundingClientRect().bottom) })`,
        );
        if (m.rows !== 30) fail(ctx, `expected 30 rows, got ${m.rows}`);
        if (m.sh > m.ih || m.lastBottom > m.ih) fail(ctx, `needs scrolling: scrollHeight ${m.sh}, last row bottom ${m.lastBottom}, viewport ${m.ih}`);
        for (const v of await cdp.eval<string[]>(CHECKS)) fail(ctx, v);
        for (const p of cdp.problems) fail(ctx, p);
        console.log(`ok   ${ctx} (30 rows, last row bottom ${m.lastBottom} of ${m.ih})`);
        await shot(cdp, `${sc.state}-tv-1920x1080`);
      }
      if (sc.state === 'live') {
        // Drawer: keyboard open, Esc close, focus restored. Then layout shift across a poll.
        await go(cdp, 'http://127.0.0.1:3200/', 1280, 900);
        await cdp.eval("document.querySelector('.team-btn').focus()");
        await cdp.key('Enter');
        await sleep(600);
        const open = await cdp.eval<boolean>("document.querySelector('dialog').open");
        if (!open) fail('drawer', 'Enter on a team did not open the drawer');
        for (const v of await cdp.eval<string[]>(CHECKS)) fail('drawer', v);
        await shot(cdp, 'live-drawer-1280');
        await cdp.key('Escape');
        await sleep(300);
        const closed = await cdp.eval<boolean>("!document.querySelector('dialog').open && document.activeElement === document.querySelector('.team-btn')");
        if (!closed) fail('drawer', 'Esc did not close the drawer and restore focus to the team button');
        console.log(`ok   drawer open=${open} closeRestoresFocus=${closed}`);
        await go(cdp, 'http://127.0.0.1:3200/', 390, 844);
        await cdp.eval("document.querySelector('.board tbody tr').click()");
        await sleep(600);
        await shot(cdp, 'live-drawer-390');
        await go(cdp, 'http://127.0.0.1:3200/', 1280, 900);
        await sleep(25_000); // at least two polls and several score changes
        const cls = await cdp.eval<number>('window.__cls');
        if (cls > 0.01) fail('layout shift', `CLS ${cls.toFixed(4)} over 25 s of polling; sources ${JSON.stringify(await cdp.eval('window.__clsSrc'))}`);
        console.log(`ok   layout shift sources: ${JSON.stringify(await cdp.eval('window.__clsSrc'))}`);
        console.log(`ok   layout shift over 25 s: CLS ${cls.toFixed(4)} (rows re-sorting by rank are not counted: ${((await cdp.eval<number | null>('window.__rowmoves')) ?? 0).toFixed(4)})`);
      }
    });
  }
  console.log(failures.length ? `\n${failures.length} violation(s)` : '\nqa:layout clean');
  process.exitCode = failures.length ? 1 : 0;
}

// Each check must fire on a deliberate violation. Runs on the live page.
async function proveChecks(cdp: Cdp) {
  const sc = SCENARIOS[0];
  await withServer(sc, async () => {
    await go(cdp, 'http://127.0.0.1:3200/', 1280, 900);
    const expectations: [string, string, RegExp][] = [
      ['horizontal overflow', "const d=document.createElement('div');d.style.cssText='width:3000px;height:4px';document.body.appendChild(d)", /overflow/],
      ['low contrast', "const d=document.createElement('p');d.textContent='faint';d.style.cssText='color:#555;background:#444';document.body.appendChild(d)", /contrast/],
      ['off-scale font size', "const d=document.createElement('p');d.textContent='odd size';d.style.fontSize='17px';document.body.appendChild(d)", /type scale/],
      ['icon size', "const s=document.querySelector('svg.icon');s.style.width='20px';s.style.height='20px'", /icon/],
      ['banned word', "const d=document.createElement('p');d.textContent='A seamless experience';document.body.appendChild(d)", /banned/],
    ];
    for (const [name, inject, re] of expectations) {
      await go(cdp, 'http://127.0.0.1:3200/', 1280, 900);
      await cdp.eval(`(()=>{${inject}})()`);
      const v = await cdp.eval<string[]>(CHECKS);
      const caught = v.some((x) => re.test(x));
      console.log(`${caught ? 'caught' : 'MISSED'} ${name}${caught ? '' : ' (not detected)'}`);
      if (!caught) failures.push(`check not proven: ${name}`);
    }
    await go(cdp, 'http://127.0.0.1:3200/', 1280, 900);
    await cdp.eval("(()=>{const b=document.createElement('button');b.textContent='x';b.style.cssText='outline:none;box-shadow:none';b.id='noring';document.body.prepend(b);b.focus()})()");
    const ring = await cdp.eval<string | null>(FOCUS_CHECK);
    console.log(`${ring ? 'caught' : 'MISSED'} missing focus ring`);
    if (!ring) failures.push('check not proven: focus ring');
    cdp.problems.length = 0;
    await cdp.eval("console.error('deliberate')");
    await sleep(200);
    console.log(`${cdp.problems.length ? 'caught' : 'MISSED'} console error`);
    if (!cdp.problems.length) failures.push('check not proven: console error');
  });
  console.log(failures.length ? 'PROVE FAILED' : 'every check fires on a deliberate violation');
  process.exitCode = failures.length ? 1 : 0;
}

main()
  .catch((e) => {
    console.error('qa error:', (e as Error).message);
    process.exitCode = 1;
  })
  .finally(() => {
    for (const k of kids) k.kill();
    setTimeout(() => process.exit(process.exitCode ?? 0), 500);
  });

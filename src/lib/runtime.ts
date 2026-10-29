import fs from 'node:fs';
import path from 'node:path';
import { Collector } from './collector';
import { getConfig, type AppConfig } from './config';
import { cachedControl, readControl, type Control } from './control';
import { fetchSource } from './source/fetcher';
import { loadRoster } from './source/roster';
import { loadSourceMap } from './source/source-map';
import { getStore } from './store';
import type { SnapshotStore } from './store/types';
import type { SourceState } from './view';

/** Everything a request handler needs. Tests build one directly; production gets it from getDeps(). */
export interface Deps {
  cfg: AppConfig;
  store: SnapshotStore;
  control: () => Control;
  source: () => SourceState;
  ensureFresh: () => Promise<void>;
  now: () => number;
}

interface Runtime {
  deps: Deps;
  collector: Collector;
  control: ReturnType<typeof cachedControl>;
  watcher: ReturnType<typeof setInterval>;
}

// instrumentation.ts and the route bundles can load separate copies of this module; one process-wide runtime lives here.
const g = globalThis as unknown as { __lbRuntime?: Promise<Runtime> };

function writeRuntimeFile(dataDir: string, c: Collector, store: { status?: () => unknown }) {
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    const f = path.resolve(dataDir, 'runtime.json');
    const tmp = `${f}.${process.pid}.tmp`;
    // Internal heartbeat for the host-side CLI. Never served over HTTP.
    fs.writeFileSync(tmp, JSON.stringify({ ...c.source, fetches: c.fetches, store: store.status?.(), pid: process.pid, writtenAt: Date.now() }), { mode: 0o600 });
    fs.renameSync(tmp, f);
  } catch {
    // heartbeat is best effort
  }
}

async function build(): Promise<Runtime> {
  const cfg = getConfig();
  const store = await getStore();
  const control = cachedControl(cfg.DATA_DIR);
  const map = loadSourceMap();
  const rosterFile = path.resolve(cfg.DATA_DIR, 'roster.json');
  const collector = new Collector({
    store,
    map,
    now: Date.now,
    pollMs: cfg.POLL_SEC * 1000,
    roster: () => loadRoster(rosterFile),
    fetchRaw: () => fetchSource({ url: cfg.SCOREBOARD_URL, allowedHosts: cfg.allowedHosts }),
    log: (m) => console.warn(m),
  });
  const heartbeat = () => writeRuntimeFile(cfg.DATA_DIR, collector, store);
  const tick = () => collector.tick().finally(heartbeat);

  // The CLI asks for a refresh through control.json (D27: no HTTP surface). Checked every 2 s, cheap.
  let handled = readControl(cfg.DATA_DIR).refreshRequestedAt;
  const watcher = setInterval(() => {
    const c = control.force();
    if (c.refreshRequestedAt && c.refreshRequestedAt !== handled) {
      handled = c.refreshRequestedAt;
      void tick();
    }
  }, 2000);
  watcher.unref?.();

  collector.start();
  return {
    collector,
    control,
    watcher,
    deps: {
      cfg,
      store,
      control: control.get,
      source: () => collector.source,
      ensureFresh: () => collector.ensureFresh().finally(heartbeat),
      now: Date.now,
    },
  };
}

export function getRuntime(): Promise<Runtime> {
  g.__lbRuntime ??= build().catch((e) => {
    g.__lbRuntime = undefined;
    throw e;
  });
  return g.__lbRuntime;
}

export async function getDeps(): Promise<Deps> {
  return (await getRuntime()).deps;
}

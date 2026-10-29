import { parseConfig } from '../../src/lib/config';
import type { Deps } from '../../src/lib/runtime';
import { MemoryStore } from '../../src/lib/store/memory';
import type { Snapshot } from '../../src/lib/store/types';
import type { SourceState } from '../../src/lib/view';

export const T0 = Date.parse('2026-10-31T05:00:00Z'); // event start
export const FREEZE = Date.parse('2026-10-31T08:00:00Z');

export interface World {
  deps: Deps;
  clock: { t: number };
  ctl: { revealed: boolean };
  source: SourceState;
  store: MemoryStore;
  fresh: { calls: number };
}

/** Unique, searchable totals per round: 90000 + round, so a leaked later round is easy to grep for. */
export function marked(round: number, capturedMs: number): Snapshot {
  return {
    round,
    capturedAt: new Date(capturedMs).toISOString(),
    teams: [
      { teamId: 'a', name: 'Alpha', total: 90000 + round, rank: 1, tied: false, services: [{ key: 'svc', status: 'ok' }], attack: 1, defense: 2, sla: 3 },
      { teamId: 'b', name: 'Bravo', total: 80000 + round, rank: 2, tied: false, rankDelta: 0 },
    ],
  };
}

export async function world(env: Record<string, string> = {}, rounds: Snapshot[] = []): Promise<World> {
  const cfg = parseConfig({
    EVENT_START_ISO: new Date(T0).toISOString(),
    FREEZE_AT_ISO: new Date(FREEZE).toISOString(),
    EVENT_SLUG: 'test-event',
    ...env,
  });
  const store = new MemoryStore({ slug: 'test-event', name: 'Test' });
  for (const r of rounds) await store.saveRound(r);
  const clock = { t: T0 + 60_000 };
  const ctl = { revealed: false };
  const source: SourceState = { consecutiveFailures: 0, lastOkAt: clock.t };
  const fresh = { calls: 0 };
  const deps: Deps = {
    cfg,
    store,
    control: () => ({ revealed: ctl.revealed }),
    source: () => source,
    ensureFresh: async () => void fresh.calls++,
    now: () => clock.t,
  };
  return { deps, clock, ctl, source, store, fresh };
}

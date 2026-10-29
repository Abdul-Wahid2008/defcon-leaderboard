import { decideRound, rankTeams } from './source/rank';
import { parseScoreboard } from './source/parse';
import { applyRoster, type Roster } from './source/roster';
import type { SourceMap } from './source/source-map';
import { SourceError } from './source/types';
import type { SnapshotStore } from './store/types';
import type { SourceState } from './view';

export interface CollectorDeps {
  store: SnapshotStore;
  fetchRaw: () => Promise<unknown>;
  map: SourceMap;
  roster: () => Roster | null;
  now: () => number;
  pollMs: number;
  log?: (msg: string) => void;
}

export type TickResult = 'stored' | 'same' | 'error' | 'store_error';

/**
 * Pulls the source, ranks, and stores a round only when its number is new. Single-flight: concurrent callers share one
 * fetch. Keeps `SourceState` for the state machine; its error codes are internal and never reach a public body.
 */
export class Collector {
  readonly source: SourceState = { consecutiveFailures: 0 };
  private inflight: Promise<TickResult> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  fetches = 0;

  constructor(private readonly d: CollectorDeps) {}

  tick(): Promise<TickResult> {
    this.inflight ??= this.run().catch(() => this.fail('internal')).finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private fail(code: string): TickResult {
    // Log on a change of code only, so a dead source does not flood the log.
    if (this.source.lastErrorCode !== code) this.d.log?.(`[collector] source error: ${code}`);
    this.source.consecutiveFailures++;
    this.source.lastErrorCode = code;
    return 'error';
  }

  private async run(): Promise<TickResult> {
    this.source.lastAttemptAt = this.d.now();
    this.fetches++;
    let parsed;
    try {
      parsed = parseScoreboard(await this.d.fetchRaw(), this.d.map);
    } catch (e) {
      return this.fail(e instanceof SourceError ? e.code : 'unknown');
    }

    let latest;
    try {
      latest = await this.d.store.latest();
    } catch {
      return this.fail('store_read');
    }
    const decision = decideRound(latest?.round, parsed.round);
    // A source that goes backwards is a stale mirror or a restarted engine: not a good fetch, history is untouched.
    if (decision === 'older') return this.fail('round_backwards');

    const recovered = () => {
      this.source.consecutiveFailures = 0;
      if (this.source.lastErrorCode) this.d.log?.('[collector] source recovered');
      this.source.lastErrorCode = undefined;
    };
    if (decision === 'same') {
      // Freshness is the age of the newest stored round: an engine that keeps returning the same round must go stale.
      recovered();
      this.source.lastOkAt = Math.max(this.source.lastOkAt ?? 0, latest ? Date.parse(latest.capturedAt) : 0) || undefined;
      return 'same';
    }

    let roster: Roster | null = null;
    try {
      roster = this.d.roster();
    } catch {
      this.d.log?.('[collector] roster ignored: file invalid');
    }
    const { teams } = applyRoster(parsed.teams, roster);
    const prev = latest ? new Map(latest.teams.map((t) => [t.teamId, t.rank])) : undefined;
    try {
      await this.d.store.saveRound({ round: parsed.round, capturedAt: new Date(this.d.now()).toISOString(), teams: rankTeams(teams, prev) });
    } catch {
      this.d.log?.('[collector] store write failed');
      this.fail('store_write'); // a board that cannot store must not look healthy
      return 'store_error';
    }
    recovered();
    this.source.lastOkAt = this.d.now();
    return 'stored';
  }

  /** Lazy refresh for requests: pull again when the last attempt is older than 2 x poll. Never throws. */
  ensureFresh(): Promise<void> {
    const last = this.source.lastAttemptAt;
    if (last === undefined || this.d.now() - last > 2 * this.d.pollMs) return this.tick().then(() => undefined);
    return Promise.resolve();
  }

  /** Poll loop with +-10% jitter. The timer is unref'd so it never keeps the process alive. */
  start(): void {
    if (this.timer) return;
    this.stopped = false;
    const loop = () => {
      void this.tick().finally(() => {
        if (this.stopped) return;
        const jitter = 1 + (Math.random() - 0.5) * 0.2;
        this.timer = setTimeout(loop, this.d.pollMs * jitter);
        this.timer.unref?.();
      });
    };
    this.timer = setTimeout(loop, 0);
    this.timer.unref?.();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}

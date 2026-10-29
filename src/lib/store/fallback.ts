import 'server-only';
import type { EventMeta, Snapshot, SnapshotStore } from './types';

export interface StoreStatus {
  remote: 'disabled' | 'ok' | 'down';
  /** Rounds stored locally but not yet confirmed in the remote store. */
  pending: number;
}

/**
 * Memory + JSONL always, remote (Supabase) best effort. Reads are served from memory. A remote failure never fails a
 * save: the round is queued and backfilled by a later save or `flush()`; remote upserts are idempotent so repeats are safe.
 */
export class FallbackStore implements SnapshotStore {
  private ready: Promise<void> | null = null;
  private readonly pending = new Set<number>();
  private flushing: Promise<void> | null = null;
  private down = false;
  private retryAt = 0;

  constructor(
    private readonly memory: SnapshotStore,
    private readonly jsonl: SnapshotStore,
    private readonly remote: SnapshotStore | null,
    private readonly opts: { now?: () => number; cooldownMs?: number; initTimeoutMs?: number } = {},
  ) {}

  private now() {
    return (this.opts.now ?? Date.now)();
  }

  /**
   * Rebuild once, merged by round. Local (JSONL) wins on overlap: it keeps services and rankDelta, which the remote
   * does not store. A remote round with fewer teams than the local copy (a partial write) is re-queued.
   */
  private init(): Promise<void> {
    this.ready ??= (async () => {
      const local = await this.jsonl.rounds().catch(() => [] as Snapshot[]);
      let remote: Snapshot[] | null = null;
      if (this.remote) {
        try {
          // A dead remote must not hold up the first request or save for long.
          remote = await Promise.race([
            this.remote.rounds(),
            new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), this.opts.initTimeoutMs ?? 5000).unref?.()),
          ]);
        } catch {
          this.markDown();
        }
      }
      const merged = new Map<number, Snapshot>();
      for (const s of local) merged.set(s.round, s);
      for (const s of remote ?? []) if (!merged.has(s.round)) merged.set(s.round, s);
      const remoteHas = new Set((remote ?? []).filter((s) => s.teams.length >= (merged.get(s.round)?.teams.length ?? 0)).map((s) => s.round));
      const localHas = new Set(local.map((s) => s.round));
      for (const s of [...merged.values()].sort((a, b) => a.round - b.round)) {
        await this.memory.saveRound(s);
        // Rounds only the remote had are written back locally so the JSONL stays complete.
        if (!localHas.has(s.round)) await this.jsonl.saveRound(s).catch(() => undefined);
        if (this.remote && !remoteHas.has(s.round)) this.pending.add(s.round);
      }
    })().catch((e) => {
      this.ready = null;
      throw e;
    });
    return this.ready;
  }

  private markDown() {
    this.down = true;
    this.retryAt = this.now() + (this.opts.cooldownMs ?? 30_000);
  }

  async saveRound(s: Snapshot): Promise<void> {
    await this.init();
    await this.memory.saveRound(s);
    let localError: unknown;
    try {
      await this.jsonl.saveRound(s);
    } catch (e) {
      localError = e;
    }
    if (this.remote) {
      this.pending.add(s.round);
      void this.flush(); // never hold the collector on the remote; failures are queued
    }
    if (localError) throw localError;
  }

  /** Pushes queued rounds to the remote, oldest first, stopping at the first failure. Skipped during the outage cooldown. */
  flush(): Promise<void> {
    if (!this.remote || this.pending.size === 0) return Promise.resolve();
    if (this.down && this.now() < this.retryAt) return Promise.resolve();
    this.flushing ??= (async () => {
      try {
        // Loop so rounds queued while this flush was running are drained too.
        for (let round = this.nextPending(); round !== undefined; round = this.nextPending()) {
          const snap = (await this.memory.rounds(round)).find((x) => x.round === round);
          if (!snap) {
            this.pending.delete(round);
            continue;
          }
          try {
            await this.remote!.saveRound(snap);
            this.pending.delete(round);
            this.down = false;
          } catch {
            this.markDown();
            return;
          }
        }
      } finally {
        this.flushing = null;
      }
    })();
    return this.flushing;
  }

  private nextPending(): number | undefined {
    return this.pending.size ? Math.min(...this.pending) : undefined;
  }

  async rounds(upTo?: number): Promise<Snapshot[]> {
    await this.init();
    return this.memory.rounds(upTo);
  }

  async latest(): Promise<Snapshot | null> {
    await this.init();
    return this.memory.latest();
  }

  eventMeta(): Promise<EventMeta> {
    return this.memory.eventMeta();
  }

  status(): StoreStatus {
    return { remote: !this.remote ? 'disabled' : this.down ? 'down' : 'ok', pending: this.pending.size };
  }
}

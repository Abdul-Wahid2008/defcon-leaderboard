import 'server-only';
import type { EventMeta, Snapshot, SnapshotStore } from './types';
import type { RankedTeam } from '../source/types';

/** The few database operations the store needs. The real one wraps supabase-js; tests use an in-memory fake. */
export interface LbDb {
  /** Upsert lb_events by slug; returns its id. */
  ensureEvent(meta: EventMeta): Promise<string>;
  /** Upsert the lb_rounds row and every lb_scores row, keyed (event_id, round[, team_id]). Safe to repeat. */
  upsertRound(eventId: string, s: Snapshot): Promise<void>;
  /** Ascending by round; `upTo` inclusive. */
  listRounds(eventId: string, upTo?: number): Promise<Snapshot[]>;
}

export interface RetryOptions {
  tries: number;
  baseMs: number;
  timeoutMs: number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, rej) => {
    t = setTimeout(() => rej(new Error('timeout')), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(t));
}

/** Bounded retry with exponential backoff; each attempt has its own timeout. Rethrows the last error. */
export async function withRetry<T>(fn: () => Promise<T>, o: RetryOptions): Promise<T> {
  const sleep = o.sleep ?? defaultSleep;
  let last: unknown;
  for (let i = 0; i < o.tries; i++) {
    try {
      return await withTimeout(fn(), o.timeoutMs);
    } catch (e) {
      last = e;
      if (i < o.tries - 1) await sleep(o.baseMs * 2 ** i);
    }
  }
  throw last;
}

export class SupabaseStore implements SnapshotStore {
  private eventId: Promise<string> | null = null;
  constructor(
    private readonly db: LbDb,
    private readonly meta: EventMeta,
    private readonly retry: RetryOptions = { tries: 3, baseMs: 300, timeoutMs: 8000 },
  ) {}

  private id(): Promise<string> {
    // A failed lookup is not cached, so the next call retries.
    this.eventId ??= withRetry(() => this.db.ensureEvent(this.meta), this.retry).catch((e) => {
      this.eventId = null;
      throw e;
    });
    return this.eventId;
  }

  async saveRound(s: Snapshot): Promise<void> {
    const id = await this.id();
    await withRetry(() => this.db.upsertRound(id, s), this.retry);
  }

  async rounds(upTo?: number): Promise<Snapshot[]> {
    const id = await this.id();
    return withRetry(() => this.db.listRounds(id, upTo), this.retry);
  }

  async latest(): Promise<Snapshot | null> {
    const all = await this.rounds();
    return all.length ? all[all.length - 1] : null;
  }

  async eventMeta(): Promise<EventMeta> {
    return this.meta;
  }
}

type ScoreRow = { team_id: string; team_name: string; total: number; attack: number | null; defense: number | null; sla: number | null; rank: number };

/** Rebuilds a Snapshot from rows. `tied` is derived from equal ranks; services and rankDelta are not stored. */
export function snapshotFromRows(round: number, capturedAt: string, rows: ScoreRow[]): Snapshot {
  const counts = new Map<number, number>();
  for (const r of rows) counts.set(r.rank, (counts.get(r.rank) ?? 0) + 1);
  const teams: RankedTeam[] = rows
    .map((r) => ({
      teamId: r.team_id,
      name: r.team_name,
      total: Number(r.total),
      ...(r.attack !== null ? { attack: Number(r.attack) } : {}),
      ...(r.defense !== null ? { defense: Number(r.defense) } : {}),
      ...(r.sla !== null ? { sla: Number(r.sla) } : {}),
      rank: r.rank,
      tied: (counts.get(r.rank) ?? 0) > 1,
    }))
    .sort((a, b) => a.rank - b.rank || a.teamId.localeCompare(b.teamId));
  return { round, capturedAt, teams };
}

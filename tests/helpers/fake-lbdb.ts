import type { LbDb } from '../../src/lib/store/supabase';
import type { EventMeta, Snapshot } from '../../src/lib/store/types';

/** In-memory stand-in for the lb_* tables. Rows are keyed like the real primary keys, so repeats cannot duplicate. */
export class FakeLbDb implements LbDb {
  fail = false;
  upserts = 0;
  readonly rows = new Map<number, Snapshot>();

  private check() {
    if (this.fail) throw new Error('fake outage');
  }
  async ensureEvent() {
    this.check();
    return 'event-1';
  }
  async upsertRound(_id: string, s: Snapshot) {
    this.check();
    this.upserts++;
    this.rows.set(s.round, structuredClone(s));
  }
  async listRounds(_id: string, upTo?: number) {
    this.check();
    return [...this.rows.values()].filter((s) => upTo === undefined || s.round <= upTo).sort((a, b) => a.round - b.round);
  }
}

export const META: EventMeta = { slug: 'test-event', name: 'Test' };

export function snap(round: number, totals: number[] = [30, 20, 20]): Snapshot {
  return {
    round,
    capturedAt: new Date(Date.UTC(2026, 9, 31, 6, 0, round)).toISOString(),
    teams: totals.map((total, i) => ({
      teamId: `t${i + 1}`,
      name: `Team ${i + 1}`,
      total,
      attack: total / 2,
      rank: total === 20 ? 2 : i + 1,
      tied: total === 20,
    })),
  };
}

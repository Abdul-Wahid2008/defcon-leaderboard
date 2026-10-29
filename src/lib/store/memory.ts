import type { EventMeta, Snapshot, SnapshotStore } from './types';

/** Ring buffer keyed by round; the oldest rounds fall off past `capacity` (an event is ~110 rounds). */
export class MemoryStore implements SnapshotStore {
  private readonly byRound = new Map<number, Snapshot>();
  constructor(
    private readonly meta: EventMeta,
    private readonly capacity = 500,
  ) {}

  async saveRound(s: Snapshot): Promise<void> {
    if (this.byRound.has(s.round)) return;
    this.byRound.set(s.round, structuredClone(s));
    if (this.byRound.size > this.capacity) {
      const oldest = Math.min(...this.byRound.keys());
      this.byRound.delete(oldest);
    }
  }

  async rounds(upTo?: number): Promise<Snapshot[]> {
    return [...this.byRound.values()]
      .filter((s) => upTo === undefined || s.round <= upTo)
      .sort((a, b) => a.round - b.round)
      .map((s) => structuredClone(s));
  }

  async latest(): Promise<Snapshot | null> {
    const all = await this.rounds();
    return all.length ? all[all.length - 1] : null;
  }

  async eventMeta(): Promise<EventMeta> {
    return this.meta;
  }
}

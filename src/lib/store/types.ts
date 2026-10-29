import type { RankedTeam } from '../source/types';

/** One stored round. `capturedAt` is OUR clock at fetch time (ISO UTC); freeze decisions use it, never the source's. */
export interface Snapshot {
  round: number;
  capturedAt: string;
  teams: RankedTeam[];
}

export interface EventMeta {
  slug: string;
  name: string;
  startsAt?: string;
  freezeAt?: string;
  endsAt?: string;
}

/** saveRound is idempotent per round: saving a round that is already stored changes nothing. */
export interface SnapshotStore {
  saveRound(s: Snapshot): Promise<void>;
  latest(): Promise<Snapshot | null>;
  /** Ascending by round; `upTo` inclusive. */
  rounds(upTo?: number): Promise<Snapshot[]>;
  eventMeta(): Promise<EventMeta>;
}

export type BoardState = 'pre_event' | 'live' | 'frozen' | 'revealed' | 'stale' | 'unavailable';

export interface StateInput {
  now: number;
  startMs?: number;
  freezeMs?: number;
  revealed: boolean;
  /** Whether any round is visible to the public after freeze clipping. */
  hasVisibleData: boolean;
  lastOkAt?: number;
  failures: number;
  staleAfterMs: number;
}

/** The single freeze rule: past the freeze time and not revealed, nothing captured later may be served. */
export function isFrozen(now: number, freezeMs: number | undefined, revealed: boolean): boolean {
  return freezeMs !== undefined && now >= freezeMs && !revealed;
}

export function computeState(i: StateInput): BoardState {
  if (isFrozen(i.now, i.freezeMs, i.revealed)) return i.hasVisibleData ? 'frozen' : 'unavailable';
  if (!i.hasVisibleData) {
    const before = i.startMs !== undefined ? i.now < i.startMs : i.failures === 0;
    return before ? 'pre_event' : 'unavailable';
  }
  if (i.startMs !== undefined && i.now < i.startMs) return 'pre_event';
  if (i.freezeMs !== undefined && i.now >= i.freezeMs) return 'revealed';
  if (i.lastOkAt === undefined || i.now - i.lastOkAt > i.staleAfterMs) return 'stale';
  return 'live';
}

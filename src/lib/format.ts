import type { BoardBody } from './view';

export type PublicMeta = BoardBody['meta'];

/** "12 s", "4 min", "1 h 05 min". Whole numbers only; never negative. */
export function ageText(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  return `${Math.floor(s / 3600)} h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')} min`;
}

/** Seconds since the data was captured, on the server's clock (the viewer's clock may be wrong). */
export function dataAgeSec(meta: PublicMeta, skewMs: number, nowMs: number): number | null {
  if (!meta.capturedAt) return null;
  return (nowMs + skewMs - Date.parse(meta.capturedAt)) / 1000;
}

export const STATE_LABEL: Record<PublicMeta['state'], string> = {
  live: 'Live',
  stale: 'Not updating',
  frozen: 'Frozen',
  revealed: 'Final',
  pre_event: 'Not started',
  unavailable: 'Unavailable',
};

/** Plain-language banner for every state that is not simply "live". */
export function bannerText(meta: PublicMeta, ageSec: number | null): string | null {
  switch (meta.state) {
    case 'frozen':
      return `Scores are frozen at round ${meta.frozenAtRound ?? meta.round ?? '?'}. Final results will be announced.`;
    case 'stale':
      return `Scores have not updated for ${ageSec === null ? 'a while' : ageText(ageSec)}. These are the last scores received.`;
    case 'pre_event':
      return 'The event has not started yet.';
    case 'unavailable':
      return 'The scoreboard is not available right now. This page will keep trying.';
    case 'revealed':
      return 'Final results.';
    default:
      return null;
  }
}

export function isBoardBody(x: unknown): x is BoardBody {
  const b = x as BoardBody | null;
  return !!b && typeof b === 'object' && typeof b.meta?.state === 'string' && Array.isArray(b.teams);
}

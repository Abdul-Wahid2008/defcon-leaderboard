import type { AppConfig } from './config';
import { computeState, isFrozen, type BoardState } from './state';
import type { Snapshot } from './store/types';
import type { ServiceStatus } from './source/types';

export interface SourceState {
  lastOkAt?: number;
  lastAttemptAt?: number;
  consecutiveFailures: number;
  /** Internal code; never put in a public body. */
  lastErrorCode?: string;
}

export interface ViewInput {
  cfg: AppConfig;
  rounds: Snapshot[];
  revealed: boolean;
  source: SourceState;
  now: number;
}

export interface PublicTeam {
  teamId: string;
  name: string;
  rank: number;
  tied: boolean;
  total: number;
  attack?: number;
  defense?: number;
  sla?: number;
  rankDelta?: number;
  services?: { key: string; status: ServiceStatus }[];
}

export interface BoardBody {
  meta: {
    state: BoardState;
    event: { name: string };
    round: number | null;
    capturedAt: string | null;
    frozenAtRound?: number;
    serverTime: string;
    showServiceStatus: boolean;
  };
  teams: PublicTeam[];
}

const ms = (iso?: string) => (iso ? Date.parse(iso) : undefined);

/** Freeze clipping (D28): past the freeze and unrevealed, only rounds captured at or before the freeze exist. */
export function visibleRounds(i: ViewInput): Snapshot[] {
  const freezeMs = ms(i.cfg.FREEZE_AT_ISO);
  if (!isFrozen(i.now, freezeMs, i.revealed)) return i.rounds;
  return i.rounds.filter((r) => Date.parse(r.capturedAt) <= freezeMs!);
}

function stateOf(i: ViewInput, visible: Snapshot[]): BoardState {
  return computeState({
    now: i.now,
    startMs: ms(i.cfg.EVENT_START_ISO),
    freezeMs: ms(i.cfg.FREEZE_AT_ISO),
    revealed: i.revealed,
    hasVisibleData: visible.length > 0,
    lastOkAt: i.source.lastOkAt,
    failures: i.source.consecutiveFailures,
    staleAfterMs: i.cfg.STALE_AFTER_SEC * 1000,
  });
}

/** Explicit whitelist: nothing from storage reaches the public unless it is named here. */
function publicTeam(t: Snapshot['teams'][number], showServices: boolean): PublicTeam {
  return {
    teamId: t.teamId,
    name: t.name,
    rank: t.rank,
    tied: t.tied,
    total: t.total,
    ...(t.attack !== undefined ? { attack: t.attack } : {}),
    ...(t.defense !== undefined ? { defense: t.defense } : {}),
    ...(t.sla !== undefined ? { sla: t.sla } : {}),
    ...(t.rankDelta !== undefined ? { rankDelta: t.rankDelta } : {}),
    ...(showServices && t.services ? { services: t.services.map((s) => ({ key: s.key, status: s.status })) } : {}),
  };
}

export function buildBoard(i: ViewInput): BoardBody {
  const visible = visibleRounds(i);
  const latest = visible.at(-1);
  const state = stateOf(i, visible);
  const show = i.cfg.SHOW_SERVICE_STATUS;
  return {
    meta: {
      state,
      event: { name: i.cfg.EVENT_NAME },
      round: latest?.round ?? null,
      capturedAt: latest?.capturedAt ?? null,
      ...(state === 'frozen' && latest ? { frozenAtRound: latest.round } : {}),
      serverTime: new Date(i.now).toISOString(),
      showServiceStatus: show,
    },
    teams: latest ? latest.teams.map((t) => publicTeam(t, show)) : [],
  };
}

export interface HistoryBody {
  rounds: number[];
  series: { teamId: string; name: string; points: (number | null)[] }[];
}

/** Top `top` teams of the newest visible round; `null` where a team has no entry in a round (never a guessed value). */
export function buildHistory(i: ViewInput, top: number): HistoryBody {
  const visible = visibleRounds(i);
  const latest = visible.at(-1);
  if (!latest) return { rounds: [], series: [] };
  const chosen = [...latest.teams].sort((a, b) => a.rank - b.rank).slice(0, top);
  return {
    rounds: visible.map((r) => r.round),
    series: chosen.map((t) => ({
      teamId: t.teamId,
      name: t.name,
      points: visible.map((r) => r.teams.find((x) => x.teamId === t.teamId)?.total ?? null),
    })),
  };
}

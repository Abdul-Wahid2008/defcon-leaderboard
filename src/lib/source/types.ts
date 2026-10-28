export type ServiceStatus = 'ok' | 'mumble' | 'offline' | 'unknown';

export interface ParsedService {
  key: string;
  status: ServiceStatus;
}

/** One team as read from the source through the field map. Numbers are exactly as provided. */
export interface ParsedTeam {
  teamId: string;
  name: string;
  total: number;
  attack?: number;
  defense?: number;
  sla?: number;
  services?: ParsedService[];
}

export interface ParsedSnapshot {
  round: number;
  /** Source-provided timestamp, if the map names one. Never used for freeze decisions (our own capture clock is). */
  sourceTimestamp?: string;
  teams: ParsedTeam[];
}

export interface RankedTeam extends ParsedTeam {
  rank: number;
  tied: boolean;
  /** previous stored rank minus current rank; positive = moved up. Absent when there is no previous rank. */
  rankDelta?: number;
}

/**
 * Internal error codes. They are safe to log and to map to a generic public state, but a public response never
 * carries the code, a URL, a host or a message.
 */
export type SourceErrorCode =
  | 'SOURCE_SHAPE_UNKNOWN'
  | 'host_not_allowed'
  | 'not_configured'
  | 'timeout'
  | 'redirect'
  | 'too_large'
  | 'bad_content_type'
  | 'bad_json'
  | 'network'
  | `http_${number}`;

export class SourceError extends Error {
  readonly code: SourceErrorCode;
  /** Field names and rule names only, never values. Server-side logs only. */
  readonly detail?: string;
  constructor(code: SourceErrorCode, detail?: string) {
    super(code);
    this.name = 'SourceError';
    this.code = code;
    this.detail = detail;
  }
}

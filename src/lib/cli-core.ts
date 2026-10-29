import { parseRoster, type Roster } from './source/roster';
import type { BoardBody } from './view';

/** Reads a roster from JSON ({teams:[...]} or a bare array) or CSV (`teamId,displayName`, header optional). */
export function parseRosterText(text: string, fileName: string): Roster {
  if (/\.json$/i.test(fileName)) {
    const raw: unknown = JSON.parse(text);
    return parseRoster(Array.isArray(raw) ? { teams: raw } : raw);
  }
  const rows = text
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '');
  if (rows.length && /^teamid\s*,\s*displayname\s*$/i.test(rows[0].trim())) rows.shift();
  // Split on the first comma only, so a display name may contain commas. Quotes are not interpreted.
  const teams = rows.map((l) => {
    const i = l.indexOf(',');
    if (i < 0) throw new Error('roster: each CSV row needs teamId,displayName');
    return { teamId: l.slice(0, i).trim(), displayName: l.slice(i + 1).trim() };
  });
  return parseRoster({ teams });
}

export interface RosterDiff {
  added: string[];
  removed: string[];
  renamed: string[];
  unchanged: number;
}

export function rosterDiff(oldR: Roster | null, newR: Roster): RosterDiff {
  const o = new Map((oldR?.teams ?? []).map((t) => [t.teamId, t.displayName]));
  const n = new Map(newR.teams.map((t) => [t.teamId, t.displayName]));
  const d: RosterDiff = { added: [], removed: [], renamed: [], unchanged: 0 };
  for (const [id, name] of n) {
    if (!o.has(id)) d.added.push(id);
    else if (o.get(id) !== name) d.renamed.push(`${id}: ${o.get(id)} -> ${name}`);
    else d.unchanged++;
  }
  for (const id of o.keys()) if (!n.has(id)) d.removed.push(id);
  return d;
}

/** reveal/unreveal are public-facing and hard to take back: the operator must type the event slug exactly. */
export function slugConfirmed(typed: string | undefined, eventSlug: string | undefined): boolean {
  return !!eventSlug && typed?.trim() === eventSlug;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Static fallback page (served by nginx if the Node process dies). Text only, escaped, no scripts, no external requests. */
export function renderFinalHtml(b: BoardBody): string {
  const rows = b.teams
    .map((t) => `<tr><td>${t.tied ? '=' : ''}${t.rank}</td><td>${esc(t.name)}</td><td>${t.total}</td></tr>`)
    .join('');
  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta name="robots" content="noindex"><title>${esc(b.meta.event.name)}</title>` +
    `<style>body{font:16px system-ui,sans-serif;margin:24px;background:#0b0d10;color:#f2f4f7}table{border-collapse:collapse}` +
    `td,th{padding:6px 14px;border-bottom:1px solid #2a2f37;text-align:left}td:last-child,th:last-child{text-align:right;font-variant-numeric:tabular-nums}</style></head><body>` +
    `<h1>${esc(b.meta.event.name)}</h1><p>State: ${b.meta.state}. Round ${b.meta.round ?? 'none'}. Captured ${b.meta.capturedAt ?? 'never'}.</p>` +
    `<table><caption>Scores</caption><thead><tr><th scope="col">Rank</th><th scope="col">Team</th><th scope="col">Total</th></tr></thead><tbody>${rows}</tbody></table></body></html>`
  );
}

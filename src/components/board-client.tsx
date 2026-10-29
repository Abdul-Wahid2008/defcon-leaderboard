'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ageText, bannerText, dataAgeSec, isBoardBody, STATE_LABEL } from '../lib/format';
import type { BoardBody, PublicTeam } from '../lib/view';
import { IconClock, IconDown, IconFlag, IconLive, IconSnow, IconUp, IconWarn } from './icons';
import { TeamDrawer } from './team-drawer';

const POLL_MS = 10_000;
const FLASH_MS = 600;

const fmt = (n: number | undefined) => (n === undefined ? '' : new Intl.NumberFormat('en', { maximumFractionDigits: 3 }).format(n));

const STATE_ICON = { live: IconLive, stale: IconClock, frozen: IconSnow, revealed: IconFlag, pre_event: IconClock, unavailable: IconWarn } as const;

function Delta({ d }: { d: number | undefined }) {
  if (!d) {
    return (
      <span className="delta delta-none">
        <span aria-hidden="true">–</span>
        <span className="sr-only">no change</span>
      </span>
    );
  }
  return (
    <span className={`delta ${d > 0 ? 'delta-up' : 'delta-down'}`}>
      {d > 0 ? <IconUp /> : <IconDown />}
      <span aria-hidden="true">{Math.abs(d)}</span>
      <span className="sr-only">
        {d > 0 ? 'up' : 'down'} {Math.abs(d)}
      </span>
    </span>
  );
}

export function BoardClient({ initial, tv }: { initial: BoardBody | null; tv: boolean }) {
  const [data, setData] = useState<BoardBody | null>(initial);
  // Server clock minus ours, so "updated N s ago" does not depend on the viewer's clock being right.
  const [skew, setSkew] = useState(0);
  const [now, setNow] = useState(() => (initial ? Date.parse(initial.meta.serverTime) : 0));
  const [failed, setFailed] = useState(false);
  const [flash, setFlash] = useState<ReadonlySet<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const prevTotals = useRef<Map<string, number>>(new Map(initial?.teams.map((t) => [t.teamId, t.total])));

  const apply = useCallback((b: BoardBody) => {
    const changed = new Set<string>();
    for (const t of b.teams) if (prevTotals.current.has(t.teamId) && prevTotals.current.get(t.teamId) !== t.total) changed.add(t.teamId);
    prevTotals.current = new Map(b.teams.map((t) => [t.teamId, t.total]));
    setData(b);
    setSkew(Date.parse(b.meta.serverTime) - Date.now());
    setNow(Date.now());
    if (changed.size) {
      setFlash(changed);
      clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setFlash(new Set()), FLASH_MS);
    }
  }, []);

  // Poll every 10 s +-20%, paused while hidden, aborted on unmount, exponential backoff on errors, last data kept.
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let ctrl: AbortController | undefined;
    let failures = 0;
    let lastLoad = 0;
    let inFlight = false;

    const schedule = () => {
      if (stopped) return;
      const base = POLL_MS * Math.min(2 ** failures, 6);
      timer = setTimeout(load, base * (0.8 + Math.random() * 0.4));
    };
    async function load() {
      if (stopped) return;
      if (document.hidden) return schedule(); // resumes via visibilitychange as well
      if (inFlight) return; // one request at a time, so there is only ever one timer chain
      inFlight = true;
      ctrl = new AbortController();
      lastLoad = Date.now();
      try {
        const r = await fetch('/api/board', { signal: AbortSignal.any([ctrl.signal, AbortSignal.timeout(8000)]) });
        if (!r.ok) throw new Error('http');
        const b: unknown = await r.json();
        if (!isBoardBody(b)) throw new Error('shape');
        failures = 0;
        setFailed(false);
        apply(b);
      } catch {
        if (stopped) return;
        failures++;
        setFailed(true);
      } finally {
        inFlight = false;
      }
      schedule();
    }
    const onVisible = () => {
      if (!document.hidden && !inFlight && Date.now() - lastLoad > 5000) {
        clearTimeout(timer);
        void load();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    schedule();
    return () => {
      stopped = true;
      clearTimeout(timer);
      ctrl?.abort();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [apply]);

  // One-second tick for the "updated" text.
  useEffect(() => {
    const t = setTimeout(() => {
      if (initial) setSkew(Date.parse(initial.meta.serverTime) - Date.now());
      setNow(Date.now());
    }, 0);
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => (clearTimeout(t), clearInterval(id));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- initial is only the first paint

  const teams = data?.teams ?? [];
  const meta = data?.meta;
  const nowMs = now;
  const age = meta ? dataAgeSec(meta, skew, nowMs) : null;
  const banner = meta ? bannerText(meta) : null;
  const StateIcon = meta ? STATE_ICON[meta.state] : IconClock;
  const has = (k: 'attack' | 'defense' | 'sla') => teams.some((t) => t[k] !== undefined);
  const showAttack = has('attack');
  const showDefense = has('defense');
  const showSla = has('sla');
  const selected: PublicTeam | null = teams.find((t) => t.teamId === open) ?? null;

  return (
    <main className={`page${tv ? ' tv' : ''}`}>
      <header className="head">
        <h1 className="title">{meta?.event.name ?? 'DEFCON 2.0'}</h1>
        <div className="status">
          {meta && (
            <span className="pill" data-state={meta.state}>
              <StateIcon />
              {STATE_LABEL[meta.state]}
            </span>
          )}
          {meta?.round != null && <span className="secondary round">Round {meta.round}</span>}
          {meta && age !== null && <span className="secondary updated">Updated {ageText(age)} ago</span>}
        </div>
      </header>

      <div className="banner-slot">
        {banner && (
          <p className="banner" role="status">
            {banner}
          </p>
        )}
        {failed && (
          <p className="banner" role="status">
            Could not refresh. Showing the last update.
          </p>
        )}
      </div>

      {teams.length === 0 ? (
        <p className="muted empty">{meta ? 'No scores to show yet.' : 'Waiting for the first scoreboard update.'}</p>
      ) : (
        <table className="board">
          <caption className="sr-only">Scores by team</caption>
          <thead>
            <tr>
              <th scope="col" className="num rank">
                Rank
              </th>
              <th scope="col">Team</th>
              <th scope="col" className="num">
                Total
              </th>
              {showAttack && (
                <th scope="col" className="num extra">
                  Attack
                </th>
              )}
              {showDefense && (
                <th scope="col" className="num extra">
                  Defense
                </th>
              )}
              {showSla && (
                <th scope="col" className="num extra">
                  SLA
                </th>
              )}
              <th scope="col" className="num extra">
                Change
              </th>
            </tr>
          </thead>
          <tbody>
            {teams.map((t) => (
              <tr key={t.teamId} className={`${flash.has(t.teamId) ? 'row-flash ' : ''}${t.rank <= 3 ? 'top3' : ''}`} onClick={tv ? undefined : () => setOpen(t.teamId)}>
                <td className="num rank">
                  {t.tied ? '=' : ''}
                  {t.rank}
                </td>
                <th scope="row" className="team">
                  {tv ? (
                    <span className="team-name">{t.name}</span>
                  ) : (
                    <button type="button" className="team-btn" onClick={(e) => (e.stopPropagation(), setOpen(t.teamId))}>
                      {t.name}
                    </button>
                  )}
                </th>
                <td className="num total">{fmt(t.total)}</td>
                {showAttack && <td className="num extra">{fmt(t.attack)}</td>}
                {showDefense && <td className="num extra">{fmt(t.defense)}</td>}
                {showSla && <td className="num extra">{fmt(t.sla)}</td>}
                <td className="num extra">
                  <Delta d={t.rankDelta} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {!tv && <TeamDrawer team={selected} showServices={!!meta?.showServiceStatus} onClose={() => setOpen(null)} />}
    </main>
  );
}

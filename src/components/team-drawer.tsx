'use client';

import { useEffect, useRef, useState } from 'react';
import type { HistoryBody, PublicTeam } from '../lib/view';
import { IconClose } from './icons';
import { Sparkline } from './sparkline';

const fmt = (n: number | undefined) => (n === undefined ? '–' : new Intl.NumberFormat('en', { maximumFractionDigits: 3 }).format(n));

export function TeamDrawer({ team, showServices, onClose }: { team: PublicTeam | null; showServices: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [loaded, setLoaded] = useState<{ id: string; h: HistoryBody | 'error' } | null>(null);

  // Native <dialog>: focus trap, Esc to close, inert page behind it and focus restore to the opener come with showModal().
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (team && !d.open) d.showModal();
    if (!team && d.open) d.close();
  }, [team]);

  useEffect(() => {
    if (!team) return;
    const ctrl = new AbortController();
    const id = team.teamId;
    fetch('/api/history?top=30', { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('bad'))))
      .then((h: HistoryBody) => (Array.isArray(h?.rounds) && Array.isArray(h?.series) ? setLoaded({ id, h }) : Promise.reject(new Error('shape'))))
      .catch((e) => {
        if (!ctrl.signal.aborted && e) setLoaded({ id, h: 'error' });
      });
    return () => ctrl.abort();
  }, [team?.teamId]); // eslint-disable-line react-hooks/exhaustive-deps -- reload per team, not per poll

  // Loading until the response for THIS team has arrived.
  const hist = loaded && loaded.id === team?.teamId ? loaded.h : null;
  const series = hist && hist !== 'error' ? hist.series.find((s) => s.teamId === team?.teamId) : undefined;

  return (
    <dialog
      ref={ref}
      className="drawer"
      aria-labelledby="drawer-title"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) ref.current?.close(); // click on the backdrop
      }}
    >
      {team && (
        <div className="drawer-body">
          <div className="drawer-head">
            <h2 id="drawer-title" className="section-title">
              {team.name}
            </h2>
            <button type="button" className="icon-btn" onClick={() => ref.current?.close()} aria-label="Close">
              <IconClose />
            </button>
          </div>
          <dl className="facts">
            <dt>Rank</dt>
            <dd>
              {team.tied ? '=' : ''}
              {team.rank}
            </dd>
            <dt>Total</dt>
            <dd>{fmt(team.total)}</dd>
            <dt>Attack</dt>
            <dd>{fmt(team.attack)}</dd>
            <dt>Defense</dt>
            <dd>{fmt(team.defense)}</dd>
            <dt>SLA</dt>
            <dd>{fmt(team.sla)}</dd>
          </dl>
          {showServices && team.services && (
            <ul className="services" aria-label="Services">
              {team.services.map((s) => (
                <li key={s.key}>
                  {s.key}: {s.status}
                </li>
              ))}
            </ul>
          )}
          <h3 className="secondary-title">Total by round</h3>
          {hist === null && <p className="muted">Loading history…</p>}
          {hist === 'error' && <p className="muted">History is not available right now.</p>}
          {hist && hist !== 'error' && (series ? <Sparkline rounds={hist.rounds} points={series.points} label={`${team.name} total`} /> : <p className="muted">No history for this team yet.</p>)}
        </div>
      )}
    </dialog>
  );
}

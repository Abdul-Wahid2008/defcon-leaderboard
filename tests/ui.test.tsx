import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { BoardClient } from '../src/components/board-client';
import { ageText, bannerText } from '../src/lib/format';
import { buildBoard } from '../src/lib/view';
import { FREEZE, T0, marked, world } from './helpers/deps';

const html = (b: ReturnType<typeof buildBoard> | null, tv = false) => renderToStaticMarkup(<BoardClient initial={b} tv={tv} />);

describe('rendered HTML', () => {
  it('shows the waiting state before any data', () => {
    expect(html(null)).toContain('Waiting for the first scoreboard update.');
  });

  it('is a semantic table with scoped headers, a caption, tied ranks and escaped names', async () => {
    const w = await world({}, [
      { ...marked(1, T0 + 1000), teams: [
        { teamId: 'a', name: '<img src=x onerror=alert(1)>', total: 5, rank: 1, tied: true },
        { teamId: 'b', name: 'Bravo', total: 5, rank: 1, tied: true },
      ] },
    ]);
    const out = html(buildBoard({ cfg: w.deps.cfg, rounds: await w.store.rounds(), revealed: false, source: w.source, now: w.clock.t }));
    expect(out).toContain('<caption class="sr-only">Scores by team</caption>');
    expect(out).toContain('scope="col"');
    expect(out).toContain('scope="row"');
    expect(out).toContain('=1');
    expect(out).not.toContain('<img');
    expect(out).toContain('&lt;img');
  });

  it('frozen HTML contains no later round, total or capture time (D28, P9)', async () => {
    const rounds = Array.from({ length: 10 }, (_, i) => marked(i + 1, T0 + (i + 1) * 30 * 60_000));
    const w = await world({}, rounds);
    const now = FREEZE + 60_000;
    const out = html(buildBoard({ cfg: w.deps.cfg, rounds: await w.store.rounds(), revealed: false, source: { consecutiveFailures: 0, lastOkAt: now }, now }));
    expect(out).toContain('Scores are frozen at round 6. Final results will be announced.');
    for (let r = 7; r <= 10; r++) {
      expect(out).not.toContain(String(90000 + r));
      expect(out).not.toContain(new Date(T0 + r * 30 * 60_000).toISOString());
    }
    expect(out).not.toContain('Round 7');
  });

  it('tv mode has no buttons or dialog', async () => {
    const w = await world({}, [marked(1, T0 + 1000)]);
    const out = html(buildBoard({ cfg: w.deps.cfg, rounds: await w.store.rounds(), revealed: false, source: w.source, now: w.clock.t }), true);
    expect(out).toContain('class="page tv"');
    expect(out).not.toContain('<button');
    expect(out).not.toContain('<dialog');
  });

  it('uses no banned marketing words', async () => {
    const w = await world({}, [marked(1, T0 + 1000)]);
    const out = html(buildBoard({ cfg: w.deps.cfg, rounds: await w.store.rounds(), revealed: false, source: w.source, now: w.clock.t }));
    expect(out).not.toMatch(/seamless|powerful|elevate|effortless|robust|leverage|journey|blazing|cutting-edge/i);
  });
});

describe('format', () => {
  it('formats ages', () => {
    expect([ageText(-5), ageText(9.9), ageText(60), ageText(3599), ageText(3900)]).toEqual(['0 s', '9 s', '1 min', '59 min', '1 h 05 min']);
  });

  it('has plain copy for every non-live state', () => {
    const m = (state: string) => ({ state, event: { name: 'x' }, round: 3, capturedAt: null, serverTime: '', showServiceStatus: false }) as never;
    expect(bannerText(m('live'))).toBeNull();
    expect(bannerText(m('stale'))).toBe('Scores are not updating right now. These are the last scores received.');
    for (const s of ['pre_event', 'unavailable', 'revealed']) expect(bannerText(m(s))).toBeTruthy();
  });
});

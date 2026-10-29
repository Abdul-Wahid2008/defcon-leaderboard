import 'server-only';
import { createClient } from '@supabase/supabase-js';
import type { EventMeta, Snapshot } from './types';
import { snapshotFromRows, type LbDb } from './supabase';

const PAGE = 1000; // PostgREST returns at most 1000 rows per request

type Rows = Parameters<typeof snapshotFromRows>[2];

/**
 * supabase-js adapter. Server-only, built lazily with the secret key. NOT exercised against a live project (no key in
 * this environment); the store logic above it is tested through a fake LbDb.
 */
export function createLbDb(url: string, secretKey: string): LbDb {
  const sb = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });

  return {
    async ensureEvent(meta: EventMeta) {
      const { data, error } = await sb
        .from('lb_events')
        .upsert(
          { slug: meta.slug, name: meta.name, starts_at: meta.startsAt ?? null, freeze_at: meta.freezeAt ?? null, ends_at: meta.endsAt ?? null },
          { onConflict: 'slug' },
        )
        .select('id')
        .single();
      if (error || !data) throw new Error('supabase_event');
      return data.id as string;
    },

    async upsertRound(eventId: string, s: Snapshot) {
      const r = await sb.from('lb_rounds').upsert({ event_id: eventId, round: s.round, captured_at: s.capturedAt }, { onConflict: 'event_id,round' });
      if (r.error) throw new Error('supabase_round');
      const rows = s.teams.map((t) => ({
        event_id: eventId,
        round: s.round,
        team_id: t.teamId,
        team_name: t.name,
        total: t.total,
        attack: t.attack ?? null,
        defense: t.defense ?? null,
        sla: t.sla ?? null,
        rank: t.rank,
      }));
      const sc = await sb.from('lb_scores').upsert(rows, { onConflict: 'event_id,round,team_id' });
      if (sc.error) throw new Error('supabase_scores');
    },

    async listRounds(eventId: string, upTo?: number) {
      let rq = sb.from('lb_rounds').select('round,captured_at').eq('event_id', eventId).order('round');
      if (upTo !== undefined) rq = rq.lte('round', upTo);
      const rounds = await rq;
      if (rounds.error) throw new Error('supabase_rounds');

      const byRound = new Map<number, Rows>();
      for (let from = 0; ; from += PAGE) {
        let q = sb
          .from('lb_scores')
          .select('round,team_id,team_name,total,attack,defense,sla,rank')
          .eq('event_id', eventId)
          .order('round')
          .order('team_id')
          .range(from, from + PAGE - 1);
        if (upTo !== undefined) q = q.lte('round', upTo);
        const page = await q;
        if (page.error) throw new Error('supabase_scores');
        for (const row of page.data ?? []) {
          const list = byRound.get(row.round) ?? [];
          list.push(row);
          byRound.set(row.round, list);
        }
        if ((page.data?.length ?? 0) < PAGE) break;
      }
      return (rounds.data ?? []).map((r) => snapshotFromRows(r.round, r.captured_at, byRound.get(r.round) ?? []));
    },
  };
}

# BLOCKERS

Each entry: what is blocked, the exact input needed, what was done instead.

## B1 — Supabase: project created, secret key still to be placed by Abdul
- Done (29 Oct 2026, after Abdul allowed it): project `defcon-leaderboard` created in ap-south-1 in the existing free-plan organization (the paused `pitch-under-pressure` project was not touched); migration `lb_init` applied through `apply_migration`; advisors run; types generated into `src/lib/db.types.ts`; schema verified with SELECT-only queries (RLS on all four tables, 0 policies, 0 privileges for anon/authenticated, both audit triggers present, index present).
- Advisors: security 4 x INFO `rls_enabled_no_policy` (one per table) and performance 1 x INFO `unused_index` (the new table has had no traffic). Both are intentional: the spec requires RLS deny-all with no policies and the (event_id, team_id, round) index. Accepted, not "fixed".
- Still needed from Abdul: put `SUPABASE_URL` (Project Settings, API) and `SUPABASE_SECRET_KEY` (the secret key; verify the current key naming in the dashboard) in `.env.local` himself. Then run a rehearsal and confirm rounds appear in `lb_rounds`/`lb_scores` and that `npm run status` shows `supabase ok, 0 round(s) not yet pushed`.
- Not verified: the supabase-js adapter has never run with a real key; idempotent upserts and the FK order were not exercised against the live database (an attempted DML check was held back by the SQL tool's confirmation step and did not run; the tables are empty).
- Check the project is ACTIVE before the event (free projects pause when idle).

## B2 — No real scoreboard.json sample, roster, or event times
- Needed: `docs/club-inputs/scoreboard.sample.json`, the roster (due 30 Oct), `EVENT_START_ISO` / `FREEZE_AT_ISO` / `EVENT_END_ISO`, `SCOREBOARD_URL`, hosting/TLS facts, club confirmation of A32.
- Done instead: PROVISIONAL mapping and fixture; parser fails closed.

## B3 — Show service status publicly?
- Needed: club decision. Default `SHOW_SERVICE_STATUS=false` (a public "service down" list helps attackers).

## B4 — Can rounds pause for longer than 270 s?
- The board says "not updating" when no new round has been stored for `STALE_AFTER_SEC`. A deliberate pause (break, phase change) longer than that would show the banner. Needed: club answer, then adjust `STALE_AFTER_SEC`.

## B5 — Hosting topology
- Needed: OS, public domain or not, TLS or not, any CDN. Affects `TRUST_PROXY`, per-client limiting and the nginx block (docs/DEPLOY.md is untested).

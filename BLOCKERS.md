# BLOCKERS

Each entry: what is blocked, the exact input needed, what was done instead.

## B1 — Supabase project not created (L2)
- Blocked: creating project `defcon-leaderboard` (ap-south-1). The prompt requires `get_cost` to show no recurring charge; this session has no `get_cost` tool, so cost cannot be verified. The only existing project is `pitch-under-pressure` (INACTIVE), which must not be touched.
- Needed from Abdul: either create the project (or confirm the free tier has capacity), then apply `supabase/migrations/lb_init.sql` and place `SUPABASE_URL` / `SUPABASE_SECRET_KEY` in `.env.local`.
- Done instead: migration SQL written to the repo; store code tested against a fake; app runs fully without Supabase (memory + JSONL).

## B2 — No real scoreboard.json sample, roster, or event times
- Needed: `docs/club-inputs/scoreboard.sample.json`, the roster (due 30 Oct), `EVENT_START_ISO` / `FREEZE_AT_ISO` / `EVENT_END_ISO`, `SCOREBOARD_URL`, hosting/TLS facts, club confirmation of A32.
- Done instead: PROVISIONAL mapping and fixture; parser fails closed.

## B3 — Show service status publicly?
- Needed: club decision. Default `SHOW_SERVICE_STATUS=false` (a public "service down" list helps attackers).

## B4 — Can rounds pause for longer than 270 s?
- The board says "not updating" when no new round has been stored for `STALE_AFTER_SEC`. A deliberate pause (break, phase change) longer than that would show the banner. Needed: club answer, then adjust `STALE_AFTER_SEC`.

## B5 — Hosting topology
- Needed: OS, public domain or not, TLS or not, any CDN. Affects `TRUST_PROXY`, per-client limiting and the nginx block (docs/DEPLOY.md is untested).

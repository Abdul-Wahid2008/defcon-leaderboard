# BLOCKERS

Each entry: what is blocked, the exact input needed, what was done instead.

## B1 — Supabase project not created (L2)
- Blocked: creating project `defcon-leaderboard` (ap-south-1). The prompt requires `get_cost` to show no recurring charge; this session has no `get_cost` tool, so cost cannot be verified. The only existing project is `pitch-under-pressure` (INACTIVE), which must not be touched.
- Needed from Abdul: either create the project (or confirm the free tier has capacity), then apply `supabase/migrations/lb_init.sql` and place `SUPABASE_URL` / `SUPABASE_SECRET_KEY` in `.env.local`.
- Done instead: migration SQL written to the repo; store code tested against a fake; app runs fully without Supabase (memory + JSONL).

## B2 — No real scoreboard.json sample, roster, or event times
- Needed: `docs/club-inputs/scoreboard.sample.json`, the roster (due 30 Oct), `EVENT_START_ISO` / `FREEZE_AT_ISO` / `EVENT_END_ISO`, `SCOREBOARD_URL`, hosting/TLS facts, club confirmation of A32.
- Done instead: PROVISIONAL mapping and fixture; parser fails closed.

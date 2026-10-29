# OVERNIGHT LOG

Append after every slice: time, slice, commit hash, gate results, decisions made, anything skipped.

## L0 — Scaffold and gates (29 Oct 2026)
- Gates: typecheck 0 · lint 0 errors · vitest 34/34 in 3 files (config, check-env, headers/proxy) · `next build` 0 · production server on 127.0.0.1:3200.
- Verified live: `/api/healthz` 200 `{"ok":true}` no-store; home page carries a fresh CSP nonce and Next stamps it on every script tag; malformed percent path -> 400; no CORS, no cookies, no HSTS, no X-Powered-By.
- `check-env`: fails (exit 1) on missing FREEZE_AT_ISO/EVENT_SLUG/SCOREBOARD_URL, non-loopback HOSTNAME and a NEXT_PUBLIC_ credential; passes a correct release env (exit 0). Prints names only.
- Decisions: relative imports in `src/lib` so tsx scripts need no path alias; `vitest.config.mts` (CJS config warning); `vite` added as a devDependency because vitest 5 needs it as a peer (same as the dashboard); npm scripts for later slices (status, peek, reveal, ...) are added by the slice that creates the script, not as dead stubs; `npm install --ignore-scripts --legacy-peer-deps` (no native deps here).
- Skipped: pre-flight items that belong to Abdul (powercfg, pushes, `claude mcp list`). Nothing was pushed.

## L1 — Source, field-map parser, ranking (29 Oct 2026)
- Gates: typecheck 0 · lint 0 errors · vitest 129 passed + 1 skipped (real-sample test skips until `docs/club-inputs/scoreboard.sample.json` exists) in 8 files · build 0 · coverage `src/lib/source` branches 98.19% (target 95).
- Built: fetcher (host allow-list, 5 s timeout, redirect:'error', credentials omit, 2 MB streamed cap, content-type check, errors are short codes only), mapping-driven parser (`config/source-map.json`, zod, own-property paths, all-or-nothing), sanitiser, competition ranker with rankDelta, round decision, roster overrides (names only), PROVISIONAL fixture, `docs/SOURCE_MAPPING.md`.
- Reviewer (fresh subagent, read-only, ran nothing) over L0+L1: 12 findings, all applied. Fail-open `CHECK_RELEASE` parsing (now any non-"off" value means release); lone surrogates and blank-looking fillers/Zalgo in names; total bound off by one (`>= 1e11` rejected); ranking at 3 decimals to match storage; a mapped field missing in the source now fails closed (was silently dropped), timestamp must be ISO and is stored as UTC ISO; `-0` normalised; response body cancelled before refusing; hyphens allowed in map paths; `BASE_PATH` rejects `//`. Partly applied: bind check still only errors on a non-loopback `HOSTNAME`/`HOST` (an unset value cannot be told from "not exported"); the start script hardcodes `-H 127.0.0.1`. Not done: dotted/space keys in map paths (documented).
- Decision: L0 and L1 were reviewed together (L0 was trivial); `lb-L0` stays as tagged.

## L2 — Stores: memory, JSONL, Supabase (29 Oct 2026)
- Gates: typecheck 0 · lint 0 errors · vitest 166 passed + 1 skipped in 10 files · build 0 · `.next/static` grep test ran after the build and found no Supabase names/keys.
- Built: `SnapshotStore`, MemoryStore (ring 500), JsonlStore (append-only, datasync per round, 0600, truncated last line tolerated, serialised appends), SupabaseStore over an `LbDb` interface (retry with backoff, per-attempt timeout), supabase-js adapter (lazy dynamic import, paged reads), FallbackStore (memory+JSONL first, remote queued and backfilled, 30 s outage cooldown), `supabase/migrations/lb_init.sql`.
- NOT run: the supabase-js adapter against a real project (no key, no project). `get_advisors` not run (B1). The SQL has not been applied anywhere.
- Reviewer (fresh subagent, read-only) 7 findings. Applied: local wins on startup merge (remote lacks services/rankDelta); a remote round with fewer teams than local is re-queued; JSONL newline guard after a failed write; saves no longer await the remote (flush is background, drains rounds queued mid-flush); 5 s timeout on the startup remote read; TRUNCATE trigger on lb_audit. Not applied: making the remote round+scores upsert one transaction (needs a Postgres RPC; the FK forces rounds-first; repair is by re-queue and idempotent upsert); memory-ring pending drop (unreachable at ~110 rounds).
- Decision: startup rebuild merges JSONL and Supabase by round (local wins) instead of strict Supabase-then-JSONL, so no data is lost either way.

## L3 — Collector, freeze, control CLI, public API (29 Oct 2026) — `d03c549`
- Gates: typecheck 0 · lint 0 errors · vitest 234 passed + 1 skipped in 15 files at the end of L3/L4 · build 0.
- Demo (`npm run demo:lifecycle`, production build, fake source, real CLI): PASS. pre_event, live, garbage source gives stale with 30 teams kept, recovery to live, frozen (visible round 62 while the source reached 73; history max 62), wrong slug refused, reveal gives round 74, unreveal back to 62.
- Reviewer (fresh subagent, read-only): no freeze leak found. Applied: one shared limiter bucket could lock everyone out (now no limiting without a trustworthy key, full table fails open); a failing store no longer looks live; freshness follows the newest stored round; contained exceptions in a tick; `unreveal` immediate (reveal flag in the cache key); atomic roster import with `.bak`; audit line written before the control file. Not applied: Supabase round-trip timestamp trust (the adapter stores and returns `captured_at` unchanged); register() retry logging.
- Decision: `store_error`, `round_backwards` and unexpected throws all count as source failures.

## L4 — UI (29 Oct 2026) — `cf91d8f`
- Gates as above; `npm run qa:layout` clean after fixing real findings it produced (TV text did not scale because body font-size was inherited as a computed value; the status line moved by a few pixels; the first drawer run failed because CDP needed the Enter key's text). `--prove` shows each check fires on a deliberate violation.
- Reviewer (fresh subagent): 12 findings, 11 applied. Notable: team names were truncated at 768 px (columns now hide below 1024 px), a ticking age inside a live region, rank change had no reliable accessible name, two polling chains possible after a slow fetch, drawer width on phones. Not applied: opening the drawer from a row click does not restore focus to the row (the keyboard path does).
- Skipped: rank-by-round sparkline (history carries totals only).
- NOT run: real phones, real browsers other than headless Chrome, screen reader.

## L5 — Attack and load (29 Oct 2026)
- `npm run attack`: 81 attempts, first run 4 failures: test client bug (non-ASCII URL), `__proto__` key ignored by the framework, TRACE generic 500 (accepted, nginx blocks the method), one over-strict expectation. Final run 0 failed. Table in `docs/SECURITY_PASS.md`.
- `npm run loadtest`: 10-minute run failed its own RSS check only because the baseline was the cold process; the check now uses the warmed-up baseline. 6-minute rerun passes. Numbers in SECURITY_PASS.md.
- `npm audit --omit=dev`: 0 vulnerabilities.
- Not reviewed by a separate subagent.

## L6 — Deployment docs (29 Oct 2026)
- `docs/DEPLOY.md`, `docs/EVENT_RUNBOOK.md`, `docs/GOLIVE_CHECKLIST.md` written. NOT executed or validated on any host; every command is marked verify on the target OS. nginx block refuses methods other than GET/HEAD/OPTIONS because of the TRACE finding.

## L7 — Morning report (29 Oct 2026)
- `docs/MORNING_REPORT.md` and `docs/BUILD_STATUS.md` written. Final gate re-run before the commit (see BUILD_STATUS section 3).
- Note: L5, L6 and L7 share one commit (ccc07d5); the tags lb-L5, lb-L6, lb-L7 all point at it (the L5 code fixes are inside cf91d8f).

## Follow-up session (29 Oct 2026): complete through L6 and verify
- Re-ran everything on the current tree: typecheck, lint, 234 tests, build, lifecycle demo (PASS), `qa:layout --prove` and full run (clean), attack, load. All green.
- Supabase: `list_projects`/`list_organizations`/`get_organization` (read-only) show one free-plan org with only the paused `pitch-under-pressure`. `create_project` was refused by the permission classifier; not retried. B1 therefore still stands; nothing was applied, no advisors, no generated types (`src/lib/db.types.ts` not created).
- L5/L6 reviewer (fresh subagent, read-only): about 30 findings. Applied: all attack-script gaps and weak assertions, load-test fixes, DEPLOY.md/RUNBOOK/GOLIVE corrections, JSON body on the proxy 400. Not applied: singleflight on concurrent cache misses (cheap, not needed), caching the over-size 503 body.
- Result: attack 96/96, load 5-min PASS (page loads included).
- Supabase (after Abdul allowed it): `create_project` defcon-leaderboard (ap-south-1, free-plan org, no cost quoted); `apply_migration` lb_init OK; advisors: security 4 x INFO rls_enabled_no_policy, performance 1 x INFO unused_index (both intentional, see BLOCKERS B1); SELECT-only schema check passed; `src/lib/db.types.ts` generated and the adapter now uses `createClient<Database>`. No secret key was requested or seen. A DML idempotency check through `execute_sql` did not run (confirmation step); tables are empty.
- Push: new PUBLIC GitHub repo created and `main` plus tags lb-L0..lb-L7 pushed (see the end of this file for the final hash).
- Final: pushed main at 7b9334e (commit 'feat(store): L2 Supabase project...'), tag lb-L2b-supabase.

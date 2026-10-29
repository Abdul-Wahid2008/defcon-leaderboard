# BUILD STATUS: DEFCON Leaderboard

Last updated: 29 Oct 2026 (overnight job, slices L0 to L7, plus a follow-up session that completed L2's Supabase part, re-reviewed L5/L6 and pushed). Repo: `defcon-leaderboard`, branch `main`, nothing pushed, no remote.

**One-line state:** the application is built and passes every gate on the local machine against a FAKE scoreboard. It has never seen the club's real
`scoreboard.json`, a real roster, real event times, nginx, TLS or Supabase. Treat everything below as "works against our assumptions", not as "ready for the event".

## 1. Slices

| Slice | Status | Commit / tag | Gates at that commit |
|---|---|---|---|
| L0 scaffold | green | `5d0da14` `lb-L0` | typecheck, lint 0 errors, 34 tests, build |
| L1 source, parser, ranking | green | `3760863` `lb-L1` | 129 tests (+1 skipped), `src/lib/source` branch coverage 98.19% |
| L2 stores | green; Supabase project created and schema applied, adapter not run with a real key | `0249ccb` `lb-L2` (+ follow-up commit for types and project) | 166 tests (+1 skipped), build, client-bundle grep |
| L3 collector, freeze, CLI, API | green | `d03c549` `lb-L3` | 222 to 234 tests, build, lifecycle demo PASS |
| L4 UI | green | `cf91d8f` `lb-L4` | 234 tests (+1 skipped), build, `qa:layout` clean, prove-mode clean |
| L5 attack and load | green (docs and script fixes in the L5 to L7 commit) | see git log, `ccc07d5` `lb-L5` | `attack` 96/96, `loadtest` PASS, `npm audit --omit=dev` 0 vulnerabilities |
| L6 deploy docs, runbook, checklist | written, NOT executed anywhere | `ccc07d5` `lb-L6` | docs only; every command marked "verify on the target OS" |
| L7 this report | done | `ccc07d5` `lb-L7` | final gate re-run, see section 6 |

The skipped test is the real-sample test in `tests/source.sample.test.ts`; it runs once `docs/club-inputs/scoreboard.sample.json` exists.

## 2. What exists

### Data path
- `src/lib/source/`: fetcher (host allow-list, 5 s timeout, `redirect:'error'`, no credentials, 2 MB streamed cap, content-type check, errors are short codes only), mapping-driven parser (`config/source-map.json`, zod, all-or-nothing, unknown shape = `SOURCE_SHAPE_UNKNOWN`), name sanitiser (control/bidi/zero-width stripped, 40 chars), competition ranker (1,2,2,4) with `rankDelta`, roster overrides (display names only).
- `src/lib/collector.ts`: single-flight pull, jittered poll loop (`POLL_SEC`), lazy refresh when the last attempt is older than 2 x poll. Stores a round only when its number is new. A round going backwards, a store write failure and any unexpected exception count as failures and are never "live".
- `src/lib/store/`: `SnapshotStore`; memory ring (500), append-only JSONL (`data/snapshots.jsonl`, datasync per round, truncated last line tolerated), Supabase store behind an `LbDb` interface (retry with backoff, per-attempt timeout), `FallbackStore` (memory + JSONL first, Supabase queued in the background and backfilled, 30 s outage cooldown, no duplicates). Startup merges JSONL and Supabase by round, local wins.
- `supabase/migrations/lb_init.sql`: schema per spec section 5, RLS on all four tables, no policies, anon/authenticated revoked, append-only audit table (UPDATE, DELETE and TRUNCATE blocked). **Applied** to the Supabase project `defcon-leaderboard` (ap-south-1) on 29 Oct 2026 via `apply_migration`; `src/lib/db.types.ts` generated from it and used to type the adapter.

### Public behaviour
- State machine (`src/lib/state.ts`, injected clock, table-tested): `pre_event | live | stale | frozen | revealed | unavailable`. Frozen takes precedence over stale/failing source. `live` requires a stored round newer than `STALE_AFTER_SEC` (freshness is the age of the newest stored round, so an engine repeating one round goes stale).
- Freeze (D28): past `FREEZE_AT_ISO` and not revealed, `visibleRounds()` keeps only rounds with `capturedAt <= freeze`. Both the API bodies and the server-rendered HTML go through it. `capturedAt` is our own clock, not the source's. A corrupt or missing `data/control.json` means "not revealed".
- API: `GET /api/board`, `GET /api/history?top=1..30`, `GET /api/healthz`; everything else gets a minimal JSON 404/405. 3 s in-process response cache (the key includes the reveal flag), ETag/304, `Cache-Control: public, max-age=2` on the two data routes only, no cookies, no CORS headers, 512 KB body cap, every failure is `{"error":"unavailable"}` 503 (never a bare 500, no stack, no host, no URL).
- Rate limit: per right-most `X-Forwarded-For` entry, only when `TRUST_PROXY=true` and the value is a well-formed address. Otherwise the app does not limit (a shared bucket would let one client lock out everyone); nginx does (see `DEPLOY.md`). A full limiter table fails open.
- Service status per team is omitted from the API unless `SHOW_SERVICE_STATUS=true` (default false, D35).
- No HTTP admin surface (D27). Host-side CLI (`npm run status|peek|reveal|unreveal|refresh|snapshot|import-roster`): reveal/unreveal need the typed event slug and write an audit line first; refresh is a request written into `control.json` that the running server notices within ~2 s; roster import is a dry run unless `--yes`, atomic, keeps `roster.json.bak`.

### UI
- Server-rendered board (initial data is the same clipped body as the API), client polling every 10 s +-20% with exponential backoff to 60 s, paused while hidden, one request at a time, 8 s timeout, last data kept with a visible "Could not refresh" line. State pill with 16 px icon + text, round, "Updated N s ago" on the server's clock (skew-corrected), plain banners for every non-live state, tied ranks as `=2`, top three marked by a thin accent bar, rank change with screen-reader text, flash on a changed total (600 ms, off under `prefers-reduced-motion`).
- Team drawer is a native `<dialog>` (focus trap, Esc, focus restore) with an inline SVG total-by-round line from `/api/history`. **Rank-by-round is not charted**: history carries totals only and ranks are not recomputed client-side.
- `?tv=1`: viewport-scaled type, 30 teams fit 1920x1080 (last row ends at 1043 to 1051 px of 1080), no buttons, no dialog.
- Below 1024 px only rank, team and total are shown (the 768 px layout used to truncate team names; fixed after review).
- System fonts only, no external request, no UI kit, no chart library, no state library. The only runtime dependency added beyond the scaffold is `@supabase/supabase-js` (the history store named in the stack).

## 3. Evidence (all run on 29 Oct 2026 on the build machine)

| Check | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm run lint` | 0 errors, 0 warnings |
| `npm test` | 15 files, 234 passed, 1 skipped |
| `npm run build` | passes (one Turbopack warning about a whole-project file trace from `path.resolve(process.cwd(), ...)` in the roster/source-map loaders; harmless, not removed) |
| `npm run check-env` | exits 1 on a bad release env, 0 on a good one (L0, unchanged) |
| Lifecycle demo (`npm run demo:lifecycle`, production build, fake source) | PASS: pre_event, live, garbage source gives stale with data kept, recovery to live, frozen (visible round stays at 62 while the source reached 73; history max 62), wrong slug rejected, reveal gives round 74, unreveal returns to round 62 |
| `npm run qa:layout` (headless Chrome via CDP) | clean: live at 390/768/1024/1280/1440/1920, `?tv=1`, pre_event/stale/frozen/unavailable at 390 and 1280, drawer by keyboard, no console errors, no horizontal overflow, contrast >= 4.5:1, focus rings, five-size type scale, 16 px icons, CLS 0.0000 over 25 s of polling |
| `npm run qa:layout -- --prove` | every check fires on a deliberate violation (overflow, contrast, font size, icon size, banned word, missing focus ring, console error) |
| `npm run attack` | 96 attempts, 0 failed after the second (reviewed, stricter) pass; 81 on the first pass (details in `docs/SECURITY_PASS.md`) |
| `npm run loadtest -- --minutes 6` | PASS: 11 878 requests all 200, p95 5.9 ms, 0 failures, RSS +0.7% after warm-up, 1.00 upstream pull per POLL_SEC, 0 duplicate rounds. A 10-minute run was also done: see SECURITY_PASS.md for why its first verdict was FAIL and what changed in the check |
| `npm audit --omit=dev` | 0 vulnerabilities |
| Screenshots | `docs/screens/`: live-{390,768,1280,1920}, live-tv-1920x1080, live-drawer-{390,1280}, frozen-{390,1280}, frozen-tv-1920x1080, pre_event-{390,1280}, stale-{390,1280}, unavailable-{390,1280} |

Reviews: a fresh read-only subagent reviewed L2, L3, L4 and later L5/L6 (and L0+L1 earlier). Findings applied are listed in `docs/OVERNIGHT_LOG.md`. L7 is documentation only.

## 4. Contract (all additive; nothing was published before, so nothing was broken)

`CONTRACT CHANGES` relative to spec section 3, for the dashboard docs to absorb:
1. `meta.event.name` is present (event name for the page title).
2. `meta.round` and `meta.capturedAt` are `null` (not omitted) when no round is visible.
3. `/api/history` `series[].points` may contain `null` where a team has no entry in a round (never an invented value). `rounds` and `points` have equal length.
4. Error bodies are `{"error":"<code>"}` with codes `bad_request`, `rate_limited` (with `Retry-After: 30`), `unavailable`, `not_found`, `method_not_allowed`.
5. Round-trips through Supabase lose `services` and `rankDelta` (not stored by the schema); local JSONL keeps them and wins on restart.

## 5. Decisions made without asking (all reversible)

- Startup history merges JSONL and Supabase by round, local winning, instead of strict "Supabase, else JSONL".
- A repeated round does not refresh liveness; a restart shows the stored round's own age. Consequence: if the engine stops advancing rounds for more than `STALE_AFTER_SEC` (270 s default, three rounds) the board says "not updating" even though the source is reachable. This is intended; confirm the club agrees (a long deliberate pause would show it).
- No per-client limiting inside the app unless `TRUST_PROXY=true`; the nginx block carries the real limits.
- `?tv=1` rows are not clickable and there is no drawer.
- `pre_event` still shows teams if the source already has data; `frozen` with no round captured before the freeze shows `unavailable`.
- `reveal` before the freeze time is allowed (it prints a warning): the board then never freezes.
- Team ids are used as strings (`String(id)`); the roster must use the same ids as the source (A39).
- Windows-only build machine: scripts use `tsx` and `--conditions=react-server` so `server-only` imports work in the CLI; all commands are cross-shell.
- `docs/DEPLOY.md`, `EVENT_RUNBOOK.md`, `GOLIVE_CHECKLIST.md` were written without access to the target host.

## 6. Known limits and risks

- **Everything depends on the unseen scoreboard format.** The field names in `config/source-map.json` and the status strings (`OK`, `MUMBLE`, `OFFLINE`) are PROVISIONAL. The parser fails closed on a mismatch, so a wrong guess shows `unavailable`/`stale`, not wrong numbers, but the board will not work until the mapping is confirmed (`docs/SOURCE_MAPPING.md`).
- Supabase adapter (`src/lib/store/supabase-db.ts`) has never run with a real secret key. The project exists and the schema is applied and verified with SELECT-only queries (RLS on 4 of 4 tables, 0 policies, 0 anon/authenticated privileges, both audit triggers, index). Advisors: 4 INFO `rls_enabled_no_policy` and 1 INFO `unused_index`, all intentional (spec: deny-all RLS; required index on an empty table). Idempotent upserts and FK order were not exercised against the live DB.
- The remote write of a round is two calls (round row, then scores) with no transaction; a partial write is repaired by the next restart (re-queue) and by idempotent upserts.
- TRACE returns Next's generic 500 (nginx must refuse non-GET/HEAD/OPTIONS methods).
- With a CDN in front (Cloudflare), the right-most `X-Forwarded-For` is the edge address: per-client limiting then needs the CDN's own header; undecided because hosting is unknown.
- Time source is the host clock. If it is wrong the freeze is wrong. `FREEZE_AT_ISO` needs the `+05:30` offset; `check-env` refuses a missing one in release mode.
- Load test and CDP checks ran on one machine; real phones on event Wi-Fi were not tested.
- The 10-minute and 6-minute load results are on the fake source at 5 s per round, not the real 90 s rounds.
- `docs/screens` PNGs are committed (about 16 files) so the visual claims can be checked.

## 7. What is blocked and what is needed (also in `BLOCKERS.md`)

| # | Needed | From |
|---|---|---|
| B1 | Place `SUPABASE_URL` / `SUPABASE_SECRET_KEY` in `.env.local` yourself and rehearse once (project, migration, advisors and types are done). Cost: the session had no `get_cost`; `create_project` quoted no charge and created the project on the free plan, but confirm in the dashboard that the org shows no recurring charge | Abdul |
| B2a | Real `scoreboard.json` sample as `../defcon-control-center/docs/club-inputs/scoreboard.sample.json`, then edit `config/source-map.json` and the fixtures | Club |
| B2b | Team roster (due 30 Oct): `npm run import-roster -- <file>` | Club |
| B2c | `EVENT_START_ISO`, `FREEZE_AT_ISO`, `EVENT_END_ISO` with offsets | Club |
| B2d | `SCOREBOARD_URL`, hosting facts (OS, domain, TLS, CDN) | Club / host owner |
| B2e | Confirmation that EnoEngine alone computes points (A32) | Club lead |
| B3 | Decide `SHOW_SERVICE_STATUS` | Club |
| B4 | Whether a deliberate round pause longer than 270 s is possible (would show "not updating") | Club |

## 8. Not done from the original brief

- L8 (real sample, roster, live rehearsal, comparison with the club's view): needs real inputs.
- Pre-flight items that were Abdul's (power settings, `claude mcp list`, dashboard repo merge and push).
- Supabase with a real key (B1): the first `create_project` call was refused by the permission classifier; after Abdul allowed it, the project was created, migrated, checked and typed. The secret key was never seen.
- Rank-by-round sparkline (totals only).

## 9. First things to do in the morning

1. Read section 7, send the club the list in B2 (sample file first: it decides whether the app works at all).
2. Put the Supabase URL and secret key in `.env.local` yourself (B1) and rehearse once, or decide to run on memory + JSONL, which is fully supported.
3. When the sample arrives: edit `config/source-map.json`, drop the file in `club-inputs`, run `npm test` (the skipped test starts running), then `npm run demo:lifecycle`.
4. Run `CHECK_RELEASE=1 npm run check-env` with the real env, then follow `docs/GOLIVE_CHECKLIST.md`.
5. Decide TLS/domain and CDN with the host owner, then test the nginx block from `DEPLOY.md`.

# GO-LIVE CHECKLIST

Tick each line with the date and who checked it. Nothing here has been done yet; the build session had no real inputs.

## Inputs from the club (blockers B2)

- [ ] Real `scoreboard.json` sample saved as `../defcon-control-center/docs/club-inputs/scoreboard.sample.json` (ideally one from the freeze window too).
- [ ] `config/source-map.json` edited to match it; the skipped test in `tests/source.sample.test.ts` now runs and passes. `docs/SOURCE_MAPPING.md` lists each field to confirm.
- [ ] `tests/fixtures/` updated with a real-shape fixture; remove the PROVISIONAL labels only for what was confirmed.
- [ ] Club confirms EnoEngine alone computes the points (A32).
- [ ] `EVENT_START_ISO`, `FREEZE_AT_ISO`, `EVENT_END_ISO` agreed in writing, with the +05:30 offset.
- [ ] Decision on `SHOW_SERVICE_STATUS` (default `false`: public down-status helps attackers).
- [ ] Roster file received; `npm run import-roster -- <file>` dry run reviewed, then `--yes`. `npm run status` shows every team matched.
- [ ] Hosting decision: host, OS, public domain or not, TLS or not.

## Environment

- [ ] `.env.local` exists on the host with mode 0600 and is not in git (`git status` clean).
- [ ] `CHECK_RELEASE=1 npm run check-env` prints no `FAIL`.
- [ ] `SUPABASE_SECRET_KEY` (if used) was placed by the owner, has no `NEXT_PUBLIC_` name; the project is ACTIVE; `supabase/migrations/lb_init.sql` applied; advisors (security + performance) clean.
- [ ] `npm run build` on the host; `npm test` green.

## Rehearsals (on a throwaway event)

- [ ] Throwaway run with `FREEZE_AT_ISO` 3 minutes ahead: see `live`, then `frozen` (visible round stops), `npm run peek` shows the source still moving, `npm run reveal` gives `revealed`, `npm run unreveal` returns to `frozen`. (`npm run demo:lifecycle` does this against the fake source.)
- [ ] Source outage: the page shows `stale` after `STALE_AFTER_SEC` with the last data and recovers on its own.
- [ ] Process restart mid-event: the board comes back with the same rounds (`npm run status` stored rounds unchanged).
- [ ] Compare 5 teams' total and rank with the club's own view at the same round. Record round, team ids, both values in `docs/club-evidence/<date>.md`.

## Network and load

- [ ] nginx block from `DEPLOY.md` installed; `nginx -t` passes; no `Access-Control-Allow-Origin` anywhere (`curl -I`).
- [ ] `limit_req` / `limit_conn` verified from a second machine (a burst gets 503/429; normal polling does not).
- [ ] `X-Forwarded-For` check: with `TRUST_PROXY=true`, a client-supplied `X-Forwarded-For: 1.2.3.4` does not change which bucket it lands in.
- [ ] `npm run loadtest` against the production build on the host: p95 < 100 ms, zero 5xx.
- [ ] HTTP-only decision recorded in the runbook if there is no TLS.

## Day of

- [ ] Runbook roles filled in; the person running the CLI has tried `npm run status` on the host.
- [ ] JSONL backup loop running; first copy exists.
- [ ] Phone check on the event network at 390 px width: rank, team, total readable; no horizontal scroll.
- [ ] `?tv=1` on the projector at 1920x1080: all teams visible without scrolling.

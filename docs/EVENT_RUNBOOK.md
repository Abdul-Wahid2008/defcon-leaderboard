# EVENT RUNBOOK

Commands are run **on the leaderboard host**, in the repo directory, by the person named under "Roles". There is no HTTP admin
surface: if you cannot reach the host, you cannot change the board. Linux commands are marked "verify on the target OS".

## Roles (fill in before the event)

| Role | Name | Contact |
|---|---|---|
| Runs the CLI (freeze / reveal / refresh) | _TBD_ | _TBD_ |
| Club lead (decides reveal time, owns the scoreboard source) | _TBD_ | _TBD_ |
| Host / network owner (nginx, TLS, firewall) | _TBD_ | _TBD_ |
| Supabase owner (only if Supabase is used) | _TBD_ | _TBD_ |

## Start order (T-60 min)

1. Source first: confirm the club's `scoreboard.json` URL answers (`curl -s -o /dev/null -w "%{http_code}\n" <SCOREBOARD_URL>`, verify on the target OS).
2. `CHECK_RELEASE=1 npm run check-env` must print no `FAIL`. Confirm `FREEZE_AT_ISO` is the agreed time **with the correct offset** (IST is `+05:30`).
3. Start the app (systemd: `sudo systemctl start defcon-leaderboard`, verify on the target OS; see `DEPLOY.md`), then nginx.
4. `npm run status`. Expect: a collector heartbeat of a few seconds, `last good fetch` a few seconds ago, `freeze at` set, `revealed false`,
   roster match count equal to the number of teams.
5. Open the public address on a phone on the event network. State should be `pre_event` or `live`, never `unavailable`.
6. Start the JSONL backup loop (below).

## During the event

- `npm run status` any time. It reads local files only and shows what **the public** sees (`state`), not the raw source.
- Force a pull: `npm run refresh` (the running server pulls within ~2 s).
- Look at the live top 10 while the board is frozen: `npm run peek`. It prints to your terminal and serves nothing. Do not paste it anywhere public.

### Freeze (automatic)

At `FREEZE_AT_ISO` the server stops serving anything captured later, by itself. Nothing to run. Check with `npm run status`:
`state frozen`, `visible round` stops advancing while `stored rounds` keeps growing.

### Reveal (final results)

1. Club lead says "reveal".
2. `npm run reveal` and type the event slug when asked (or `npm run reveal -- --slug <slug>`). A wrong slug changes nothing.
3. Clear the nginx cache (`DEPLOY.md`, verify on the target OS). Within about 5 s the public state becomes `revealed` with the newest round. Check on a phone.
4. To undo (revealed too early): `npm run unreveal`. The board returns to the frozen round.

### What to tell participants

| Situation | Public state | Say |
|---|---|---|
| Source down or not updating | `stale` | "Scores are not updating right now. The numbers shown are the last ones received; the organisers are checking." |
| Frozen | `frozen` | "Scores are frozen. Final results will be announced." |
| Nothing yet | `unavailable` | "The scoreboard is not available yet." Check `npm run status` for the last error code. |
| Page unreachable | (browser error) | Switch to the fallback below and announce the final standings from `npm run peek`. |

Never tell participants a number that the page does not show while the board is frozen.

## Backups

JSONL is append-only; a plain copy is a safe backup (verify on the target OS):

```
# every 5 minutes, keep a rolling copy next to the data (Linux)
while true; do cp data/snapshots.jsonl "data/backup-$(date +%H%M).jsonl"; sleep 300; done
```
Copy `data/` off the host after the event. `data/` is git-ignored.

## Fallback if the Node process dies

1. `sudo systemctl status defcon-leaderboard` / `journalctl -u defcon-leaderboard -n 50` (verify on the target OS). `Restart=always` should bring it back; history is rebuilt from `data/snapshots.jsonl` on start.
2. If it will not start: `npm run snapshot` writes `data/static/final.json` and `final.html` for **exactly what the public currently sees** (frozen stays frozen). Serve `final.html` from nginx (the commented `location` in `DEPLOY.md`).
3. Run `snapshot` once after reveal too, as the permanent record.
4. Backups: run the loop below under `nohup`, `tmux` or a systemd timer (verify on the target OS) so it survives the terminal closing.

## Rollback

Tag the last good commit before the event (`lb-L7` or later). To roll back (verify on the target OS): `git checkout <tag>`, `npm ci`, `npm run build`, restart the service. `data/` is untouched by a rollback.

## Supabase (only if configured)

- Check the project is **ACTIVE** (dashboard) the day before: free projects pause when idle. A paused project does not break the board (memory + JSONL keep working); `npm run status` shows `history store supabase down` and the number of rounds waiting to be pushed.
- If it was down, the pending rounds are pushed automatically on the next successful save. Confirm `0 round(s) not yet pushed` before the event ends.

## Health checks

- `GET /api/healthz` returns `{"ok":true}` (liveness only; it does not check the source).
- `GET /api/board` `meta.state` is the truth the public sees.
- `npm run status` is the truth the host sees (heartbeat age, last error code, store health).

## Escalation

| Symptom | First action | Escalate to |
|---|---|---|
| `stale` for more than 5 min | `npm run status` for the error code; `npm run refresh`; ask the club whether `scoreboard.json` is being written | Club lead |
| `SOURCE_SHAPE_UNKNOWN` | The source format changed. Do not edit live. Tell the developer; the board keeps the last good data | Developer (_TBD_) |
| `host_not_allowed` / `not_configured` | Fix `SCOREBOARD_URL` / `SCOREBOARD_ALLOWED_HOSTS`, restart | Host owner |
| `round_backwards` | The source went back in time (restart or stale mirror). The board ignores it. Ask the club | Club lead |
| Wrong rank suspected | Compare `npm run peek` with the club's own view for 3 teams at the same round. If they differ, stop and tell the club lead; do not "fix" numbers here | Club lead + developer |
| Suspected leak of frozen data | `npm run unreveal` (no-op if not revealed), then `npm run status`; check nginx cache is not serving an old body | Developer |

# OVERNIGHT LOG

Append after every slice: time, slice, commit hash, gate results, decisions made, anything skipped.

## L0 — Scaffold and gates (29 Oct 2026)
- Gates: typecheck 0 · lint 0 errors · vitest 34/34 in 3 files (config, check-env, headers/proxy) · `next build` 0 · production server on 127.0.0.1:3200.
- Verified live: `/api/healthz` 200 `{"ok":true}` no-store; home page carries a fresh CSP nonce and Next stamps it on every script tag; malformed percent path -> 400; no CORS, no cookies, no HSTS, no X-Powered-By.
- `check-env`: fails (exit 1) on missing FREEZE_AT_ISO/EVENT_SLUG/SCOREBOARD_URL, non-loopback HOSTNAME and a NEXT_PUBLIC_ credential; passes a correct release env (exit 0). Prints names only.
- Decisions: relative imports in `src/lib` so tsx scripts need no path alias; `vitest.config.mts` (CJS config warning); `vite` added as a devDependency because vitest 5 needs it as a peer (same as the dashboard); npm scripts for later slices (status, peek, reveal, ...) are added by the slice that creates the script, not as dead stubs; `npm install --ignore-scripts --legacy-peer-deps` (no native deps here).
- Skipped: pre-flight items that belong to Abdul (powercfg, pushes, `claude mcp list`). Nothing was pushed.

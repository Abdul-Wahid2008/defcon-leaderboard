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

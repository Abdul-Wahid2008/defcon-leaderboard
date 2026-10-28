# CLAUDE.md — DEFCON Leaderboard (repo rules)

> Also provided as `AGENTS.md` for other coding tools. Keep the two identical.

## STATUS (update at the end of every work session)
- Date/slice: 29 Oct 2026 — L0 scaffold in progress. See `docs/OVERNIGHT_LOG.md` and `BLOCKERS.md`.
- Inputs still missing from the club: real `scoreboard.json` sample, team roster (due 30 Oct), event start/freeze/end times, hosting/TLS facts, confirmation that EnoEngine alone computes scores (A32).

## What this is
Public, participant-facing leaderboard for DEFCON 2.0 (4-hour attack-defense CTF, Technozion, NIT Warangal). It **displays** the scores EnoEngine computes; it never computes points. Public internet, at most 30 teams, at most 300 concurrent viewers, many on phones. A wrong rank, a leaked frozen score or a dead page is publicly visible: correctness and honesty beat features.

Reference spec (authoritative): `../defcon-control-center/docs/defcon-control-center/16_LEADERBOARD_SPEC_AND_PROMPTS.md` (decisions D25–D36, contract, Supabase rules, checklist P1–P14).

## Rules
- Stack: Next.js 16 App Router, TypeScript strict, Tailwind v4, Vitest, zod, `@supabase/supabase-js` (server-only, lazy). System font stacks only; no external requests at runtime. No UI kit, chart library or state library without a one-line justification in the commit.
- Config is lazy and fail-closed (`getConfig()` inside handlers, never at import time). A missing env must never produce a bare 500. Every route wraps errors into minimal JSON (no stack traces, no hostnames, no upstream URLs).
- No HTTP admin surface (D27). Reveal/unreveal/refresh/status are host-side CLI commands writing `data/control.json`.
- Freeze is enforced server-side (D28): nothing captured after `FREEZE_AT_ISO` appears in any API body, history point or HTML until revealed.
- Never fake liveness: `stale` and `unavailable` are explicit states.
- Unknown scoreboard shape fails closed (`SOURCE_SHAPE_UNKNOWN`), never healthy, never a guessed total. Do not invent scoreboard fields, verdict strings or club endpoints; fixtures are labelled PROVISIONAL.
- Contract is additive-only once published. No cookies, no CORS headers.
- Secrets: never print, log or commit `.env*` or `data/`. Supabase secret key never uses a `NEXT_PUBLIC_` name.
- Commits: `feat(scope): …`, `fix(scope): …`, `test(scope): …`, `docs: …`. Commit to main only when typecheck, lint (0 errors), tests and build are green.
- Ports: 3200 (start), 3201 (dev), 3290 (fake scoreboard), 9333 (Chrome debugging). Never 3000 or 3100.
- Windows machine: scripts must be cross-shell.

## UI bar
Restrained and high-contrast: one accent colour, hairline borders, tabular numerals, five-size type scale, 16 px icons, no gradients/glow/emoji/marketing words (banned: seamless, powerful, elevate, effortless, robust, leverage, journey, blazing, cutting-edge). Works at 1920×1080 (`?tv=1`: 30 teams without scrolling), 1440, 1280, 1024 and 390 px. No horizontal clipping, no layout shift on updates, WCAG 2.1 AA, semantic table, keyboard operable, `prefers-reduced-motion` respected.

## Commands
`npm run dev` (3201) · `npm run build && npm start` (127.0.0.1:3200) · `npm run typecheck` · `npm run lint` · `npm test` · `npm run check-env`

# SECURITY PASS (L5)

Run on 29 Oct 2026 against the **production build** (`next build && next start -H 127.0.0.1 -p 3200`) with the **fake** source on
3290. Reproduce with `npm run build && npm run attack` (about 4 minutes; it starts and kills its own processes and rewrites
`tmp/attack-results.md`). Nothing was tested against a real scoreboard, real nginx or a public network.

## Result

81 attempts, 0 failed on the final run. Two real defects were found on the first run and fixed; one framework behaviour is accepted
and mitigated outside the app.

| Found | Fix |
|---|---|
| `GET /api/history?top=０５` made the test client throw (not a server bug); the server returns 400. | Test now sends the percent-encoded form. |
| `__proto__` as a history query key returned 200. | Next.js drops that key before the handler sees it, so it is ignored and the body is identical to the plain request. The handler also rejects any key other than `top` by name (zod strict mode skips `__proto__`). |
| `TRACE` returns a generic `500 Internal Server Error` (body is exactly that text, no stack or path). | Accepted: Next builds a fetch `Request` from the incoming method and TRACE is forbidden there, so it fails before any app code. `docs/DEPLOY.md` makes nginx return 405 for every method except GET/HEAD/OPTIONS. |

Earlier, from the L3 review (fixed before the attack pass): one shared limiter bucket could lock every viewer out (now no limiting
without a trustworthy client key; nginx is the limiter), a failing store no longer looks live, `unreveal` takes effect immediately
(the cache key includes the reveal flag), roster import is atomic.

## What was NOT tested

- Real nginx behaviour (rate limits, caching, TRACE refusal): config is in `DEPLOY.md`, unverified.
- TLS, HSTS, a public domain, a CDN in front (Cloudflare would make the right-most `X-Forwarded-For` entry the edge address).
- The real scoreboard format and any hostile content the real engine could emit beyond the fake's hostile mode.
- Supabase (no project, no key): the adapter is untested against a live database.
- Windows-host deployment.

## `npm audit --omit=dev`

`found 0 vulnerabilities` (29 Oct 2026, registry state at that time). No forced upgrades.

## Load (`npm run loadtest`)

300 board viewers (10 s +-20% jitter) + 30 history viewers, fake source at 5 s per round, `POLL_SEC=15`, production build, same machine.

| Run | Requests | p50 / p95 / p99 | 5xx | RSS | Upstream pulls per POLL_SEC | Store writes |
|---|---|---|---|---|---|---|
| 10 min | 19 801 (33/s), all 200 | 2.6 / 5.7 / 18.9 ms | 0 | cold 113 MB, warmed-up (minute 3) 220 MB, end 227 MB (+3%) | 1.00 | 41 lines, 0 duplicates |
| 6 min (after review fixes) | 11 878, all 200 | 3.0 / 5.9 / 16.8 ms | 0 | cold 112, warmed-up 218, end 220 (+0.7%) | 1.00 | 26 lines, 0 duplicates |

The first 10-minute run reported FAIL on "RSS growth < 15%" because it compared against the cold process (113 MB) taken before any
traffic. The memory plateaued from minute 3 (220 to 227 MB over seven minutes), so the check was changed to compare against the
warmed-up baseline and to print the cold figure; the 6-minute run is the first with the corrected check. The client and the server
share one machine, so the latency numbers are optimistic compared with a real network.

## Attempts

| # | Attempt | Result | Verdict |
|---|---|---|---|
| A1 | GET /api/history?top=NaN | 400 {"error":"bad_request"} | held |
| A1 | GET /api/history?top=-1 | 400 {"error":"bad_request"} | held |
| A1 | GET /api/history?top=1e9 | 400 {"error":"bad_request"} | held |
| A1 | GET /api/history?top=0 | 400 {"error":"bad_request"} | held |
| A1 | GET /api/history?top=31 | 400 {"error":"bad_request"} | held |
| A1 | GET /api/history?top=abc | 400 {"error":"bad_request"} | held |
| A1 | GET /api/history?top=1.5 | 400 {"error":"bad_request"} | held |
| A1 | GET /api/history?top=%00 | 400 {"error":"bad_request"} | held |
| A1 | GET /api/history?top= | 400 {"error":"bad_request"} | held |
| A1 | GET /api/history?top=10%27 | 400 {"error":"bad_request"} | held |
| A1 | GET /api/history?top=99999999999999999999 | 400 {"error":"bad_request"} | held |
| A1 | GET /api/history?top=%EF%BC%90%EF%BC%95 | 400 {"error":"bad_request"} | held |
| A2 | GET /api/history?round=9 | 400 | held |
| A2 | GET /api/history?t=1 | 400 | held |
| A2 | GET /api/history?__proto__=1 | 200 (key dropped by the framework, body identical to no query) | held |
| A2 | GET /api/history?constructor[prototype]=x | 400 | held |
| A2 | GET /api/history?top=3&top=4 | 400 | held |
| A2 | GET /api/history?top=3&x=1 | 400 | held |
| A2 | GET /api/history?at=1 | 400 | held |
| A3 | GET /api/board?round=1&t=1&__proto__=x (board ignores the query) | 200 round 2 | held |
| A4 | POST /api/board | 405 | held |
| A4 | PUT /api/board | 405 | held |
| A4 | PATCH /api/board | 405 | held |
| A4 | DELETE /api/board | 405 | held |
| A4 | OPTIONS /api/board | 204 | held |
| A4 | TRACE /api/board | 500 | held |
| A4 | CONNECT /api/board | -1 (connection refused by server) | held |
| A4 | PROPFIND /api/board | 405 | held |
| A5 | HEAD /api/board has headers and no body | 200 | held |
| A6 | GET /api/../.env | 404 | held |
| A6 | GET /..%2f..%2fpackage.json | 404 | held |
| A6 | GET /%2e%2e/%2e%2e/.env.local | 404 | held |
| A6 | GET /api/%2e%2e/%2e%2e/.env | 404 | held |
| A6 | GET /_next/../.env | 404 | held |
| A6 | GET /%252e%252e/%252e%252e/.env | 404 | held |
| A6 | GET /api/board/..;/..;/.env | 404 | held |
| A6 | GET /.env | 404 | held |
| A6 | GET /data/control.json | 404 | held |
| A6 | GET /package.json | 404 | held |
| A6 | GET /src/lib/config.ts | 404 | held |
| A6 | GET /config/source-map.json | 404 | held |
| A6 | GET /%00 | 404 | held |
| A6 | GET /api/% | 400 | held |
| A7 | GET with a 100 KB path | -1 | held |
| A7 | GET /api/board with a 100 KB header | -1 | held |
| A7 | GET /api/board with 5000 headers | 431 | held |
| A8 | 600 parallel connections to /api/healthz, then the board still answers | 600/600 ok, board 200 | held |
| A8b | slowloris: 50 sockets sending one header byte per second for 5 s; board still answers | board 200 with 50 stalled sockets (a reverse proxy timeout is the real defence: DEPLOY.md) | held |
| A9 | GET /api/board with Host: evil.example | 200, echoed=false | held |
| A9 | GET /api/board with X-Forwarded-Host: evil.example | 200, echoed=false | held |
| A9 | GET /api/board with X-Forwarded-Proto: https://evil.example | 200, echoed=false | held |
| A9 | GET /api/board with X-Original-URL: /api/admin | 200, echoed=false | held |
| A9 | GET /api/board with X-Rewrite-URL: /.env | 200, echoed=false | held |
| A9 | GET /api/board with X-HTTP-Method-Override: DELETE | 200, echoed=false | held |
| A10 | Range: bytes=0-10 on /api/board | 200, body 3724 bytes | held |
| A11 | no Set-Cookie and no CORS headers on / , /api/board , /api/history , /api/healthz , a 404 | none | held |
| A12 | security headers on / and /api/board; CSP nonce differs per request | nonce NjBkOW.. vs YzJiND.., missing [] | held |
| A13 | Cache-Control: public max-age=2 only on board/history; no-store elsewhere | public, max-age=2 \| public, max-age=2 \| no-store \| no-store | held |
| A14 | .next/static has no source maps, and /_next/static/*.map is not served | 0 map files, map URL 404, secret strings false | held |
| A15 | HTTP request smuggling shapes (CL+TE, duplicate CL) do not crash the server | healthz 200 afterwards | held |
| A16 | hostile team names (script tag, RTL override, zero-width, 300 chars, __proto__) via the source | 30 teams, 0 names with control/bidi/over-length, raw <script> in HTML: false | held |
| A17 | source mode "huge": previous data kept, no 5xx, no leak, server up | 200, state live, round 12 | held |
| A17 | source mode "redirect": previous data kept, no 5xx, no leak, server up | 200, state live, round 12 | held |
| A17 | source mode "garbage": previous data kept, no 5xx, no leak, server up | 200, state live, round 12 | held |
| A17 | source mode "500": previous data kept, no 5xx, no leak, server up | 200, state stale, round 12 | held |
| A17 | source mode "dupkeys": previous data kept, no 5xx, no leak, server up | 200, state stale, round 12 | held |
| A17 | source mode "timeout": previous data kept, no 5xx, no leak, server up | 200, state stale, round 12 | held |
| B1 | TRUST_PROXY=true: spoofed LEFT X-Forwarded-For entries do not dodge the limit (right-most is the key) | 30/60 limited for one real client; another client 200 | held |
| B2 | TRUST_PROXY=true: a flood of distinct valid addresses cannot lock out a new client | new client 200 | held |
| C0 | precondition: board is frozen and the source is ahead | state frozen, frozen round 108, source round 114 | held |
| C1 | frozen: GET /api/board  | 200, max round 108 (frozen 108), later total present: false | held |
| C1 | frozen: GET /api/board?round=999  | 200, max round 108 (frozen 108), later total present: false | held |
| C1 | frozen: GET /api/board?t=9999999999999&at=now  | 200, max round 108 (frozen 108), later total present: false | held |
| C1 | frozen: GET /api/history?top=30  | 200, max round 108 (frozen 108), later total present: false | held |
| C1 | frozen: GET /  | 200, max round 108 (frozen 108), later total present: false | held |
| C1 | frozen: GET /?round=999&reveal=1&revealed=true  | 200, max round 108 (frozen 108), later total present: false | held |
| C1 | frozen: GET /api/board X-Reveal,Cookie,Authorization | 200, max round 108 (frozen 108), later total present: false | held |
| C1 | frozen: GET /api/board If-None-Match | 200, max round 108 (frozen 108), later total present: false | held |
| C1 | frozen: GET /api/board Cache-Control,Pragma | 200, max round 108 (frozen 108), later total present: false | held |
| C1 | frozen: GET /api/board X-Forwarded-For | 200, max round 108 (frozen 108), later total present: false | held |
| C2 | unreveal/reveal files cannot be influenced over HTTP: POST/PUT /api/reveal, /api/admin/reveal, /reveal | codes 400,405, state frozen | held |

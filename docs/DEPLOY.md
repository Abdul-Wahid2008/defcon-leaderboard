# DEPLOY

Nothing here has been applied or executed by the build session. **Every command is marked "verify on the target OS"**: the
event host is assumed to be Linux (the club's draft says `/home/ubuntu`), which is itself UNCONFIRMED. Confirm the OS, the
Node version (`>=20.12`, see `package.json`) and whether the host has a public domain and TLS before using any of it.

## Shape

```
participants -> nginx (public listener, TLS if available) -> 127.0.0.1:3200 (next start, ONE process)
                                                              |-> EnoEngine scoreboard.json (club-owned, pulled server-side)
                                                              |-> data/ (control.json, snapshots.jsonl, roster.json, audit.log)
```

- Run exactly **one** Node process. The collector, the in-process cache and the rate limiter are per process; two
  processes would double the upstream pulls and split the limiter.
- The Node server binds `127.0.0.1` only (`npm start` hardcodes `-H 127.0.0.1 -p 3200`). nginx is the public listener.
- Set `TRUST_PROXY=true` **only** when nginx sets `X-Forwarded-For` (below). Then the app limits per right-most entry
  (`RATE_LIMIT_PER_MIN`, a backstop behind nginx). With `TRUST_PROXY=false` the app does **no** limiting at all (a shared bucket
  would let one client lock everyone out); nginx's `limit_req` is then the only limiter.

## Environment (`.env.local`, mode 0600, never committed)

Copy `.env.example`. Minimum for a release: `SCOREBOARD_URL`, `EVENT_SLUG`, `FREEZE_AT_ISO` (mandatory, D34), `EVENT_START_ISO`,
`EVENT_END_ISO`, `TRUST_PROXY`. Then run `CHECK_RELEASE=1 npm run check-env` and fix every `FAIL` line.
`SUPABASE_URL` / `SUPABASE_SECRET_KEY` are optional (memory + `data/snapshots.jsonl` work without them). The secret key never
takes a `NEXT_PUBLIC_` name; `check-env` refuses that.

## Build and run (verify on the target OS)

```
npm ci
npm run build
npm start            # 127.0.0.1:3200
```

## systemd (verify on the target OS)

`/etc/systemd/system/defcon-leaderboard.service`:

```
[Unit]
Description=DEFCON leaderboard
After=network-online.target
Wants=network-online.target

[Service]
User=leaderboard
WorkingDirectory=/opt/defcon-leaderboard
EnvironmentFile=/opt/defcon-leaderboard/.env.local
Environment=NODE_ENV=production
# The next launcher starts with `#!/usr/bin/env node`, so node must be on the service's PATH (check `which node`; with nvm or
# NodeSource it is not always /usr/bin). Add e.g. Environment=PATH=/usr/local/bin:/usr/bin if needed.
ExecStart=/opt/defcon-leaderboard/node_modules/.bin/next start -H 127.0.0.1 -p 3200
Restart=always
RestartSec=2
# Hardening, all optional:
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

```
sudo chmod 600 /opt/defcon-leaderboard/.env.local
sudo systemctl daemon-reload && sudo systemctl enable --now defcon-leaderboard
journalctl -u defcon-leaderboard -f
```

`npm ci` creates `node_modules/.bin/next`; if it is missing on the host, use `ExecStart=/usr/bin/node /opt/defcon-leaderboard/node_modules/next/dist/bin/next start -H 127.0.0.1 -p 3200` (verify the node path).

## nginx (verify on the target OS)

```nginx
# http{} level
# An event network is often NAT'd: 300 viewers polling every 10 s are about 30 requests/s from ONE address, so these limits are
# sized for that. Tighten them only after you know whether clients arrive with distinct addresses.
limit_req_zone  $binary_remote_addr zone=lb_req:10m rate=60r/s;
limit_req_status 429;
limit_conn_zone $binary_remote_addr zone=lb_conn:10m;
proxy_cache_path /var/cache/nginx/lb levels=1:2 keys_zone=lb_cache:5m max_size=20m inactive=1m use_temp_path=off;

server {
    listen 80;                      # add `listen 443 ssl;` + certificates when TLS exists
    server_name _;                  # replace with the real name

    # Public and read-only. Next.js answers TRACE with a generic 500 before the app sees it, so refuse other methods here.
    if ($request_method !~ ^(GET|HEAD|OPTIONS)$) { add_header Allow "GET, HEAD, OPTIONS" always; return 405; }

    # Slowloris and oversize requests (P14)
    client_header_timeout 10s;
    client_body_timeout   10s;
    send_timeout          15s;
    keepalive_timeout     15s;
    client_max_body_size  1k;
    large_client_header_buffers 4 8k;
    limit_conn lb_conn 300;

    gzip on;
    gzip_types application/json text/css application/javascript image/svg+xml;
    gzip_min_length 512;

    # X-Robots-Tag: noindex is already sent by the app; do not add it again here (a second header is harmless but untidy).
    # Do NOT add Access-Control-Allow-Origin. The app is same-origin only.
    # HSTS ONLY when the site is served over HTTPS (and you are sure):
    #   add_header Strict-Transport-Security "max-age=31536000" always;

    # 2 s micro-cache for the two public JSON routes. Cookies never take part in the key.
    location ~ ^/api/(board|history)$ {
        limit_req zone=lb_req burst=200 nodelay;
        proxy_pass http://127.0.0.1:3200;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;   # overwrite, never append a client-supplied value
        proxy_set_header Cookie "";                       # the app never reads cookies; none reach it or the cache key
        proxy_cache lb_cache;
        # Deliberately only `top` is in the key: other query parameters are ignored by the board and rejected by history, so a
        # junk parameter cannot create new cache entries (it is served the cached answer instead of the app's 400).
        proxy_cache_key "$scheme$request_method$uri$arg_top";
        proxy_cache_valid 200 2s;
        proxy_cache_lock on;
        # `updating` only. Do NOT add `error` or `timeout`: with Node down they would keep serving an old body that says "live".
        proxy_cache_use_stale updating;
        proxy_ignore_headers Set-Cookie;
        proxy_hide_header Set-Cookie;
        proxy_read_timeout 10s;
    }

    location / {
        limit_req zone=lb_req burst=200 nodelay;
        proxy_pass http://127.0.0.1:3200;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header Cookie "";
        proxy_read_timeout 10s;
    }

    # Optional last resort if the Node process dies. `npm run snapshot` writes data/static/final.html, but data/ is user-only,
    # so copy it to a directory the nginx user can read (for example /var/www/lb/final.html) and enable:
    # error_page 502 503 504 =200 /final.html;
    # location = /final.html { root /var/www/lb; internal; }
}
```

Notes:
- `proxy_set_header X-Forwarded-For $remote_addr;` (not `$proxy_add_x_forwarded_for`) means the app's right-most entry is the
  address nginx saw, and a client cannot prepend a fake one that survives.
- The app already sends `Cache-Control: public, max-age=2` and an `ETag` on the two JSON routes. The nginx cache honours that;
  the 2 s `proxy_cache_valid` is the fallback. With the cache in front the app sees about one request per 2 s per route and
  `top` value; its own 3 s response cache then makes the real work about one build per 3 s.
- **After `reveal` or `unreveal`** clear the nginx cache (`sudo rm -rf /var/cache/nginx/lb/*`, verify on the target OS) or wait 3 s, so a
  stale body cannot outlive the change.
- The error body for a limited request is nginx's own 429 page, not the app's JSON.
- Test the limits before the event (`GOLIVE_CHECKLIST.md`): `ab`/`hey` against the nginx address and confirm 429 appears
  above the configured rate and that `/api/board` still answers normally from another address.
- Confirm through nginx: `curl -i -X TRACE http://<host>/api/board` returns 405 (not the app's generic 500), and no response carries `Set-Cookie`.

## Without a domain or TLS

If the club has neither, serve plain HTTP on the event network: keep the nginx block above, drop the 443/HSTS lines, and say
so in the runbook ("this page is served over HTTP; anyone on the network can read or alter it in transit"). Nothing secret
is on the page, but a network attacker could alter what participants see. Use the club's network isolation if available.

## Windows alternative (verify on the target OS)

The build machine is Windows; the event host may not be. If it is Windows, either:
- **pm2**: `npm i -g pm2` (global install is a decision for the host owner), then
  `pm2 start node_modules/next/dist/bin/next --name lb -- start -H 127.0.0.1 -p 3200`, `pm2 save`, and a pm2 startup task; or
- **Task Scheduler**: an "At startup" task running `node.exe` with arguments
  `node_modules\next\dist\bin\next start -H 127.0.0.1 -p 3200`, working directory the repo, "restart on failure" enabled.

Environment variables come from `.env.local` (Next reads it) in both cases. Put a reverse proxy in front (nginx for Windows, IIS ARR or Caddy) with the same limits.

## Data directory

`data/` holds `control.json`, `snapshots.jsonl`, `roster.json`, `runtime.json` (CLI heartbeat), `audit.log`, `static/`. It is git-ignored,
created user-only where the OS allows, and must be on the same host as the Node process (the CLI reads it). Back up
`snapshots.jsonl` with a plain copy (see `EVENT_RUNBOOK.md`).

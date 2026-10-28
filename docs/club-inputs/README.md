# Club inputs

Drop the real files here. Nothing in this folder may contain secrets.

| File | What it is | Status |
|---|---|---|
| `scoreboard.sample.json` | A real `scoreboard.json` copied from the club's EnoEngine host (any round, ideally mid-event so statuses are varied) | MISSING |
| `roster.csv` / `roster.json` | Registered teams: engine team id and display name only | MISSING (due 30 Oct) |

When `scoreboard.sample.json` exists, `npm test` parses it with `config/source-map.json` and fails if the mapping does not fit. See `docs/SOURCE_MAPPING.md`.

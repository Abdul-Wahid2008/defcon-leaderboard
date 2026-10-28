# Source mapping: what to confirm when the real scoreboard.json arrives

**Status: PROVISIONAL.** No real sample has been seen. `config/source-map.json` and `tests/fixtures/provisional-scoreboard.json` use EnoEngine-style names from general knowledge; they prove nothing about the club's file. The parser fails closed (`SOURCE_SHAPE_UNKNOWN`) on anything that does not fit, so a wrong mapping shows as "unavailable", never as wrong scores.

## Steps
1. Copy the real file to `docs/club-inputs/scoreboard.sample.json`.
2. Run `npm test`. `tests/source.sample.test.ts` parses it with the current mapping. A failure means the mapping needs editing; the parser code does not.
3. Edit `config/source-map.json` (paths are dotted, own properties only, array indices are numbers):

| Key in source-map.json | Confirm in the real file | Notes |
|---|---|---|
| `teamsPath` | Where the array of teams lives | Root-relative. Must be a non-empty array (max 200). |
| `round` | Current round number | Must be a non-negative integer. A string is rejected. |
| `timestamp` | Optional: a date string for the snapshot | Display only; the freeze uses our own capture clock. Remove the key if absent. |
| `team.id` | The team identifier | A safe integer or a short printable string. Must equal the id in the roster (A39, UNCONFIRMED). |
| `team.name` | Team name | Sanitised (control, bidi, zero-width removed; 40 chars). |
| `team.total` | Total points | A finite number, 0 or more. EnoEngine computes it; we never sum components. |
| `team.attack`, `team.defense`, `team.sla` | Optional per-category points | Remove the key if the file has none. If the key is mapped and the value is present but not a number, the snapshot is rejected. |
| `services.path`, `.key`, `.status` | Optional per-service status list on each team | Used only when `SHOW_SERVICE_STATUS=true`. |
| `services.statusMap` | The exact status strings the checker writes | A string not listed becomes `unknown`, never `ok`. Confirm the real verdict names with the club. |

4. Replace the fixture with a trimmed copy of the real file (names scrubbed) and update `tests/source.parse.test.ts` mutations if field names changed.
5. `SCOREBOARD_URL` must serve `application/json` (or `+json`/`text/json`). A different content type is rejected as `bad_content_type`.

## Rules the parser enforces
- **A key you map is required.** If `attack`, `defense`, `sla`, `timestamp` or `services` is mapped and a team (or the document) lacks it, the whole snapshot is rejected: a missing field is schema drift, not "no data". Delete the key from the map to stop reading it.
- Path segments may contain letters, digits, `_` and `-`. A source key containing a dot or a space cannot be addressed; that needs a code change (tell Abdul).
- `timestamp` must be ISO-8601 with an offset; it is stored as UTC ISO.
- A total must be finite, 0 or more and below 1e11. Ranking compares totals at 3 decimals (the precision the history store keeps).

## Questions for the club
- Is the file frozen in the last 30 minutes (then the leaderboard shows stale data)? Is there an unfrozen source we may read?
- Are the totals computed by EnoEngine only (A32)? Do any other points (bonuses, manual adjustments) exist outside the file?
- Is the team id in the file the same id used at registration (A39)?

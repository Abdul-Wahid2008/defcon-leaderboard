import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);

/** Dotted path of own properties, e.g. `teams` or `scores.total`. Array indices are plain numbers (`0`). */
const jsonPath = z
  .string()
  .regex(/^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$/, 'must be a dotted path of letters, digits, underscores and hyphens')
  .refine((p) => !p.split('.').some((s) => FORBIDDEN.has(s)), 'forbidden path segment');

const status = z.enum(['ok', 'mumble', 'offline', 'unknown']);

/**
 * Where each value lives in the source file. Adapting to the club's real scoreboard.json means editing
 * config/source-map.json (and the fixture), not code. Paths under `team` and `services` are relative to one team /
 * one service entry; `teamsPath`, `round` and `timestamp` are relative to the document root.
 */
export const sourceMapSchema = z.strictObject({
  _note: z.string().optional(),
  teamsPath: jsonPath,
  round: jsonPath,
  timestamp: jsonPath.optional(),
  team: z.strictObject({
    id: jsonPath,
    name: jsonPath,
    total: jsonPath,
    attack: jsonPath.optional(),
    defense: jsonPath.optional(),
    sla: jsonPath.optional(),
  }),
  services: z
    .strictObject({
      path: jsonPath,
      key: jsonPath,
      status: jsonPath,
      /** Source status string -> our status. A value not listed here becomes `unknown`, never `ok`. */
      statusMap: z.record(z.string().max(40), status),
    })
    .optional(),
});

export type SourceMap = z.infer<typeof sourceMapSchema>;

export function parseSourceMap(raw: unknown): SourceMap {
  return sourceMapSchema.parse(raw);
}

/** Reads config/source-map.json from the project root (process.cwd()). Throws a ZodError / ENOENT on a bad file. */
export function loadSourceMap(file = path.resolve(process.cwd(), 'config', 'source-map.json')): SourceMap {
  return parseSourceMap(JSON.parse(fs.readFileSync(file, 'utf8')));
}

import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

/** data/control.json is the only way to change what the public sees (D27). The CLI writes it; the server only reads it. */
const schema = z.object({
  revealed: z.boolean(),
  updatedAt: z.string().optional(),
  refreshRequestedAt: z.string().optional(),
});
export type Control = z.infer<typeof schema>;

/** Missing, unreadable or corrupt means "not revealed": a broken file must never open a freeze. */
export const DEFAULT_CONTROL: Control = { revealed: false };

export const controlPath = (dataDir: string) => path.resolve(dataDir, 'control.json');

export function readControl(dataDir: string): Control {
  try {
    const f = controlPath(dataDir);
    if (fs.statSync(f).size > 4096) return DEFAULT_CONTROL;
    const r = schema.safeParse(JSON.parse(fs.readFileSync(f, 'utf8')));
    return r.success ? r.data : DEFAULT_CONTROL;
  } catch {
    return DEFAULT_CONTROL;
  }
}

/** Atomic replace so a reader never sees half a file. */
export function writeControl(dataDir: string, c: Control): void {
  fs.mkdirSync(dataDir, { recursive: true });
  const f = controlPath(dataDir);
  const tmp = `${f}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(c, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, f);
}

/** Re-reads at most every `ttlMs` (default 5 s). `force()` is for the collector tick. */
export function cachedControl(dataDir: string, now: () => number = Date.now, ttlMs = 5000) {
  let at = -Infinity;
  let value = DEFAULT_CONTROL;
  const load = () => {
    value = readControl(dataDir);
    at = now();
    return value;
  };
  return { get: () => (now() - at >= ttlMs ? load() : value), force: load };
}

export function appendAudit(dataDir: string, entry: Record<string, unknown>): void {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.appendFileSync(path.resolve(dataDir, 'audit.log'), JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n', { mode: 0o600 });
}

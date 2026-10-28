import fs from 'node:fs';
import path from 'node:path';
import { checkEnv } from '../src/lib/check-env';

// Merge .env.local / .env (if present) under real environment variables, like Next does. Values are never printed.
function loadDotenv(file: string, into: Record<string, string | undefined>) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || m[1].startsWith('#')) continue;
    if (into[m[1]] === undefined) into[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

const env: Record<string, string | undefined> = { ...process.env };
for (const f of ['.env.local', '.env']) loadDotenv(path.resolve(process.cwd(), f), env);

const r = checkEnv(env);
for (const w of r.warnings) console.log(`warn  ${w}`);
for (const e of r.errors) console.log(`FAIL  ${e}`);
console.log(r.ok ? 'check-env: ok' : `check-env: ${r.errors.length} problem(s)`);
process.exit(r.ok ? 0 : 1);

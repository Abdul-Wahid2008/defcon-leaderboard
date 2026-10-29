import { checkEnv } from '../src/lib/check-env';
import { loadEnv } from './env';

const env = loadEnv();

const r = checkEnv(env);
for (const w of r.warnings) console.log(`warn  ${w}`);
for (const e of r.errors) console.log(`FAIL  ${e}`);
console.log(r.ok ? 'check-env: ok' : `check-env: ${r.errors.length} problem(s)`);
process.exit(r.ok ? 0 : 1);

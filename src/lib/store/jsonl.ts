import 'server-only';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { EventMeta, Snapshot, SnapshotStore } from './types';

/** Reads one JSONL file. A line that does not parse (a truncated last write after a crash) is skipped. */
export async function readJsonl(file: string): Promise<Snapshot[]> {
  let text: string;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw e;
  }
  const byRound = new Map<number, Snapshot>();
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const s = JSON.parse(line) as Snapshot;
      if (Number.isInteger(s.round) && typeof s.capturedAt === 'string' && Array.isArray(s.teams) && !byRound.has(s.round)) byRound.set(s.round, s);
    } catch {
      // truncated or corrupt line: ignore
    }
  }
  return [...byRound.values()].sort((a, b) => a.round - b.round);
}

/** Append-only local history. One line per round, datasync before the call returns, user-only mode where the OS honours it. */
export class JsonlStore implements SnapshotStore {
  private known: Set<number> | null = null;
  private needsNewline = false;
  // Serialises appends so two saves cannot interleave bytes.
  private tail: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly file: string,
    private readonly meta: EventMeta,
  ) {}

  private async init(): Promise<Set<number>> {
    if (this.known) return this.known;
    const known = new Set((await readJsonl(this.file)).map((s) => s.round));
    try {
      const fh = await fs.open(this.file, 'r');
      try {
        const { size } = await fh.stat();
        if (size > 0) {
          const b = Buffer.alloc(1);
          await fh.read(b, 0, 1, size - 1);
          this.needsNewline = b[0] !== 0x0a;
        }
      } finally {
        await fh.close();
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
    this.known = known;
    return known;
  }

  saveRound(s: Snapshot): Promise<void> {
    const run = this.tail.then(async () => {
      const known = await this.init();
      if (known.has(s.round)) return;
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      const fh = await fs.open(this.file, 'a', 0o600);
      try {
        // A crash can leave a partial last line; start on a fresh line so it cannot swallow this record.
        await fh.write((this.needsNewline ? '\n' : '') + JSON.stringify(s) + '\n');
        await fh.datasync();
      } finally {
        await fh.close();
      }
      this.needsNewline = false;
      known.add(s.round);
    });
    this.tail = run.catch(() => undefined);
    return run;
  }

  async rounds(upTo?: number): Promise<Snapshot[]> {
    return (await readJsonl(this.file)).filter((s) => upTo === undefined || s.round <= upTo);
  }

  async latest(): Promise<Snapshot | null> {
    const all = await this.rounds();
    return all.length ? all[all.length - 1] : null;
  }

  async eventMeta(): Promise<EventMeta> {
    return this.meta;
  }
}

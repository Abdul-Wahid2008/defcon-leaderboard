import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseScoreboard } from '../src/lib/source/parse';
import { loadSourceMap } from '../src/lib/source/source-map';

// Drop-in check: when the club's real sample is placed at docs/club-inputs/scoreboard.sample.json, the committed
// mapping must parse it. If it does not, this test fails loudly and docs/SOURCE_MAPPING.md says what to edit.
const sample = path.resolve(__dirname, '..', 'docs', 'club-inputs', 'scoreboard.sample.json');

describe('real club sample', () => {
  it.skipIf(!fs.existsSync(sample))('parses docs/club-inputs/scoreboard.sample.json with config/source-map.json', () => {
    const snapshot = parseScoreboard(JSON.parse(fs.readFileSync(sample, 'utf8')), loadSourceMap());
    expect(snapshot.teams.length).toBeGreaterThan(0);
  });

  it('documents where the sample goes', () => {
    expect(fs.existsSync(path.resolve(__dirname, '..', 'docs', 'club-inputs', 'README.md'))).toBe(true);
  });
});

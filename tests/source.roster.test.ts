import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyRoster, loadRoster, parseRoster } from '../src/lib/source/roster';
import type { ParsedTeam } from '../src/lib/source/types';

const team = (teamId: string, name: string): ParsedTeam => ({ teamId, name, total: 10, attack: 3 });

describe('roster', () => {
  it('overrides display names only', () => {
    const r = parseRoster({ teams: [{ teamId: '1', displayName: 'Team  Alpha‮' }] });
    const { teams, matched } = applyRoster([team('1', 'src'), team('2', 'other')], r);
    expect(matched).toBe(1);
    expect(teams[0]).toEqual({ teamId: '1', name: 'Team Alpha', total: 10, attack: 3 });
    expect(teams[1].name).toBe('other');
  });

  it('is a no-op without a roster and ignores unknown ids', () => {
    expect(applyRoster([team('1', 'a')], null)).toEqual({ teams: [team('1', 'a')], matched: 0 });
    expect(applyRoster([team('1', 'a')], parseRoster({ teams: [{ teamId: '9', displayName: 'x' }] })).matched).toBe(0);
  });

  it('cannot inject anything but a display name', () => {
    expect(() => parseRoster({ teams: [{ teamId: '1', displayName: 'a', total: 9999 }] })).toThrow();
    expect(() => parseRoster({ teams: [{ teamId: '1', displayName: 'a', email: 'x@y.z' }] })).toThrow();
    expect(() => parseRoster({ teams: [], extra: 1 })).toThrow();
    expect(() => parseRoster({ teams: [{ teamId: '__proto__ x', displayName: 'a' }] })).toThrow();
  });

  it('rejects duplicates, empty names and oversize lists', () => {
    expect(() => parseRoster({ teams: [{ teamId: '1', displayName: 'a' }, { teamId: '1', displayName: 'b' }] })).toThrow(/duplicate/);
    expect(() => parseRoster({ teams: [{ teamId: '1', displayName: '​' }] })).toThrow(/empty/);
    expect(() => parseRoster({ teams: Array.from({ length: 201 }, (_, i) => ({ teamId: String(i), displayName: 'n' })) })).toThrow();
  });

  it('loadRoster: missing file is null, big file throws, good file loads', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-roster-'));
    try {
      const f = path.join(dir, 'roster.json');
      expect(loadRoster(f)).toBeNull();
      fs.writeFileSync(f, JSON.stringify({ teams: [{ teamId: '1', displayName: 'A' }] }));
      expect(loadRoster(f)?.teams).toHaveLength(1);
      fs.writeFileSync(f, ' '.repeat(70 * 1024));
      expect(() => loadRoster(f)).toThrow(/too large/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

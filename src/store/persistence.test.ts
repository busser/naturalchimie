import { describe, it, expect } from 'vitest';
import { parseBoard } from '../core/board-text';
import { computeBoardSum } from '../core/score';
import type { LeaderboardEntry } from './persistence';
import {
  buildLeaderboardEntry,
  clearRun,
  decodeRun,
  decodeScores,
  encodeRun,
  encodeScores,
  formatLocalTimestamp,
  insertLeaderboardEntry,
  loadRun,
  loadScores,
  recordRunInLeaderboard,
  saveRun,
  saveScores,
} from './persistence';
import type { State } from '../core/state';

// In-memory Storage stand-in. Vitest's default environment is node;
// using an injected fake avoids spinning up jsdom and lets failure
// modes be exercised explicitly.
function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
    key: (i) => Array.from(map.keys())[i] ?? null,
  };
}

function throwingStorage(): Storage {
  const err = (): never => {
    throw new Error('storage unavailable');
  };
  return {
    get length(): number {
      return err();
    },
    clear: err,
    getItem: err,
    setItem: err,
    removeItem: err,
    key: err,
  };
}

function stateWith(boardText: string, partial?: Partial<State>): State {
  const board = parseBoard(boardText);
  return {
    board,
    active: {
      kind: 'pair',
      column: 3,
      orientation: 'horizontal',
      first: 2,
      second: 5,
    },
    preview: { kind: 'pair', first: 1, second: 1 },
    comboScore: 120,
    score: 120 + computeBoardSum(board),
    ...partial,
  };
}

describe('persistence / run encode/decode', () => {
  it('round-trips a state with a horizontal pair and a placed detonator', () => {
    const state = stateWith(`
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      1 . . . . . .
      2 3 . . . E .
    `);
    const encoded = encodeRun(state as State & { active: NonNullable<State['active']> });
    const decoded = decodeRun(JSON.parse(JSON.stringify(encoded)));
    expect(decoded).not.toBeNull();
    expect(decoded!.board).toEqual(state.board);
    expect(decoded!.active).toEqual(state.active);
    expect(decoded!.preview).toEqual(state.preview);
    expect(decoded!.comboScore).toBe(state.comboScore);
    expect(decoded!.score).toBe(state.score);
  });

  it('encodes dynamite and detonator active pieces', () => {
    const dyn = stateWith('. . . . . . .', {
      active: { kind: 'dynamite', column: 3 },
    });
    const encDyn = encodeRun(dyn as State & { active: NonNullable<State['active']> });
    expect(decodeRun(encDyn)?.active).toEqual({ kind: 'dynamite', column: 3 });

    const det = stateWith('. . . . . . .', {
      active: { kind: 'detonator', column: 3 },
      preview: { kind: 'detonator' },
    });
    const encDet = encodeRun(det as State & { active: NonNullable<State['active']> });
    expect(decodeRun(encDet)?.active).toEqual({ kind: 'detonator', column: 3 });
    expect(decodeRun(encDet)?.preview).toEqual({ kind: 'detonator' });
  });

  it('records the spawn-pool max separately from the board', () => {
    // Highest tier on the board is 4, so the pool is {1..4}.
    const state = stateWith(`
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      4 . . . . . .
    `);
    const encoded = encodeRun(state as State & { active: NonNullable<State['active']> }) as { poolMax: number };
    expect(encoded.poolMax).toBe(4);
  });

  it('returns null on version mismatch', () => {
    const state = stateWith('. . . . . . .');
    const encoded = encodeRun(state as State & { active: NonNullable<State['active']> });
    const bumped = { ...encoded, version: 99 };
    expect(decodeRun(bumped)).toBeNull();
  });

  it('returns null on malformed payloads', () => {
    expect(decodeRun(null)).toBeNull();
    expect(decodeRun('not an object')).toBeNull();
    expect(decodeRun({})).toBeNull();
    expect(
      decodeRun({
        version: 1,
        board: 'not an array',
        activePiece: { kind: 'pair', left: { tier: 1 }, right: { tier: 1 } },
        nextPiece: { kind: 'pair', left: { tier: 1 }, right: { tier: 1 } },
        poolMax: 3,
        score: { comboScore: 0, boardSum: 0 },
      }),
    ).toBeNull();
    // Tier out of range.
    const state = stateWith('. . . . . . .');
    const encoded = encodeRun(state as State & { active: NonNullable<State['active']> });
    const evil = JSON.parse(JSON.stringify(encoded));
    evil.activePiece.left.tier = 99;
    expect(decodeRun(evil)).toBeNull();
  });
});

describe('persistence / leaderboard', () => {
  it('builds an entry from the game-over state', () => {
    const state = stateWith(`
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      B B . . . . .
      9 9 9 . A A A
    `);
    const entry = buildLeaderboardEntry(state, '2026-04-12T18:43:01+02:00');
    expect(entry.highestTier).toBe(11);
    expect(entry.highestTierCount).toBe(2);
    // Per spec: score = comboScore + boardSum at game-over, recomputed
    // (not state.score, which holds the pre-drop value).
    expect(entry.score).toBe(state.comboScore + computeBoardSum(state.board));
    expect(entry.timestamp).toBe('2026-04-12T18:43:01+02:00');
  });

  it('handles an empty board (0 / 0)', () => {
    const state = stateWith('. . . . . . .');
    const entry = buildLeaderboardEntry(state, '2026-01-01T00:00:00+00:00');
    expect(entry.highestTier).toBe(0);
    expect(entry.highestTierCount).toBe(0);
  });

  it('sorts by highestTier, then count, then score, then timestamp', () => {
    const e = (
      highestTier: number,
      highestTierCount: number,
      score: number,
      timestamp: string,
    ): LeaderboardEntry => ({
      highestTier,
      highestTierCount,
      score,
      timestamp,
    });
    const entries: LeaderboardEntry[] = [
      e(10, 1, 500, '2026-01-01T00:00:00+00:00'),
      e(11, 1, 100, '2026-01-01T00:00:00+00:00'),
      e(11, 2, 100, '2026-01-01T00:00:00+00:00'),
      e(11, 2, 200, '2026-01-01T00:00:00+00:00'),
      e(11, 2, 200, '2026-02-01T00:00:00+00:00'),
    ];
    let sorted: LeaderboardEntry[] = [];
    for (const entry of entries) sorted = insertLeaderboardEntry(sorted, entry);
    expect(sorted.map((x) => [x.highestTier, x.highestTierCount, x.score, x.timestamp])).toEqual([
      [11, 2, 200, '2026-02-01T00:00:00+00:00'],
      [11, 2, 200, '2026-01-01T00:00:00+00:00'],
      [11, 2, 100, '2026-01-01T00:00:00+00:00'],
      [11, 1, 100, '2026-01-01T00:00:00+00:00'],
      [10, 1, 500, '2026-01-01T00:00:00+00:00'],
    ]);
  });

  it('truncates to the top ten', () => {
    let entries: LeaderboardEntry[] = [];
    for (let i = 0; i < 15; i++) {
      entries = insertLeaderboardEntry(entries, {
        highestTier: 5,
        highestTierCount: 1,
        score: i,
        timestamp: '2026-01-01T00:00:00+00:00',
      });
    }
    expect(entries).toHaveLength(10);
    // Top entry should be the highest score (14), bottom should be 5.
    expect(entries[0].score).toBe(14);
    expect(entries[9].score).toBe(5);
  });

  it('round-trips through encode/decode', () => {
    const entries: LeaderboardEntry[] = [
      {
        highestTier: 11,
        highestTierCount: 1,
        score: 12750,
        timestamp: '2026-04-12T18:43:01+02:00',
      },
      {
        highestTier: 10,
        highestTierCount: 3,
        score: 9810,
        timestamp: '2026-04-11T20:12:55+02:00',
      },
    ];
    const encoded = encodeScores(entries);
    const decoded = decodeScores(JSON.parse(JSON.stringify(encoded)));
    expect(decoded).toEqual(entries);
  });

  it('discards leaderboard on version mismatch', () => {
    expect(decodeScores({ version: 99, entries: [] })).toBeNull();
  });
});

describe('persistence / storage glue', () => {
  it('saves and loads a run through Storage', () => {
    const storage = memoryStorage();
    const state = stateWith(`
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      1 2 3 . . . .
    `);
    saveRun(storage, state);
    const loaded = loadRun(storage);
    expect(loaded).not.toBeNull();
    expect(loaded!.board).toEqual(state.board);
    expect(loaded!.active).toEqual(state.active);
    expect(loaded!.preview).toEqual(state.preview);
  });

  it('skips save when active is null (e.g. game-over state)', () => {
    const storage = memoryStorage();
    const state = stateWith('. . . . . . .', { active: null });
    saveRun(storage, state);
    expect(loadRun(storage)).toBeNull();
  });

  it('clearRun removes the key', () => {
    const storage = memoryStorage();
    const state = stateWith('. . . . . . .');
    saveRun(storage, state);
    expect(loadRun(storage)).not.toBeNull();
    clearRun(storage);
    expect(loadRun(storage)).toBeNull();
  });

  it('loadRun returns null on parse failure', () => {
    const storage = memoryStorage();
    storage.setItem('naturalchimie:run', '{not valid json');
    expect(loadRun(storage)).toBeNull();
  });

  it('degrades silently when Storage throws on every call', () => {
    const storage = throwingStorage();
    const state = stateWith('. . . . . . .');
    // None of these should throw.
    expect(() => saveRun(storage, state)).not.toThrow();
    expect(() => clearRun(storage)).not.toThrow();
    expect(loadRun(storage)).toBeNull();
    expect(loadScores(storage)).toEqual([]);
    expect(() =>
      saveScores(storage, [
        {
          highestTier: 1,
          highestTierCount: 1,
          score: 1,
          timestamp: '2026-01-01T00:00:00+00:00',
        },
      ]),
    ).not.toThrow();
  });

  it('recordRunInLeaderboard appends and sorts', () => {
    const storage = memoryStorage();
    const state = stateWith(`
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      A A A A . . .
    `);
    recordRunInLeaderboard(storage, state, '2026-04-12T18:43:01+02:00');
    const lower = stateWith(`
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      5 5 5 . . . .
    `);
    recordRunInLeaderboard(storage, lower, '2026-04-13T09:00:00+02:00');
    const stored = loadScores(storage);
    expect(stored).toHaveLength(2);
    expect(stored[0].highestTier).toBe(10);
    expect(stored[1].highestTier).toBe(5);
  });
});

describe('persistence / timestamp formatting', () => {
  it('produces an ISO 8601 string with a timezone offset', () => {
    const ts = formatLocalTimestamp(new Date('2026-04-12T16:43:01Z'));
    // Format check: YYYY-MM-DDTHH:MM:SS±HH:MM. Exact offset depends
    // on the test runner's TZ, so just assert the shape.
    expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
  });
});

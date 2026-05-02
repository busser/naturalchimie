import { describe, it, expect } from 'vitest';
import { parseBoard } from './board-text';
import { computeScore } from './score';
import type { Board, Cell } from './state';

const EMPTY_BOARD: Board = Array.from({ length: 9 }, () =>
  Array.from({ length: 7 }, (): Cell => ({ kind: 'empty' })),
);

describe('computeScore', () => {
  it('returns 0 on an empty board', () => {
    expect(computeScore(EMPTY_BOARD)).toBe(0);
  });

  it('values a tier-1 element as 1', () => {
    const board = parseBoard(`
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . 1 . . .
    `);
    expect(computeScore(board)).toBe(1);
  });

  it('matches acceptance test 1.1 — horizontal [1/2] = 1 + 3 = 4', () => {
    const board = parseBoard(`
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . 1 2 . .
    `);
    expect(computeScore(board)).toBe(4);
  });

  it('matches acceptance test 1.3 — two tier-5s plus tier-1 + tier-2 = 166', () => {
    const board = parseBoard(`
      . . . . . . .
      . . . . . . .
      . . . 1 . . .
      . . . 2 . . .
      . . . 5 . . .
      . . . 5 . . .
    `);
    expect(computeScore(board)).toBe(1 + 3 + 81 + 81);
  });

  it('matches acceptance test 6.2 — one of each tier 1–11 = 88573', () => {
    const board = parseBoard(`
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      9 A B . . . .
      5 6 7 8 . . .
      1 2 3 4 . . .
    `);
    expect(computeScore(board)).toBe(88573);
  });

  it('values a tier-12 (gold) at 3^11 = 177147', () => {
    const board = parseBoard(`
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      C . . . . . .
    `);
    expect(computeScore(board)).toBe(177147);
  });

  it('excludes detonator cells from the score', () => {
    const board = parseBoard(`
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . E . . .
    `);
    expect(computeScore(board)).toBe(0);
  });
});

import { describe, it, expect } from 'vitest';
import { parseBoard } from './board-text';
import { COMBO_BONUS, computeBoardSum, computeChainBonus } from './score';
import type { Board, Cell } from './state';

const EMPTY_BOARD: Board = Array.from({ length: 9 }, () =>
  Array.from({ length: 7 }, (): Cell => ({ kind: 'empty' })),
);

describe('computeBoardSum', () => {
  // The displayed score is `comboScore + computeBoardSum(board)` per
  // docs/01-gameplay-rules.md "Scoring"; this suite covers only the
  // board-sum half. Cascade-bonus tests live in apply.test.ts.


  it('returns 0 on an empty board', () => {
    expect(computeBoardSum(EMPTY_BOARD)).toBe(0);
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
    expect(computeBoardSum(board)).toBe(1);
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
    expect(computeBoardSum(board)).toBe(4);
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
    expect(computeBoardSum(board)).toBe(1 + 3 + 81 + 81);
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
    expect(computeBoardSum(board)).toBe(88573);
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
    expect(computeBoardSum(board)).toBe(177147);
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
    expect(computeBoardSum(board)).toBe(0);
  });
});

describe('computeChainBonus', () => {
  // The first reaction in a cascade earns no bonus; each further chain
  // link adds COMBO_BONUS. Mirrors NC2's `Stage.updateStaticScore` at
  // `fla/game/src/Stage.hx:277-280` (see findings.md "Cascade combo
  // bonus").

  it('returns 0 for a cascade with no merges', () => {
    expect(computeChainBonus(0)).toBe(0);
  });

  it('returns 0 for a one-merge cascade (no chain)', () => {
    expect(computeChainBonus(1)).toBe(0);
  });

  it('awards COMBO_BONUS for each chain link beyond the first', () => {
    expect(computeChainBonus(2)).toBe(COMBO_BONUS);
    expect(computeChainBonus(3)).toBe(2 * COMBO_BONUS);
    expect(computeChainBonus(7)).toBe(6 * COMBO_BONUS);
  });
});

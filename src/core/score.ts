// Scoring helpers per docs/01-gameplay-rules.md ("Scoring").
//
// The displayed score is `comboScore + boardSum(board)`. `boardSum`
// is the sum of `3^(tier - 1)` over playfield element cells; it
// changes whenever the board changes (drops, merges, detonations).
// `comboScore` is a separate running counter that only ratchets up
// on stable-board settles, by `max(chainLinks - 1, 0) * COMBO_BONUS`
// where `chainLinks` is the number of merge steps the cascade
// resolved. The first reaction in a cascade earns no bonus; each
// further chain link adds COMBO_BONUS.

import type { Board } from './state';

export const COMBO_BONUS = 10;

const PLAYFIELD_HEIGHT = 7;

export function computeBoardSum(board: Board): number {
  let total = 0;
  for (let row = 0; row < PLAYFIELD_HEIGHT; row++) {
    for (let column = 0; column < board[row].length; column++) {
      const cell = board[row][column];
      if (cell.kind === 'element') total += 3 ** (cell.tier - 1);
    }
  }
  return total;
}

export function computeChainBonus(chainLinks: number): number {
  return Math.max(chainLinks - 1, 0) * COMBO_BONUS;
}

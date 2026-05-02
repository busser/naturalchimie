// Stable-board score per docs/01-gameplay-rules.md ("Scoring"):
// `sum over playfield elements of 3^(tier - 1)`. The active piece and
// the overflow zone are excluded — the active piece sits in the spawn
// area above the playfield, and overflow rows are guaranteed empty by
// the time scoring runs (the lose check rejects boards where they are
// not).

import type { Board } from './state';

const PLAYFIELD_HEIGHT = 7;

export function computeScore(board: Board): number {
  let total = 0;
  for (let row = 0; row < PLAYFIELD_HEIGHT; row++) {
    for (let column = 0; column < board[row].length; column++) {
      const cell = board[row][column];
      if (cell.kind === 'element') total += 3 ** (cell.tier - 1);
    }
  }
  return total;
}

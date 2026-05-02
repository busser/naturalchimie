// Builds the State the runtime starts with. Until the spawn module
// lands, the active pair and preview are hard-coded to a couple of
// distinct low tiers so shift and rotate are visually legible.

import type { Board, Cell, State } from './state';

const BOARD_HEIGHT = 9;
const BOARD_WIDTH = 7;

// Spec column 4 (1-indexed) is code column 3. A horizontal pair
// anchored here spans the spawn position columns 4–5.
const SPAWN_COLUMN = 3;

export function createInitialState(): State {
  return {
    board: emptyBoard(),
    active: {
      kind: 'pair',
      column: SPAWN_COLUMN,
      orientation: 'horizontal',
      first: 1,
      second: 2,
    },
    preview: { kind: 'pair', first: 1, second: 1 },
    score: 0,
  };
}

function emptyBoard(): Board {
  const rows: Cell[][] = [];
  for (let r = 0; r < BOARD_HEIGHT; r++) {
    const row: Cell[] = [];
    for (let c = 0; c < BOARD_WIDTH; c++) {
      row.push({ kind: 'empty' });
    }
    rows.push(row);
  }
  return rows;
}

// Builds the State a fresh round starts with. Both the active piece
// and the preview are drawn from the spawn module against an empty
// board, so round start uses the same code path as later previews.

import { pieceToActive, samplePiece } from './spawn';
import type { Board, Cell, State } from './state';
import type { Rng } from './rng';

const BOARD_HEIGHT = 9;
const BOARD_WIDTH = 7;

export function createInitialState(rng: Rng): [State, Rng] {
  const board = emptyBoard();
  const [first, afterFirst] = samplePiece(board, rng);
  const [preview, afterSecond] = samplePiece(board, afterFirst);
  return [
    {
      board,
      active: pieceToActive(first),
      preview,
      score: 0,
      comboScore: 0,
    },
    afterSecond,
  ];
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

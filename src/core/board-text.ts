// Text DSL for boards, matching the notation in docs/06-acceptance-tests.md.
// `parseBoard` reads a top-down diagram (row 9 at the top, row 1 at the bottom)
// and produces a bottom-indexed Board. `formatBoard` is the inverse and is
// also useful for diff-friendly assertion output.

import type { Board, Cell, Tier } from './state';

const BOARD_WIDTH = 7;
const BOARD_HEIGHT = 9;
const PLAYFIELD_HEIGHT = 7;

export function parseBoard(text: string): Board {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length > BOARD_HEIGHT) {
    throw new Error(
      `parseBoard: expected at most ${BOARD_HEIGHT} rows, got ${lines.length}`,
    );
  }

  // Diagram is top-down; reverse so index 0 is the floor.
  const bottomUp = [...lines].reverse();
  const rows: Cell[][] = [];
  for (let r = 0; r < BOARD_HEIGHT; r++) {
    const line = bottomUp[r];
    rows.push(line === undefined ? emptyRow() : parseRow(line, r));
  }
  return rows;
}

export function formatBoard(board: Board): string {
  const useOverflow = board
    .slice(PLAYFIELD_HEIGHT)
    .some((row) => row.some((cell) => cell.kind !== 'empty'));
  const topRow = (useOverflow ? BOARD_HEIGHT : PLAYFIELD_HEIGHT) - 1;

  const lines: string[] = [];
  for (let r = topRow; r >= 0; r--) {
    lines.push(board[r].map(formatCell).join(' '));
  }
  return lines.join('\n');
}

function parseRow(line: string, rowIndex: number): Cell[] {
  const tokens = line.split(/\s+/);
  if (tokens.length !== BOARD_WIDTH) {
    throw new Error(
      `parseBoard: row ${rowIndex} has ${tokens.length} tokens, expected ${BOARD_WIDTH} (line: "${line}")`,
    );
  }
  return tokens.map(parseToken);
}

function parseToken(token: string): Cell {
  if (token === '.') return { kind: 'empty' };
  if (token === 'E') return { kind: 'detonator' };
  if (token === 'D') {
    throw new Error(
      'parseBoard: dynamite (`D`) cannot occupy a board cell — it is only ever an active piece',
    );
  }
  const tier = TOKEN_TO_TIER.get(token);
  if (tier === undefined) {
    throw new Error(`parseBoard: unknown token "${token}"`);
  }
  return { kind: 'element', tier };
}

function formatCell(cell: Cell): string {
  switch (cell.kind) {
    case 'empty':
      return '.';
    case 'detonator':
      return 'E';
    case 'element':
      return TIER_TO_TOKEN[cell.tier];
  }
}

function emptyRow(): Cell[] {
  return Array.from({ length: BOARD_WIDTH }, () => ({ kind: 'empty' }));
}

const TOKEN_TO_TIER: ReadonlyMap<string, Tier> = new Map([
  ['1', 1],
  ['2', 2],
  ['3', 3],
  ['4', 4],
  ['5', 5],
  ['6', 6],
  ['7', 7],
  ['8', 8],
  ['9', 9],
  ['A', 10],
  ['B', 11],
  ['C', 12],
]);

const TIER_TO_TOKEN: Record<Tier, string> = {
  1: '1',
  2: '2',
  3: '3',
  4: '4',
  5: '5',
  6: '6',
  7: '7',
  8: '8',
  9: '9',
  10: 'A',
  11: 'B',
  12: 'C',
};

// Pure transition function for the core: `(state, input, rng) →
// (state', steps, rng')`. Currently handles `shift`, `rotate`, the
// landing portion of `drop`, and the post-drop spawn that promotes
// the preview to active. The cascade that should sit between landing
// and spawn (reactions, gravity, scoring, lose check) will land
// alongside the cascade simulator.

import { pieceToActive, samplePiece } from './spawn';
import type { ActivePiece, Board, Cell, Input, State, Step } from './state';
import type { Rng } from './rng';

const COLUMN_MIN = 0;
const COLUMN_MAX = 6;

export function applyInput(
  state: State,
  input: Input,
  rng: Rng,
): [State, Step[], Rng] {
  if (state.active === null) return [state, [], rng];
  const active = state.active;
  switch (input.kind) {
    case 'shift':
      return shift(state, active, input.direction, rng);
    case 'rotate':
      return rotate(state, active, rng);
    case 'drop':
      return drop(state, active, rng);
  }
}

function shift(
  state: State,
  active: ActivePiece,
  direction: 'left' | 'right',
  rng: Rng,
): [State, Step[], Rng] {
  const dx = direction === 'left' ? -1 : 1;
  const moved = shiftPiece(active, dx);
  if (moved === null) return [state, [], rng];
  const next: State = { ...state, active: moved };
  return [next, [{ event: { kind: 'pair-shift' }, snapshot: next }], rng];
}

function shiftPiece(active: ActivePiece, dx: number): ActivePiece | null {
  const newColumn = active.column + dx;
  switch (active.kind) {
    case 'pair': {
      const rightColumn =
        active.orientation === 'horizontal' ? newColumn + 1 : newColumn;
      if (newColumn < COLUMN_MIN || rightColumn > COLUMN_MAX) return null;
      return { ...active, column: newColumn };
    }
    case 'dynamite':
    case 'detonator': {
      if (newColumn < COLUMN_MIN || newColumn > COLUMN_MAX) return null;
      return { ...active, column: newColumn };
    }
  }
}

function rotate(
  state: State,
  active: ActivePiece,
  rng: Rng,
): [State, Step[], Rng] {
  if (active.kind !== 'pair') return [state, [], rng];
  const wasHorizontal = active.orientation === 'horizontal';
  const newOrientation = wasHorizontal ? 'vertical' : 'horizontal';
  // V→H wall-kick: a vertical pair at the right wall would push its
  // right half past column 6, so the pair shifts one column left.
  // Spec calls this out as the only kick case; H→V never needs one
  // because the resulting vertical pair always fits in its starting
  // column.
  const newColumn =
    !wasHorizontal && active.column + 1 > COLUMN_MAX
      ? active.column - 1
      : active.column;
  // 90° clockwise rotation around the pair's center. With first =
  // anchor end (left for H, bottom for V), the spec's mapping (left
  // → top, right → bottom; top → right, bottom → left) makes labels
  // swap on H→V and stay put on V→H. Net effect: 4 rotations is
  // identity, 2 rotations swap the pair.
  const [first, second] = wasHorizontal
    ? [active.second, active.first]
    : [active.first, active.second];
  const next: State = {
    ...state,
    active: {
      kind: 'pair',
      column: newColumn,
      orientation: newOrientation,
      first,
      second,
    },
  };
  return [next, [{ event: { kind: 'pair-rotate' }, snapshot: next }], rng];
}

function drop(
  state: State,
  active: ActivePiece,
  rng: Rng,
): [State, Step[], Rng] {
  const { board, landStep } = landActive(state, active);
  const afterLand: State = { ...state, board, active: null };
  const landStepWithSnapshot: Step = { ...landStep, snapshot: afterLand };
  // Preview slides to active and a fresh piece is drawn for the
  // preview, against the post-land board. Spec sequencing
  // (03-spawning.md "Sequencing relative to the cascade") draws
  // against the post-cascade board; until cascades land that's the
  // post-land board.
  const [newPreview, nextRng] = samplePiece(board, rng);
  const afterSpawn: State = {
    board,
    active: pieceToActive(state.preview),
    preview: newPreview,
    score: state.score,
  };
  const spawnStep: Step = { event: { kind: 'spawn' }, snapshot: afterSpawn };
  return [afterSpawn, [landStepWithSnapshot, spawnStep], nextRng];
}

type LandStepDraft = { board: Board; landStep: Omit<Step, 'snapshot'> };

function landActive(state: State, active: ActivePiece): LandStepDraft {
  switch (active.kind) {
    case 'pair': {
      const { board, firstLandingRow, secondLandingRow } = landPair(
        state.board,
        active,
      );
      return {
        board,
        landStep: {
          event: { kind: 'pair-land', firstLandingRow, secondLandingRow },
        },
      };
    }
    case 'detonator': {
      // The spec's "if a piece lands on a detonator, the detonator
      // triggers first" handles a piece dropped *onto* an existing
      // detonator. Dropping the detonator itself just lands it as a
      // board cell, waiting for a future piece to set it off.
      const { board, landingRow } = landSolo(state.board, active.column, {
        kind: 'detonator',
      });
      return { board, landStep: { event: { kind: 'solo-land', landingRow } } };
    }
    case 'dynamite': {
      // TODO(busser): dynamite should detonate on impact and clear a
      // path of cells; that lives behind the cascade simulator. Until
      // then it lands and vanishes — the visual fall plays, no board
      // cells change.
      const landingRow = lowestEmptyRow(state.board, active.column);
      return {
        board: state.board,
        landStep: { event: { kind: 'solo-land', landingRow } },
      };
    }
  }
}

function landSolo(
  board: Board,
  column: number,
  cell: Cell,
): { board: Board; landingRow: number } {
  const next: Cell[][] = board.map((row) => [...row]);
  const landingRow = placeFalling(next, column, cell);
  return { board: next, landingRow };
}

function lowestEmptyRow(
  board: readonly (readonly Cell[])[],
  column: number,
): number {
  for (let row = 0; row < board.length; row++) {
    if (board[row][column].kind === 'empty') return row;
  }
  throw new Error(`drop: column ${column} has no empty cell`);
}

// Each half falls independently to the lowest empty cell in its
// column. For a vertical pair both halves share a column; placing
// the bottom (`first`) before the top (`second`) means the second
// call's "lowest empty" is the row above the first, which is what
// we want. The landing rows flow into the step so the animation
// driver can size the fall without re-walking the board.
function landPair(
  board: Board,
  pair: Extract<ActivePiece, { kind: 'pair' }>,
): { board: Board; firstLandingRow: number; secondLandingRow: number } {
  const next: Cell[][] = board.map((row) => [...row]);
  const firstColumn = pair.column;
  const secondColumn =
    pair.orientation === 'horizontal' ? pair.column + 1 : pair.column;
  const firstLandingRow = placeFalling(next, firstColumn, {
    kind: 'element',
    tier: pair.first,
  });
  const secondLandingRow = placeFalling(next, secondColumn, {
    kind: 'element',
    tier: pair.second,
  });
  return { board: next, firstLandingRow, secondLandingRow };
}

function placeFalling(
  board: Cell[][],
  column: number,
  cell: Cell,
): number {
  const row = lowestEmptyRow(board, column);
  board[row][column] = cell;
  return row;
}

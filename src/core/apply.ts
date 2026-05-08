// Pure transition function for the core: `(state, input, rng) →
// (state', steps, rng')`. Handles `shift`, `rotate`, and `drop`. A
// drop runs the full chain: land → cascade (reactions + gravity to
// fixpoint) → lose check → score recompute → spawn.

import { runCascade } from './cascade';
import { computeBoardSum, computeChainBonus } from './score';
import { pieceToActive, samplePiece } from './spawn';
import type {
  ActivePiece,
  Board,
  Cell,
  Input,
  Pos,
  State,
  Step,
} from './state';
import type { Rng } from './rng';

const COLUMN_MIN = 0;
const COLUMN_MAX = 6;
// Rows 0–6 are the playfield; rows 7–8 are the overflow zone. An
// element resting in the overflow zone on a stable board means the
// round is lost.
const OVERFLOW_ROW_MIN = 7;

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
  const { board: postLandBoard, landSteps } = landActive(state, active);
  const {
    board: stableBoard,
    steps: cascadeSteps,
    chainLinks,
  } = runCascade(postLandBoard, state);

  // Lose check runs on the post-cascade stable board: a cascade can
  // clear elements out of the overflow zone, so a row-7 cell right
  // after landing is not yet a loss. No new preview is drawn (the
  // RNG stays put) and no piece is promoted — the game-over step's
  // snapshot mirrors the stable state. Score does not update on
  // game-over per the spec ("if the round did not end, the score is
  // recomputed"); every emitted snapshot — including the live ones
  // landSteps/cascadeSteps were built with — gets reverted to the
  // prior score and prior comboScore.
  if (isLost(stableBoard)) {
    const stableState: State = { ...state, board: stableBoard, active: null };
    const frozenSteps = [...landSteps, ...cascadeSteps].map((step) => ({
      ...step,
      snapshot: {
        ...step.snapshot,
        score: state.score,
        comboScore: state.comboScore,
      },
    }));
    return [
      stableState,
      [
        ...frozenSteps,
        { event: { kind: 'game-over' }, snapshot: stableState },
      ],
      rng,
    ];
  }

  // The cascade bonus settles on the final stable-board step. Every
  // step before that already carries a live `score = comboScore +
  // boardSum(stepBoard)` with the prior comboScore (built in
  // landActive and runCascade); the last step replaces both fields
  // with the new comboScore (= prior + chain bonus) and the matching
  // score. The "last step" is the final cascade step when the
  // cascade ran, otherwise the final land step (the dynamite-blast
  // for dynamite, the lone land step for pairs and detonators).
  const newComboScore = state.comboScore + computeChainBonus(chainLinks);
  const newScore = newComboScore + computeBoardSum(stableBoard);
  const stepsBeforeSpawn = settleFinalStep(
    landSteps,
    cascadeSteps,
    newComboScore,
    newScore,
  );

  // Preview slides to active and a fresh piece is drawn for the
  // preview, against the post-cascade board (03-spawning.md
  // "Sequencing relative to the cascade").
  const [newPreview, nextRng] = samplePiece(stableBoard, rng);
  const afterSpawn: State = {
    board: stableBoard,
    active: pieceToActive(state.preview),
    preview: newPreview,
    score: newScore,
    comboScore: newComboScore,
  };
  const spawnStep: Step = { event: { kind: 'spawn' }, snapshot: afterSpawn };
  return [afterSpawn, [...stepsBeforeSpawn, spawnStep], nextRng];
}

function settleFinalStep(
  landSteps: readonly Step[],
  cascadeSteps: readonly Step[],
  newComboScore: number,
  newScore: number,
): Step[] {
  const all = [...landSteps, ...cascadeSteps];
  if (all.length === 0) return [];
  const lastIndex = all.length - 1;
  return all.map((step, index) =>
    index === lastIndex
      ? {
          ...step,
          snapshot: {
            ...step.snapshot,
            score: newScore,
            comboScore: newComboScore,
          },
        }
      : step,
  );
}

function isLost(board: Board): boolean {
  for (let row = OVERFLOW_ROW_MIN; row < board.length; row++) {
    for (let column = 0; column < board[row].length; column++) {
      if (board[row][column].kind !== 'empty') return true;
    }
  }
  return false;
}

type LandResult = { board: Board; landSteps: Step[] };

// Snapshot helper for land/detonate steps. Each snapshot's `score` is
// the live `state.comboScore + boardSum(snapshotBoard)`, matching the
// rule that the displayed score updates at every step. The cascade
// bonus has not been awarded yet, so `comboScore` stays at the prior
// value here; the final cascade-or-land step gets bumped in
// `settleFinalStep`.
function liveSnapshot(state: State, board: Board): State {
  return {
    ...state,
    board,
    active: null,
    score: state.comboScore + computeBoardSum(board),
  };
}

function landActive(state: State, active: ActivePiece): LandResult {
  switch (active.kind) {
    case 'pair': {
      const { board, firstLandingRow, secondLandingRow } = landPair(
        state.board,
        active,
      );
      const landStep: Step = {
        event: { kind: 'pair-land', firstLandingRow, secondLandingRow },
        snapshot: liveSnapshot(state, board),
      };
      // A pair half triggers a detonator when it settles directly on
      // top of one. For a horizontal pair both columns are checked
      // independently; for a vertical pair only the bottom (first)
      // half can be a trigger, since the top half rests on its sibling.
      const triggers: Pos[] = [];
      const firstColumn = active.column;
      if (sittingOnDetonator(state.board, firstColumn, firstLandingRow)) {
        triggers.push({ row: firstLandingRow - 1, column: firstColumn });
      }
      if (active.orientation === 'horizontal') {
        const secondColumn = active.column + 1;
        if (sittingOnDetonator(state.board, secondColumn, secondLandingRow)) {
          triggers.push({ row: secondLandingRow - 1, column: secondColumn });
        }
      }
      if (triggers.length === 0) return { board, landSteps: [landStep] };
      const detonateStep = buildDetonateStep(state, board, triggers);
      return {
        board: detonateStep.snapshot.board,
        landSteps: [landStep, detonateStep],
      };
    }
    case 'detonator': {
      const { board, landingRow } = landSolo(state.board, active.column, {
        kind: 'detonator',
      });
      const landStep: Step = {
        event: { kind: 'solo-land', landingRow },
        snapshot: liveSnapshot(state, board),
      };
      // Detonator-on-detonator: the existing detonator (one row below
      // the new one's landing cell) triggers, and its 3×3 blast clears
      // the new detonator before it has a chance to be armed.
      if (sittingOnDetonator(state.board, active.column, landingRow)) {
        const triggers: Pos[] = [
          { row: landingRow - 1, column: active.column },
        ];
        const detonateStep = buildDetonateStep(state, board, triggers);
        return {
          board: detonateStep.snapshot.board,
          landSteps: [landStep, detonateStep],
        };
      }
      return { board, landSteps: [landStep] };
    }
    case 'dynamite': {
      // The dynamite is never a Cell — it falls and is consumed by
      // its own blast. Two steps cover the journey: a solo-land tween
      // onto an unchanged board, then the dynamite-blast that clears
      // the column from row 0 up to and including landingRow.
      const landingRow = lowestEmptyRow(state.board, active.column);
      const soloStep: Step = {
        event: { kind: 'solo-land', landingRow },
        snapshot: liveSnapshot(state, state.board),
      };
      // Dynamite-on-detonator: the detonator triggers first and the
      // dynamite is destroyed before its fuse can light. No
      // dynamite-blast step is emitted.
      if (sittingOnDetonator(state.board, active.column, landingRow)) {
        const triggers: Pos[] = [
          { row: landingRow - 1, column: active.column },
        ];
        const detonateStep = buildDetonateStep(state, state.board, triggers);
        return {
          board: detonateStep.snapshot.board,
          landSteps: [soloStep, detonateStep],
        };
      }
      const blastBoard = clearColumnSegment(
        state.board,
        active.column,
        0,
        landingRow,
      );
      return {
        board: blastBoard,
        landSteps: [
          soloStep,
          {
            event: {
              kind: 'dynamite-blast',
              column: active.column,
              landingRow,
            },
            snapshot: liveSnapshot(state, blastBoard),
          },
        ],
      };
    }
  }
}

function sittingOnDetonator(
  board: Board,
  column: number,
  landingRow: number,
): boolean {
  if (landingRow <= 0) return false;
  return board[landingRow - 1][column].kind === 'detonator';
}

// Apply the union of every triggered detonator's 3×3 zone (clamped to
// the grid) to `board`. Each triggered detonator clears its Moore
// neighborhood plus its own cell. A detonator caught inside another
// detonator's blast is destroyed silently (no chain trigger): the
// caller decides which detonators trigger and only those go in.
function buildDetonateStep(
  priorState: State,
  board: Board,
  triggers: readonly Pos[],
): Step {
  const next: Cell[][] = board.map((row) => [...row]);
  const cleared: Pos[] = [];
  const seen = new Set<number>();
  const width = board[0].length;
  for (const det of triggers) {
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const r = det.row + dr;
        const c = det.column + dc;
        if (r < 0 || r >= board.length) continue;
        if (c < 0 || c >= width) continue;
        const key = r * width + c;
        if (seen.has(key)) continue;
        seen.add(key);
        if (next[r][c].kind === 'empty') continue;
        next[r][c] = { kind: 'empty' };
        cleared.push({ row: r, column: c });
      }
    }
  }
  cleared.sort(
    (a, b) => a.row - b.row || a.column - b.column,
  );
  return {
    event: { kind: 'detonate', detonators: triggers, cleared },
    snapshot: liveSnapshot(priorState, next),
  };
}

function clearColumnSegment(
  board: Board,
  column: number,
  fromRow: number,
  toRow: number,
): Board {
  const next: Cell[][] = board.map((row) => [...row]);
  for (let r = fromRow; r <= toRow; r++) {
    next[r][column] = { kind: 'empty' };
  }
  return next;
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

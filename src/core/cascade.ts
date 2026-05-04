// Cascade simulator: given a board (typically the post-land board),
// run reactions and gravity to fixpoint and emit the corresponding
// step list. Pure — no RNG, no time, no dependency on the active
// piece. The caller (apply.ts) is responsible for stitching the
// returned steps between the pair-land step and the spawn step, and
// for rewriting the final stable-board step's snapshot to carry the
// recomputed score.
//
// Spec: docs/01-gameplay-rules.md "Reactions", "Gravity", "Cascade".
// Tier 12 is inert; size-3+ components of any tier 1–11 react.

import type {
  Board,
  Cell,
  Movement,
  Pos,
  ReactingGroup,
  State,
  Step,
  Tier,
} from './state';

const REACTIVE_TIER_MAX = 11;

// Drive the board to a stable state. An initial gravity pass handles
// suspended cells in the input — a no-op for clean post-land boards
// but essential after a detonation, which can leave holes in the
// columns adjacent to the blast. Then each iteration finds every
// connected component of size ≥ 3 of a single reactive tier, resolves
// them all simultaneously into one merge step, and applies per-column
// gravity (skipping the gravity step entirely when nothing moved).
// Loop until no reacting groups exist.
//
// `priorState` supplies the score, preview, and any other fields that
// the cascade itself does not change. Each emitted snapshot carries
// `priorState.score`; the score recompute happens at the apply.ts
// boundary on the final stable board.
export function runCascade(
  board: Board,
  priorState: State,
): { board: Board; steps: Step[] } {
  let current = board;
  const steps: Step[] = [];
  const initial = applyGravity(current);
  if (initial.movements.length > 0) {
    current = initial.board;
    steps.push({
      event: { kind: 'gravity', movements: initial.movements },
      snapshot: { ...priorState, board: current, active: null },
    });
  }
  while (true) {
    const groups = findReactingGroups(current);
    if (groups.length === 0) break;
    current = resolveReactions(current, groups);
    steps.push({
      event: { kind: 'merge', groups },
      snapshot: { ...priorState, board: current, active: null },
    });
    const { board: afterGravity, movements } = applyGravity(current);
    if (movements.length > 0) {
      current = afterGravity;
      steps.push({
        event: { kind: 'gravity', movements },
        snapshot: { ...priorState, board: current, active: null },
      });
    }
  }
  return { board: current, steps };
}

// Every connected component of size ≥ 3 of a single reactive tier.
// Tier 12 (gold) groups are visited but never returned, since gold
// is inert. Empty cells and detonators are skipped.
export function findReactingGroups(board: Board): ReactingGroup[] {
  const visited = makeVisited(board);
  const groups: ReactingGroup[] = [];
  for (let row = 0; row < board.length; row++) {
    for (let column = 0; column < board[row].length; column++) {
      if (visited[row][column]) continue;
      const cell = board[row][column];
      if (cell.kind !== 'element') {
        visited[row][column] = true;
        continue;
      }
      const tier = cell.tier;
      const cells = floodFillSameTier(board, visited, row, column, tier);
      if (tier <= REACTIVE_TIER_MAX && cells.length >= 3) {
        groups.push({
          cells,
          landing: pickLanding(cells),
          tierBefore: tier,
          tierAfter: (tier + 1) as Tier,
        });
      }
    }
  }
  return groups;
}

// Per-column gravity: read each column from the floor up, keep
// non-empty cells in order, repack them contiguously starting from
// the floor. Returns the per-cell movements so the animation can
// tween each falling element along its column.
export function applyGravity(board: Board): {
  board: Board;
  movements: Movement[];
} {
  const height = board.length;
  const width = board[0].length;
  const next: Cell[][] = [];
  for (let row = 0; row < height; row++) {
    next.push(Array.from({ length: width }, (): Cell => ({ kind: 'empty' })));
  }
  const movements: Movement[] = [];
  for (let column = 0; column < width; column++) {
    let writeRow = 0;
    for (let row = 0; row < height; row++) {
      const cell = board[row][column];
      if (cell.kind === 'empty') continue;
      next[writeRow][column] = cell;
      if (writeRow !== row) {
        movements.push({
          from: { row, column },
          to: { row: writeRow, column },
        });
      }
      writeRow++;
    }
  }
  return { board: next, movements };
}

// Clear every reacting group's cells, then place a tier-(n+1)
// element at each group's landing cell. Both passes run before any
// new cells are placed, so groups that are about to react cannot
// influence each other's resolution.
function resolveReactions(board: Board, groups: ReactingGroup[]): Board {
  const next: Cell[][] = board.map((row) => [...row]);
  for (const group of groups) {
    for (const cell of group.cells) {
      next[cell.row][cell.column] = { kind: 'empty' };
    }
  }
  for (const group of groups) {
    next[group.landing.row][group.landing.column] = {
      kind: 'element',
      tier: group.tierAfter,
    };
  }
  return next;
}

function floodFillSameTier(
  board: Board,
  visited: boolean[][],
  startRow: number,
  startColumn: number,
  tier: Tier,
): Pos[] {
  const stack: Pos[] = [{ row: startRow, column: startColumn }];
  const cells: Pos[] = [];
  while (stack.length > 0) {
    const pos = stack.pop()!;
    if (visited[pos.row][pos.column]) continue;
    const cell = board[pos.row][pos.column];
    if (cell.kind !== 'element' || cell.tier !== tier) continue;
    visited[pos.row][pos.column] = true;
    cells.push(pos);
    if (pos.row > 0) {
      stack.push({ row: pos.row - 1, column: pos.column });
    }
    if (pos.row + 1 < board.length) {
      stack.push({ row: pos.row + 1, column: pos.column });
    }
    if (pos.column > 0) {
      stack.push({ row: pos.row, column: pos.column - 1 });
    }
    if (pos.column + 1 < board[pos.row].length) {
      stack.push({ row: pos.row, column: pos.column + 1 });
    }
  }
  return cells;
}

// Spec: landing cell is the lowest row in the group, ties broken by
// the lowest column.
function pickLanding(cells: readonly Pos[]): Pos {
  let best = cells[0];
  for (let i = 1; i < cells.length; i++) {
    const candidate = cells[i];
    if (
      candidate.row < best.row ||
      (candidate.row === best.row && candidate.column < best.column)
    ) {
      best = candidate;
    }
  }
  return best;
}

function makeVisited(board: Board): boolean[][] {
  return board.map((row) => row.map(() => false));
}

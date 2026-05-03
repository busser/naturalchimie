// Spawn logic per docs/03-spawning.md. Pure functions: pool is
// derived from the board, samples advance the RNG explicitly so the
// core stays `(state, input, rng) → (state', steps, rng')`.

import { nextFloat, type Rng } from './rng';
import {
  SPAWN_COLUMN,
  type ActivePiece,
  type Board,
  type Piece,
  type Tier,
} from './state';

// Special items only roll when the playfield is sufficiently full.
const SPECIAL_ITEM_THRESHOLD = 20;
const DYNAMITE_PROBABILITY = 0.03;
const DETONATOR_PROBABILITY = 0.03;

const PLAYFIELD_HEIGHT = 7;
const PLAYFIELD_WIDTH = 7;

// `{1..min(11, max(2, highest_tier_on_board))}`. Empty board → {1, 2};
// gold (tier 12) is excluded by the upper clamp so the chain ends at
// tier 11.
export function computePool(board: Board): Tier[] {
  const max = Math.min(11, Math.max(2, highestTierOnBoard(board)));
  const pool: Tier[] = [];
  for (let t = 1; t <= max; t++) pool.push(t as Tier);
  return pool;
}

// Promote a freshly spawned `Piece` to an `ActivePiece` at the spawn
// column. Pairs always enter horizontal (the spec rules out
// pre-rotation in the spawn area); solo items enter at the same
// column as a horizontal pair's left half.
export function pieceToActive(piece: Piece): ActivePiece {
  switch (piece.kind) {
    case 'pair':
      return {
        kind: 'pair',
        column: SPAWN_COLUMN,
        orientation: 'horizontal',
        first: piece.first,
        second: piece.second,
      };
    case 'dynamite':
      return { kind: 'dynamite', column: SPAWN_COLUMN };
    case 'detonator':
      return { kind: 'detonator', column: SPAWN_COLUMN };
  }
}

export function samplePiece(board: Board, rng: Rng): [Piece, Rng] {
  // The kind roll only happens when the threshold is met; otherwise
  // we go straight to a pair draw without burning an RNG step. This
  // matches the pseudocode in 03-spawning.md and keeps the seeded
  // sequence stable across cells filling above the threshold.
  if (countOccupied(board) >= SPECIAL_ITEM_THRESHOLD) {
    const [roll, afterRoll] = nextFloat(rng);
    if (roll < DYNAMITE_PROBABILITY) {
      return [{ kind: 'dynamite' }, afterRoll];
    }
    if (roll < DYNAMITE_PROBABILITY + DETONATOR_PROBABILITY) {
      return [{ kind: 'detonator' }, afterRoll];
    }
    return samplePair(board, afterRoll);
  }
  return samplePair(board, rng);
}

function samplePair(board: Board, rng: Rng): [Piece, Rng] {
  const pool = computePool(board);
  const [first, afterFirst] = sampleTier(pool, rng);
  const [second, afterSecond] = sampleTier(pool, afterFirst);
  return [{ kind: 'pair', first, second }, afterSecond];
}

// weight(t) = max_tier - t + 1, so the lowest tier is the heaviest
// and weights decrease linearly. Drawn via cumulative weight against
// a single uniform roll.
function sampleTier(pool: Tier[], rng: Rng): [Tier, Rng] {
  const maxTier = pool[pool.length - 1];
  let totalWeight = 0;
  for (const t of pool) totalWeight += maxTier - t + 1;
  const [roll, nextRng] = nextFloat(rng);
  const target = roll * totalWeight;
  let cumulative = 0;
  for (const t of pool) {
    cumulative += maxTier - t + 1;
    if (target < cumulative) return [t, nextRng];
  }
  // nextFloat returns a value strictly < 1 so the loop above always
  // resolves; this fallback exists for the type checker.
  return [maxTier, nextRng];
}

function highestTierOnBoard(board: Board): number {
  let max = 0;
  for (const row of board) {
    for (const cell of row) {
      if (cell.kind === 'element' && cell.tier > max) max = cell.tier;
    }
  }
  return max;
}

// Threshold counts the playfield only (49 cells), not the overflow
// rows above it.
function countOccupied(board: Board): number {
  let count = 0;
  for (let r = 0; r < PLAYFIELD_HEIGHT; r++) {
    for (let c = 0; c < PLAYFIELD_WIDTH; c++) {
      if (board[r][c].kind !== 'empty') count++;
    }
  }
  return count;
}

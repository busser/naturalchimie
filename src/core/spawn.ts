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

// Combined chance of a special item on any draw. The two specials
// then split this band 50/50 via SPECIAL_ITEM_WEIGHTS.
const SPECIAL_ITEM_PROBABILITY = 0.05;

const SPECIAL_ITEM_WEIGHTS: { dynamite: number; detonator: number } = {
  dynamite: 1,
  detonator: 1,
};

// Per-tier weights from Naturalchimie 2 (findings.md:77). Indexed by
// tier - 1. Tier 12 (gold) has weight 0: it never spawns naturally
// and can only appear as the result of a tier-11 reaction. The pool
// already excludes tier 12 via the min(11, …) clamp, so the trailing
// zero is documentation more than algorithm.
const TIER_WEIGHTS: readonly number[] = [
  18, 18, 18, 18, 12, 8, 7, 5, 4, 1, 1, 0,
];

// `{1..min(11, max(3, highest_tier_on_board))}`. Empty board → {1, 2, 3};
// gold (tier 12) is excluded by the upper clamp so the chain ends at
// tier 11.
export function computePool(board: Board): Tier[] {
  const max = Math.min(11, Math.max(3, highestTierOnBoard(board)));
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
  const [kindRoll, afterKind] = nextFloat(rng);
  if (kindRoll < SPECIAL_ITEM_PROBABILITY) {
    return sampleSpecial(afterKind);
  }
  return samplePair(board, afterKind);
}

function sampleSpecial(rng: Rng): [Piece, Rng] {
  const total =
    SPECIAL_ITEM_WEIGHTS.dynamite + SPECIAL_ITEM_WEIGHTS.detonator;
  const [roll, nextRng] = nextFloat(rng);
  const target = roll * total;
  if (target < SPECIAL_ITEM_WEIGHTS.dynamite) {
    return [{ kind: 'dynamite' }, nextRng];
  }
  return [{ kind: 'detonator' }, nextRng];
}

function samplePair(board: Board, rng: Rng): [Piece, Rng] {
  const pool = computePool(board);
  const [first, afterFirst] = sampleTier(pool, rng);
  const [second, afterSecond] = sampleTier(pool, afterFirst);
  return [{ kind: 'pair', first, second }, afterSecond];
}

// Weighted draw against the static TIER_WEIGHTS table, restricted to
// tiers currently in the pool. Cumulative-weight roll against a
// single uniform sample.
function sampleTier(pool: Tier[], rng: Rng): [Tier, Rng] {
  let totalWeight = 0;
  for (const t of pool) totalWeight += TIER_WEIGHTS[t - 1];
  const [roll, nextRng] = nextFloat(rng);
  const target = roll * totalWeight;
  let cumulative = 0;
  for (const t of pool) {
    cumulative += TIER_WEIGHTS[t - 1];
    if (target < cumulative) return [t, nextRng];
  }
  // nextFloat returns a value strictly < 1 so the loop above always
  // resolves; this fallback exists for the type checker.
  return [pool[pool.length - 1], nextRng];
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

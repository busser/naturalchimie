import { describe, it, expect } from 'vitest';
import { parseBoard } from './board-text';
import { createRng, nextFloat, type Rng } from './rng';
import { computePool, samplePiece } from './spawn';
import type { Board, Cell, Piece, Tier } from './state';

const EMPTY_BOARD: Board = Array.from({ length: 9 }, () =>
  Array.from({ length: 7 }, (): Cell => ({ kind: 'empty' })),
);

describe('computePool', () => {
  it('returns {1, 2} on an empty board', () => {
    expect(computePool(EMPTY_BOARD)).toEqual([1, 2]);
  });

  it('still returns {1, 2} when only tier-1 elements are on the board', () => {
    const board = parseBoard(`
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      1 1 1 . . . .
    `);
    expect(computePool(board)).toEqual([1, 2]);
  });

  it('includes every tier up to the highest one on the board', () => {
    const board = parseBoard(`
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      1 . . 5 . . .
    `);
    expect(computePool(board)).toEqual([1, 2, 3, 4, 5]);
  });

  it('includes all intermediate tiers even when only the highest is on the board', () => {
    const board = parseBoard(`
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . 7 . . .
    `);
    expect(computePool(board)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('clamps the upper bound at 11 even when a gold nugget is on the board', () => {
    const board = parseBoard(`
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . C . . .
    `);
    expect(computePool(board)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it('shrinks back when the highest-tier element is no longer on the board', () => {
    const before = parseBoard(`
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . 5 . . .
    `);
    const after = parseBoard(`
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . 4 . . .
    `);
    expect(computePool(before)).toEqual([1, 2, 3, 4, 5]);
    expect(computePool(after)).toEqual([1, 2, 3, 4]);
  });
});

describe('samplePiece / pair generation', () => {
  it('never produces a detonator on an empty board', () => {
    // The detonator threshold still gates that branch, so an empty
    // board can only produce pairs or dynamite. Dynamite has no
    // threshold, so it is reachable here.
    for (let seed = 0; seed < 50; seed++) {
      const [piece] = samplePiece(EMPTY_BOARD, createRng(seed));
      expect(piece.kind).not.toBe('detonator');
    }
  });

  it('only produces tier-1 or tier-2 elements when a pair is sampled on an empty board', () => {
    // Dynamite can interrupt the pair stream at any time, so skip
    // non-pair draws and check the pool composition on the rest.
    let rng: Rng = createRng(7);
    for (let i = 0; i < 100; i++) {
      const [piece, next] = samplePiece(EMPTY_BOARD, rng);
      rng = next;
      if (piece.kind !== 'pair') continue;
      expect([1, 2]).toContain(piece.first);
      expect([1, 2]).toContain(piece.second);
    }
  });

  it('advances the RNG by three draws when producing a pair', () => {
    // The kind roll now fires on every draw (so dynamite is eligible
    // from the start), so a pair burns three RNG steps: one kind
    // roll plus two tier samples. Find a pair-producing seed first
    // since dynamite would short-circuit at one step.
    let rng: Rng = createRng(0);
    for (let attempt = 0; attempt < 50; attempt++) {
      const [piece, after] = samplePiece(EMPTY_BOARD, rng);
      if (piece.kind === 'pair') {
        const [, afterOne] = nextFloat(rng);
        const [, afterTwo] = nextFloat(afterOne);
        const [, afterThree] = nextFloat(afterTwo);
        expect(after).toEqual(afterThree);
        return;
      }
      rng = after;
    }
    throw new Error('expected to draw a pair within 50 attempts');
  });

  it('is deterministic for a given seed', () => {
    expect(drawSequence(EMPTY_BOARD, createRng(42), 10)).toEqual(
      drawSequence(EMPTY_BOARD, createRng(42), 10),
    );
  });

  it('produces different sequences for different seeds', () => {
    expect(drawSequence(EMPTY_BOARD, createRng(42), 10)).not.toEqual(
      drawSequence(EMPTY_BOARD, createRng(43), 10),
    );
  });

  it('weighted distribution favors lower tiers in a wider pool', () => {
    // With pool {1..5}, tier 1 has weight 5/15 ≈ 33% and tier 5 has
    // weight 1/15 ≈ 7%. Across 5000 samples, tier 1 must outnumber
    // tier 5 by a wide margin.
    const board = parseBoard(`
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . 5 . . .
    `);
    const counts = new Map<Tier, number>();
    let rng: Rng = createRng(2024);
    for (let i = 0; i < 5000; i++) {
      const [piece, next] = samplePiece(board, rng);
      rng = next;
      // Dynamite is eligible here too (no threshold) so skip
      // non-pair draws — they don't carry tiers to count.
      if (piece.kind !== 'pair') continue;
      counts.set(piece.first, (counts.get(piece.first) ?? 0) + 1);
      counts.set(piece.second, (counts.get(piece.second) ?? 0) + 1);
    }
    const tier1 = counts.get(1) ?? 0;
    const tier5 = counts.get(5) ?? 0;
    expect(tier1).toBeGreaterThan(tier5 * 3);
    // All five tiers must appear at least once.
    for (const t of [1, 2, 3, 4, 5] as const) {
      expect(counts.get(t)).toBeGreaterThan(0);
    }
  });

  it('never produces tier 12 even when a gold nugget is on the board', () => {
    const board = parseBoard(`
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . C . . .
    `);
    let rng: Rng = createRng(99);
    for (let i = 0; i < 200; i++) {
      const [piece, next] = samplePiece(board, rng);
      rng = next;
      if (piece.kind !== 'pair') continue;
      expect(piece.first).not.toBe(12);
      expect(piece.second).not.toBe(12);
    }
  });
});

describe('samplePiece / special items', () => {
  it('does not produce a detonator below the 20-cell threshold', () => {
    // The threshold gates only the detonator branch. Dynamite is
    // always eligible, so we expect a mix of pairs and dynamite at
    // 19 occupied cells but never a detonator.
    const board = boardWithOccupiedCount(19);
    for (let seed = 0; seed < 100; seed++) {
      const [piece] = samplePiece(board, createRng(seed));
      expect(piece.kind).not.toBe('detonator');
    }
  });

  it('can produce a dynamite when the board is sufficiently full', () => {
    const board = boardWithOccupiedCount(25);
    const kinds = new Set<Piece['kind']>();
    let rng: Rng = createRng(1);
    for (let i = 0; i < 2000 && kinds.size < 3; i++) {
      const [piece, next] = samplePiece(board, rng);
      rng = next;
      kinds.add(piece.kind);
    }
    expect(kinds.has('pair')).toBe(true);
    expect(kinds.has('dynamite')).toBe(true);
    expect(kinds.has('detonator')).toBe(true);
  });

  it('produces special items at roughly the spec rate when eligible', () => {
    const board = boardWithOccupiedCount(25);
    let dynamite = 0;
    let detonator = 0;
    let pair = 0;
    let rng: Rng = createRng(2026);
    const trials = 20000;
    for (let i = 0; i < trials; i++) {
      const [piece, next] = samplePiece(board, rng);
      rng = next;
      if (piece.kind === 'dynamite') dynamite++;
      else if (piece.kind === 'detonator') detonator++;
      else pair++;
    }
    // Tuning values: dynamite 0.10, detonator 0.03, pair 0.87. Wide
    // tolerance so the test isn't seed-fragile, but tight enough to
    // catch a swapped or dropped branch.
    expect(dynamite / trials).toBeGreaterThan(0.09);
    expect(dynamite / trials).toBeLessThan(0.11);
    expect(detonator / trials).toBeGreaterThan(0.02);
    expect(detonator / trials).toBeLessThan(0.04);
    expect(pair / trials).toBeGreaterThan(0.85);
  });

  it('advances the RNG by one draw when producing a special item', () => {
    // Find a seed that produces a special item on the first draw of a
    // sufficiently full board, then confirm the returned RNG is the
    // one-step advance of the input.
    const board = boardWithOccupiedCount(25);
    let rng: Rng = createRng(0);
    for (let attempt = 0; attempt < 200; attempt++) {
      const [piece, next] = samplePiece(board, rng);
      if (piece.kind === 'dynamite' || piece.kind === 'detonator') {
        const [, afterOne] = nextFloat(rng);
        expect(next).toEqual(afterOne);
        return;
      }
      rng = next;
    }
    throw new Error('expected to draw a special item within 200 attempts');
  });
});

function drawSequence(board: Board, rng: Rng, n: number): Piece[] {
  const out: Piece[] = [];
  let current = rng;
  for (let i = 0; i < n; i++) {
    const [piece, next] = samplePiece(board, current);
    out.push(piece);
    current = next;
  }
  return out;
}

// Builds a 9-row board with `count` occupied playfield cells, all
// tier 1 (so the pool stays {1, 2} and pair draws are unaffected).
function boardWithOccupiedCount(count: number): Board {
  const rows: Cell[][] = Array.from({ length: 9 }, () =>
    Array.from({ length: 7 }, (): Cell => ({ kind: 'empty' })),
  );
  let placed = 0;
  for (let r = 0; r < 7 && placed < count; r++) {
    for (let c = 0; c < 7 && placed < count; c++) {
      rows[r][c] = { kind: 'element', tier: 1 };
      placed++;
    }
  }
  return rows;
}

import { describe, it, expect } from 'vitest';
import { parseBoard } from './board-text';
import { createRng, nextFloat, type Rng } from './rng';
import { computePool, samplePiece } from './spawn';
import type { Board, Cell, Piece, Tier } from './state';

const EMPTY_BOARD: Board = Array.from({ length: 9 }, () =>
  Array.from({ length: 7 }, (): Cell => ({ kind: 'empty' })),
);

describe('computePool', () => {
  it('returns {1, 2, 3} on an empty board', () => {
    expect(computePool(EMPTY_BOARD)).toEqual([1, 2, 3]);
  });

  it('still returns {1, 2, 3} when only tier-1 elements are on the board', () => {
    const board = parseBoard(`
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      1 1 1 . . . .
    `);
    expect(computePool(board)).toEqual([1, 2, 3]);
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
  it('only produces tier-1, tier-2, or tier-3 elements on an empty board', () => {
    let rng: Rng = createRng(7);
    for (let i = 0; i < 200; i++) {
      const [piece, next] = samplePiece(EMPTY_BOARD, rng);
      rng = next;
      if (piece.kind !== 'pair') continue;
      expect([1, 2, 3]).toContain(piece.first);
      expect([1, 2, 3]).toContain(piece.second);
    }
  });

  it('advances the RNG by exactly three draws when producing a pair', () => {
    // Find a seed that produces a pair on the first sample, then
    // confirm the returned RNG matches three nextFloat advances
    // (1 kind roll + 2 tier rolls).
    let rng: Rng = createRng(0);
    for (let attempt = 0; attempt < 200; attempt++) {
      const [piece, next] = samplePiece(EMPTY_BOARD, rng);
      if (piece.kind === 'pair') {
        const [, a1] = nextFloat(rng);
        const [, a2] = nextFloat(a1);
        const [, a3] = nextFloat(a2);
        expect(next).toEqual(a3);
        return;
      }
      rng = next;
    }
    throw new Error('expected to draw a pair within 200 attempts');
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

  it('matches the NC2 weight table at pool {1..5}', () => {
    // Weights [18, 18, 18, 18, 12], sum = 84. Bottom four tiers
    // should each be ~21.4%, tier 5 ~14.3%. Across 10000 pair draws
    // (20000 element samples) the bottom four tiers must dominate
    // tier 5 and be roughly equal to each other.
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
    for (let i = 0; i < 10000; i++) {
      const [piece, next] = samplePiece(board, rng);
      rng = next;
      if (piece.kind !== 'pair') continue;
      counts.set(piece.first, (counts.get(piece.first) ?? 0) + 1);
      counts.set(piece.second, (counts.get(piece.second) ?? 0) + 1);
    }
    const total = Array.from(counts.values()).reduce((a, b) => a + b, 0);
    for (const t of [1, 2, 3, 4, 5] as const) {
      expect(counts.get(t)).toBeGreaterThan(0);
    }
    // Bottom four tiers all in [18%, 25%] (expected 21.4%).
    for (const t of [1, 2, 3, 4] as const) {
      const share = (counts.get(t) ?? 0) / total;
      expect(share).toBeGreaterThan(0.18);
      expect(share).toBeLessThan(0.25);
    }
    // Tier 5 in [11%, 17%] (expected 14.3%).
    const tier5Share = (counts.get(5) ?? 0) / total;
    expect(tier5Share).toBeGreaterThan(0.11);
    expect(tier5Share).toBeLessThan(0.17);
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
  it('can produce a special item on an empty board (no fill gate)', () => {
    const kinds = new Set<Piece['kind']>();
    let rng: Rng = createRng(1);
    for (let i = 0; i < 5000 && kinds.size < 3; i++) {
      const [piece, next] = samplePiece(EMPTY_BOARD, rng);
      rng = next;
      kinds.add(piece.kind);
    }
    expect(kinds.has('pair')).toBe(true);
    expect(kinds.has('dynamite')).toBe(true);
    expect(kinds.has('detonator')).toBe(true);
  });

  it('produces special items at roughly the spec rate', () => {
    let dynamite = 0;
    let detonator = 0;
    let pair = 0;
    let rng: Rng = createRng(2026);
    const trials = 30000;
    for (let i = 0; i < trials; i++) {
      const [piece, next] = samplePiece(EMPTY_BOARD, rng);
      rng = next;
      if (piece.kind === 'dynamite') dynamite++;
      else if (piece.kind === 'detonator') detonator++;
      else pair++;
    }
    // Spec values: dynamite 0.025, detonator 0.025, pair 0.95.
    // Wide tolerance so the test isn't seed-fragile, but tight enough
    // to catch a swapped or dropped branch.
    expect(dynamite / trials).toBeGreaterThan(0.015);
    expect(dynamite / trials).toBeLessThan(0.035);
    expect(detonator / trials).toBeGreaterThan(0.015);
    expect(detonator / trials).toBeLessThan(0.035);
    expect(pair / trials).toBeGreaterThan(0.93);
  });

  it('advances the RNG by two draws when producing a special item', () => {
    // Find a seed that produces a special item on the first sample,
    // then confirm the returned RNG matches two nextFloat advances
    // (1 kind roll + 1 dynamite-vs-detonator roll).
    let rng: Rng = createRng(0);
    for (let attempt = 0; attempt < 500; attempt++) {
      const [piece, next] = samplePiece(EMPTY_BOARD, rng);
      if (piece.kind === 'dynamite' || piece.kind === 'detonator') {
        const [, a1] = nextFloat(rng);
        const [, a2] = nextFloat(a1);
        expect(next).toEqual(a2);
        return;
      }
      rng = next;
    }
    throw new Error('expected to draw a special item within 500 attempts');
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

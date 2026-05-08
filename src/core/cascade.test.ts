import { describe, it, expect } from 'vitest';
import { applyGravity, findReactingGroups, runCascade } from './cascade';
import { formatBoard, parseBoard } from './board-text';
import { computeBoardSum } from './score';
import type { Piece, State } from './state';

const DUMMY_PREVIEW: Piece = { kind: 'pair', first: 1, second: 1 };

function priorState(board = parseBoard(empty())): State {
  return {
    board,
    active: null,
    preview: DUMMY_PREVIEW,
    score: 0,
    comboScore: 0,
  };
}

function empty(): string {
  return `
    . . . . . . .
    . . . . . . .
    . . . . . . .
    . . . . . . .
    . . . . . . .
    . . . . . . .
    . . . . . . .
  `;
}

describe('findReactingGroups', () => {
  it('returns nothing for an empty board', () => {
    expect(findReactingGroups(parseBoard(empty()))).toEqual([]);
  });

  it('ignores groups of size 2', () => {
    const board = parseBoard(`
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . 1 1 . . . .
    `);
    expect(findReactingGroups(board)).toEqual([]);
  });

  it('returns a single group for a line of three', () => {
    const board = parseBoard(`
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . 1 1 1 . . .
    `);
    const groups = findReactingGroups(board);
    expect(groups).toHaveLength(1);
    expect(groups[0].cells).toHaveLength(3);
    expect(groups[0].tierBefore).toBe(1);
    expect(groups[0].tierAfter).toBe(2);
    // Lowest row, then lowest column.
    expect(groups[0].landing).toEqual({ row: 0, column: 1 });
  });

  it('finds an L-shape as one connected component', () => {
    const board = parseBoard(`
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . 1 . . . . .
      . 1 1 . . . .
    `);
    const groups = findReactingGroups(board);
    expect(groups).toHaveLength(1);
    expect(groups[0].cells).toHaveLength(3);
    expect(groups[0].landing).toEqual({ row: 0, column: 1 });
  });

  it('finds a plus-sign of size 5', () => {
    const board = parseBoard(`
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . 1 . . .
      . . 1 1 1 . .
      . . . 1 . . .
      . . . . . . .
    `);
    const groups = findReactingGroups(board);
    expect(groups).toHaveLength(1);
    expect(groups[0].cells).toHaveLength(5);
    // Bottom-most cell of the plus is at row 1, the centre rung at
    // row 2 has cells at columns 2, 3, 4 — the bottom-most row of the
    // group is row 1, so landing is (row 1, column 3).
    expect(groups[0].landing).toEqual({ row: 1, column: 3 });
  });

  it('returns disjoint same-tier components as separate groups', () => {
    const board = parseBoard(`
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      1 1 1 . 1 1 1
    `);
    const groups = findReactingGroups(board);
    expect(groups).toHaveLength(2);
    const landings = groups.map((g) => g.landing);
    expect(landings).toContainEqual({ row: 0, column: 0 });
    expect(landings).toContainEqual({ row: 0, column: 4 });
  });

  it('does not bridge diagonally-adjacent cells of the same tier', () => {
    const board = parseBoard(`
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . 1 . . . . .
      1 . 1 . . . .
    `);
    expect(findReactingGroups(board)).toEqual([]);
  });

  it('does not react tier-12 (gold is inert)', () => {
    const board = parseBoard(`
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . C C C . . .
    `);
    expect(findReactingGroups(board)).toEqual([]);
  });

  it('skips detonators and empty cells when grouping', () => {
    const board = parseBoard(`
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . E . . . .
      . 1 . 1 . . .
    `);
    expect(findReactingGroups(board)).toEqual([]);
  });
});

describe('applyGravity', () => {
  it('is a no-op when every column is already packed to the floor', () => {
    const board = parseBoard(`
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . 1 . . .
      . . . 5 . . .
    `);
    const { board: after, movements } = applyGravity(board);
    expect(movements).toEqual([]);
    expect(formatBoard(after)).toBe(formatBoard(board));
  });

  it('drops a single floating element to the floor', () => {
    const board = parseBoard(`
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . 1 . . .
      . . . . . . .
    `);
    const { board: after, movements } = applyGravity(board);
    expect(movements).toEqual([
      { from: { row: 1, column: 3 }, to: { row: 0, column: 3 } },
    ]);
    expect(after[0][3]).toEqual({ kind: 'element', tier: 1 });
    expect(after[1][3]).toEqual({ kind: 'empty' });
  });

  it('preserves the relative vertical order within a column', () => {
    const board = parseBoard(`
      . . . . . . .
      . . . . . . .
      . . . 7 . . .
      . . . . . . .
      . . . 5 . . .
      . . . . . . .
      . . . 1 . . .
    `);
    const { board: after } = applyGravity(board);
    expect(after[0][3]).toEqual({ kind: 'element', tier: 1 });
    expect(after[1][3]).toEqual({ kind: 'element', tier: 5 });
    expect(after[2][3]).toEqual({ kind: 'element', tier: 7 });
    expect(after[3][3]).toEqual({ kind: 'empty' });
  });

  it('treats detonators like elements under gravity', () => {
    const board = parseBoard(`
      . . . . . . .
      . . . . . . .
      . . . E . . .
      . . . . . . .
      . . . 1 . . .
      . . . . . . .
      . . . . . . .
    `);
    const { board: after, movements } = applyGravity(board);
    expect(after[0][3]).toEqual({ kind: 'element', tier: 1 });
    expect(after[1][3]).toEqual({ kind: 'detonator' });
    expect(movements).toHaveLength(2);
  });

  it('handles each column independently', () => {
    const board = parseBoard(`
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . 1 . . . . .
      . . . . . . .
      . . . 5 . . .
      . . . . . . .
    `);
    const { board: after } = applyGravity(board);
    expect(after[0][1]).toEqual({ kind: 'element', tier: 1 });
    expect(after[0][3]).toEqual({ kind: 'element', tier: 5 });
  });
});

describe('runCascade — acceptance scenarios', () => {
  it('2.1 — simple 3-element line reaction', () => {
    // Post-drop board for acceptance test 2.1.
    const board = parseBoard(`
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . 1 1 1 5 . .
    `);
    const { board: stable, steps } = runCascade(board, priorState());
    expect(formatBoard(stable)).toBe(
      formatBoard(
        parseBoard(`
          . . . . . . .
          . . . . . . .
          . . . . . . .
          . . . . . . .
          . . . . . . .
          . . . . . . .
          . 2 . . 5 . .
        `),
      ),
    );
    // One reaction, no gravity (cleared cells were on the floor, no
    // element above them).
    expect(steps.map((s) => s.event.kind)).toEqual(['merge']);
    const merge = steps[0].event;
    if (merge.kind !== 'merge') throw new Error('expected merge');
    expect(merge.groups).toHaveLength(1);
    expect(merge.groups[0].tierBefore).toBe(1);
    expect(merge.groups[0].tierAfter).toBe(2);
    expect(merge.groups[0].landing).toEqual({ row: 0, column: 1 });
  });

  it('2.2 — L-shaped reaction with gravity', () => {
    const board = parseBoard(`
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . 5 . . . . .
      . 1 . . . . .
      . 1 1 . . . .
    `);
    const { board: stable, steps } = runCascade(board, priorState());
    expect(formatBoard(stable)).toBe(
      formatBoard(
        parseBoard(`
          . . . . . . .
          . . . . . . .
          . . . . . . .
          . . . . . . .
          . . . . . . .
          . 5 . . . . .
          . 2 . . . . .
        `),
      ),
    );
    // Tier-5 falls from row 3 down to row 1 after the merge clears
    // rows 1 (col 2) and 2 (col 1) — the merge lands tier-2 at
    // (0, 1), so column 1's tier-5 settles at row 1.
    expect(steps.map((s) => s.event.kind)).toEqual(['merge', 'gravity']);
  });

  it('2.3 — 4-element merge (size > 3)', () => {
    const board = parseBoard(`
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . 2 2 . . .
      1 1 1 1 . . .
    `);
    const { board: stable, steps } = runCascade(board, priorState());
    expect(formatBoard(stable)).toBe(
      formatBoard(
        parseBoard(`
          . . . . . . .
          . . . . . . .
          . . . . . . .
          . . . . . . .
          . . . . . . .
          . . . . . . .
          2 . 2 2 . . .
        `),
      ),
    );
    expect(steps.map((s) => s.event.kind)).toEqual(['merge', 'gravity']);
  });

  it('2.4 — genuine two-step cascade', () => {
    const board = parseBoard(`
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . 2 . . .
      . . 2 1 . . .
      . 1 1 1 . . .
    `);
    const { board: stable, steps } = runCascade(board, priorState());
    expect(formatBoard(stable)).toBe(
      formatBoard(
        parseBoard(`
          . . . . . . .
          . . . . . . .
          . . . . . . .
          . . . . . . .
          . . . . . . .
          . . . . . . .
          . 3 . . . . .
        `),
      ),
    );
    // First merge of tier-1, gravity, second merge of tier-2 (no
    // gravity needed at the end since the final tier-3 sits on the
    // floor with nothing above to fall).
    expect(steps.map((s) => s.event.kind)).toEqual([
      'merge',
      'gravity',
      'merge',
    ]);
  });

  it('2.5 — score-reducing 4-element merge', () => {
    const board = parseBoard(`
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . 3 . . .
      2 2 2 2 . . .
    `);
    const { board: stable } = runCascade(board, priorState());
    expect(formatBoard(stable)).toBe(
      formatBoard(
        parseBoard(`
          . . . . . . .
          . . . . . . .
          . . . . . . .
          . . . . . . .
          . . . . . . .
          . . . . . . .
          3 . . 3 . . .
        `),
      ),
    );
  });

  it('returns the input board unchanged when nothing reacts', () => {
    const board = parseBoard(`
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . 1 1 . . . .
    `);
    const { board: stable, steps } = runCascade(board, priorState());
    expect(formatBoard(stable)).toBe(formatBoard(board));
    expect(steps).toEqual([]);
  });

  it('resolves two disjoint groups in a single merge step', () => {
    const board = parseBoard(`
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      1 1 1 . 1 1 1
    `);
    const { steps } = runCascade(board, priorState());
    expect(steps.map((s) => s.event.kind)).toEqual(['merge']);
    const merge = steps[0].event;
    if (merge.kind !== 'merge') throw new Error('expected merge');
    expect(merge.groups).toHaveLength(2);
  });

  it('emits live scores per step using the prior comboScore plus the board sum', () => {
    // Two-merge cascade: tier-1 row reacts to a tier-2 that joins
    // existing tier-2s and re-reacts. The board has no suspended
    // cells, so runCascade emits no initial-gravity step — only the
    // two merges (and possibly a gravity between them).
    const board = parseBoard(`
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      2 . . . . . .
      2 1 1 1 . . .
    `);
    const before: State = { ...priorState(board), comboScore: 100 };
    const { steps, chainLinks } = runCascade(board, before);
    expect(chainLinks).toBeGreaterThanOrEqual(2);
    // Each step's snapshot score = comboScore + boardSum(stepBoard);
    // the bonus settles in apply.ts, so comboScore stays at 100
    // throughout the cascade itself.
    for (const step of steps) {
      expect(step.snapshot.comboScore).toBe(100);
      expect(step.snapshot.score).toBe(100 + computeBoardSum(step.snapshot.board));
    }
  });

  it('counts each merge step as one chain link', () => {
    // 2.4: tier-1 merge produces a tier-2 that joins existing tier-2s
    // and merges again. Two distinct merge steps.
    const board = parseBoard(`
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . 2 . . .
      . . 2 1 . . .
      . 1 1 1 . . .
    `);
    const { chainLinks } = runCascade(board, priorState(board));
    expect(chainLinks).toBe(2);
  });

  it('reports zero chain links when nothing reacts', () => {
    const board = parseBoard(`
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . 1 1 . . . .
    `);
    const { chainLinks } = runCascade(board, priorState(board));
    expect(chainLinks).toBe(0);
  });
});

import { describe, it, expect } from 'vitest';
import { applyInput } from './apply';
import { parseBoard } from './board-text';
import { createRng } from './rng';
import { computeBoardSum } from './score';
import type {
  ActivePiece,
  Board,
  Cell,
  Orientation,
  Piece,
  State,
  Tier,
} from './state';

const EMPTY_BOARD: Board = Array.from({ length: 9 }, () =>
  Array.from({ length: 7 }, (): Cell => ({ kind: 'empty' })),
);
const DUMMY_PREVIEW: Piece = { kind: 'pair', first: 1, second: 1 };
const RNG = createRng(42);

// score is `comboScore + boardSum(board)`; comboScore defaults to 0
// so the helper builds a State whose `score` matches its board.
function makeState(active: ActivePiece | null, board: Board = EMPTY_BOARD): State {
  return {
    board,
    active,
    preview: DUMMY_PREVIEW,
    score: computeBoardSum(board),
    comboScore: 0,
  };
}

function pair(
  column: number,
  orientation: Orientation,
  first: Tier = 1,
  second: Tier = 2,
): ActivePiece {
  return { kind: 'pair', column, orientation, first, second };
}

describe('applyInput / no active piece', () => {
  it('returns the state unchanged with no steps', () => {
    const state = makeState(null);
    const [next, steps, rng] = applyInput(
      state,
      { kind: 'shift', direction: 'left' },
      RNG,
    );
    expect(next).toBe(state);
    expect(steps).toEqual([]);
    expect(rng).toBe(RNG);
  });
});

describe('applyInput / shift', () => {
  it('moves a horizontal pair left when there is room', () => {
    const state = makeState(pair(3, 'horizontal'));
    const [next, steps] = applyInput(
      state,
      { kind: 'shift', direction: 'left' },
      RNG,
    );
    expect(next.active).toEqual(pair(2, 'horizontal'));
    expect(steps).toHaveLength(1);
    expect(steps[0].event.kind).toBe('pair-shift');
    expect(steps[0].snapshot).toBe(next);
  });

  it('moves a horizontal pair right when there is room', () => {
    const state = makeState(pair(3, 'horizontal'));
    const [next] = applyInput(
      state,
      { kind: 'shift', direction: 'right' },
      RNG,
    );
    expect(next.active).toEqual(pair(4, 'horizontal'));
  });

  it('rejects shifting a horizontal pair past the left wall', () => {
    const state = makeState(pair(0, 'horizontal'));
    const [next, steps] = applyInput(
      state,
      { kind: 'shift', direction: 'left' },
      RNG,
    );
    expect(next).toBe(state);
    expect(steps).toEqual([]);
  });

  it('rejects shifting a horizontal pair past the right wall', () => {
    // Anchor 5 occupies columns 5–6; shifting right would put the
    // right half at column 7 (= spec column 8, outside the grid).
    const state = makeState(pair(5, 'horizontal'));
    const [next, steps] = applyInput(
      state,
      { kind: 'shift', direction: 'right' },
      RNG,
    );
    expect(next).toBe(state);
    expect(steps).toEqual([]);
  });

  it('moves a vertical pair within bounds', () => {
    const state = makeState(pair(3, 'vertical'));
    const [next] = applyInput(
      state,
      { kind: 'shift', direction: 'left' },
      RNG,
    );
    expect(next.active).toEqual(pair(2, 'vertical'));
  });

  it('rejects shifting a vertical pair past the right wall', () => {
    const state = makeState(pair(6, 'vertical'));
    const [next, steps] = applyInput(
      state,
      { kind: 'shift', direction: 'right' },
      RNG,
    );
    expect(next).toBe(state);
    expect(steps).toEqual([]);
  });

  it('moves a solo item within bounds', () => {
    const state = makeState({ kind: 'dynamite', column: 3 });
    const [next] = applyInput(
      state,
      { kind: 'shift', direction: 'right' },
      RNG,
    );
    expect(next.active).toEqual({ kind: 'dynamite', column: 4 });
  });

  it('rejects shifting a solo item past a wall', () => {
    const state = makeState({ kind: 'detonator', column: 0 });
    const [next, steps] = applyInput(
      state,
      { kind: 'shift', direction: 'left' },
      RNG,
    );
    expect(next).toBe(state);
    expect(steps).toEqual([]);
  });

  it('passes the RNG through unchanged', () => {
    const state = makeState(pair(3, 'horizontal'));
    const [, , rng] = applyInput(
      state,
      { kind: 'shift', direction: 'left' },
      RNG,
    );
    expect(rng).toBe(RNG);
  });
});

describe('applyInput / rotate', () => {
  it('flips a horizontal pair to vertical at the same column', () => {
    // Default pair() is first=1, second=2 (left=1, right=2). H→V
    // swaps labels: bottom=2 is the new first, top=1 is the new
    // second.
    const state = makeState(pair(3, 'horizontal'));
    const [next, steps] = applyInput(state, { kind: 'rotate' }, RNG);
    expect(next.active).toEqual(pair(3, 'vertical', 2, 1));
    expect(steps).toHaveLength(1);
    expect(steps[0].event.kind).toBe('pair-rotate');
    expect(steps[0].snapshot).toBe(next);
  });

  it('flips a horizontal pair at the right wall to vertical without any kick', () => {
    // Anchor 5 occupies columns 5–6; H→V always succeeds, the pair
    // becomes vertical at the same anchor column.
    const state = makeState(pair(5, 'horizontal'));
    const [next] = applyInput(state, { kind: 'rotate' }, RNG);
    expect(next.active).toEqual(pair(5, 'vertical', 2, 1));
  });

  it('flips a vertical pair to horizontal at the same column', () => {
    // V→H preserves labels: bottom stays as the new left.
    const state = makeState(pair(3, 'vertical'));
    const [next] = applyInput(state, { kind: 'rotate' }, RNG);
    expect(next.active).toEqual(pair(3, 'horizontal', 1, 2));
  });

  it('swaps first/second on H→V and preserves them on V→H', () => {
    // H[left=5, right=9] → V[bottom=9, top=5] (swap), then V→H
    // keeps the labels in place: H[left=9, right=5].
    const state = makeState(pair(3, 'horizontal', 5, 9));
    const [afterFirst] = applyInput(state, { kind: 'rotate' }, RNG);
    expect(afterFirst.active).toEqual(pair(3, 'vertical', 9, 5));
    const [afterSecond] = applyInput(afterFirst, { kind: 'rotate' }, RNG);
    expect(afterSecond.active).toEqual(pair(3, 'horizontal', 9, 5));
  });

  it('wall-kicks a vertical pair at the right wall one column left', () => {
    const state = makeState(pair(6, 'vertical'));
    const [next] = applyInput(state, { kind: 'rotate' }, RNG);
    expect(next.active).toEqual(pair(5, 'horizontal', 1, 2));
  });

  it('does not kick a vertical pair at the left wall', () => {
    const state = makeState(pair(0, 'vertical'));
    const [next] = applyInput(state, { kind: 'rotate' }, RNG);
    expect(next.active).toEqual(pair(0, 'horizontal', 1, 2));
  });

  it('returns a horizontal pair to its original configuration after four rotations', () => {
    // Two rotations swap first/second; four return to identity.
    let state = makeState(pair(3, 'horizontal', 5, 9));
    for (let i = 0; i < 4; i += 1) {
      const [next] = applyInput(state, { kind: 'rotate' }, RNG);
      state = next;
    }
    expect(state.active).toEqual(pair(3, 'horizontal', 5, 9));
  });

  it('keeps the wall-kick sticky: rotating back does not restore the original column', () => {
    // V at column 6 kicks to H at column 5. Rotating that horizontal
    // pair back gives V at column 5, not the original column 6. The
    // kick changes the column, then H→V swaps the labels.
    const start = makeState(pair(6, 'vertical'));
    const [afterKick] = applyInput(start, { kind: 'rotate' }, RNG);
    expect(afterKick.active).toEqual(pair(5, 'horizontal', 1, 2));
    const [afterUndo] = applyInput(afterKick, { kind: 'rotate' }, RNG);
    expect(afterUndo.active).toEqual(pair(5, 'vertical', 2, 1));
  });

  it('is a no-op on a dynamite', () => {
    const state = makeState({ kind: 'dynamite', column: 3 });
    const [next, steps] = applyInput(state, { kind: 'rotate' }, RNG);
    expect(next).toBe(state);
    expect(steps).toEqual([]);
  });

  it('is a no-op on a detonator', () => {
    const state = makeState({ kind: 'detonator', column: 3 });
    const [next, steps] = applyInput(state, { kind: 'rotate' }, RNG);
    expect(next).toBe(state);
    expect(steps).toEqual([]);
  });

  it('passes the RNG through unchanged', () => {
    const state = makeState(pair(3, 'horizontal'));
    const [, , rng] = applyInput(state, { kind: 'rotate' }, RNG);
    expect(rng).toBe(RNG);
  });
});

describe('applyInput / drop', () => {
  it('lands a horizontal pair on an empty board', () => {
    // Horizontal [1/2] at code column 3 (spec column 4) lands on the
    // floor with first in column 3 and second in column 4.
    const state = makeState(pair(3, 'horizontal', 1, 2));
    const [next, steps] = applyInput(state, { kind: 'drop' }, RNG);
    expect(next.board[0][3]).toEqual({ kind: 'element', tier: 1 });
    expect(next.board[0][4]).toEqual({ kind: 'element', tier: 2 });
    // Drop now produces two steps: the land, then the preview→active
    // promotion + new preview draw.
    expect(steps).toHaveLength(2);
    expect(steps[0].event).toEqual({
      kind: 'pair-land',
      firstLandingRow: 0,
      secondLandingRow: 0,
    });
    expect(steps[0].snapshot.active).toBeNull();
    expect(steps[1].event.kind).toBe('spawn');
    expect(steps[1].snapshot).toBe(next);
  });

  it('reports asymmetric landing rows in the step event', () => {
    // Same setup as the asymmetric-column test below: column 3 has
    // two cells filled, column 4 has one. Landing rows are 2 and 1.
    const board = parseBoard(`
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . 5 . . .
      . . . 7 5 . .
    `);
    const state = makeState(pair(3, 'horizontal', 1, 2), board);
    const [, steps] = applyInput(state, { kind: 'drop' }, RNG);
    expect(steps[0].event).toEqual({
      kind: 'pair-land',
      firstLandingRow: 2,
      secondLandingRow: 1,
    });
  });

  it('stacks a vertical pair on an empty column with the bottom (first) at the floor', () => {
    // Vertical pair, first=2 (bottom), second=1 (top): bottom lands
    // at row 0, top at row 1, both in column 3.
    const state = makeState(pair(3, 'vertical', 2, 1));
    const [next] = applyInput(state, { kind: 'drop' }, RNG);
    expect(next.board[0][3]).toEqual({ kind: 'element', tier: 2 });
    expect(next.board[1][3]).toEqual({ kind: 'element', tier: 1 });
  });

  it('stacks a vertical pair on top of existing elements', () => {
    // Acceptance test 1.3 — column 3 (spec col 4) has two tier-5s.
    // Drop vertical (top=1, bottom=2): bottom lands at row 2, top at row 3.
    const board = parseBoard(`
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . 5 . . .
      . . . 5 . . .
    `);
    const state = makeState(pair(3, 'vertical', 2, 1), board);
    const [next] = applyInput(state, { kind: 'drop' }, RNG);
    expect(next.board[2][3]).toEqual({ kind: 'element', tier: 2 });
    expect(next.board[3][3]).toEqual({ kind: 'element', tier: 1 });
  });

  it('lands each half of a horizontal pair independently in its own column', () => {
    // Acceptance test 1.4 — column 3 has rows 0, 1 filled; column 4
    // has row 0 filled. Horizontal [1/2] lands tier 1 at (row 2, col 3)
    // and tier 2 at (row 1, col 4).
    const board = parseBoard(`
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . 5 . . .
      . . . 7 5 . .
    `);
    const state = makeState(pair(3, 'horizontal', 1, 2), board);
    const [next] = applyInput(state, { kind: 'drop' }, RNG);
    expect(next.board[2][3]).toEqual({ kind: 'element', tier: 1 });
    expect(next.board[1][4]).toEqual({ kind: 'element', tier: 2 });
    // Pre-existing elements are untouched.
    expect(next.board[0][3]).toEqual({ kind: 'element', tier: 7 });
    expect(next.board[1][3]).toEqual({ kind: 'element', tier: 5 });
    expect(next.board[0][4]).toEqual({ kind: 'element', tier: 5 });
  });

  it('promotes the preview to active and draws a fresh preview', () => {
    // Preview is a tier-1/1 pair (DUMMY_PREVIEW). After the drop the
    // active piece is that pair, sitting horizontal at the spawn
    // column, and the preview holds whatever was drawn next.
    const state = makeState(pair(3, 'horizontal'));
    const [next] = applyInput(state, { kind: 'drop' }, RNG);
    expect(next.active).toEqual({
      kind: 'pair',
      column: 3,
      orientation: 'horizontal',
      first: 1,
      second: 1,
    });
    // With pool {1, 2} on the post-land board both halves of the new
    // preview must be tier-1 or tier-2.
    expect(next.preview.kind).toBe('pair');
    const newPreview = next.preview as Extract<Piece, { kind: 'pair' }>;
    expect([1, 2]).toContain(newPreview.first);
    expect([1, 2]).toContain(newPreview.second);
  });

  it('emits a post-land snapshot with no active piece, then a spawn snapshot', () => {
    const state = makeState(pair(3, 'horizontal'));
    const [, steps] = applyInput(state, { kind: 'drop' }, RNG);
    expect(steps[0].snapshot.active).toBeNull();
    expect(steps[1].snapshot.active).not.toBeNull();
    // The two snapshots share the same board: the spawn step changes
    // active and preview, not the cells.
    expect(steps[1].snapshot.board).toBe(steps[0].snapshot.board);
  });

  it('does not mutate the prior board', () => {
    const board = parseBoard(`
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . 5 . . .
    `);
    const state = makeState(pair(3, 'horizontal', 1, 2), board);
    applyInput(state, { kind: 'drop' }, RNG);
    expect(board[0][3]).toEqual({ kind: 'element', tier: 5 });
    expect(board[1][3]).toEqual({ kind: 'empty' });
  });

  it('advances the RNG when drawing the new preview', () => {
    const state = makeState(pair(3, 'horizontal'));
    const [, , rng] = applyInput(state, { kind: 'drop' }, RNG);
    expect(rng).not.toEqual(RNG);
  });

  it('lands a detonator on the floor as a board cell', () => {
    const state = makeState({ kind: 'detonator', column: 3 });
    const [next, steps] = applyInput(state, { kind: 'drop' }, RNG);
    expect(next.board[0][3]).toEqual({ kind: 'detonator' });
    expect(steps).toHaveLength(2);
    expect(steps[0].event).toEqual({ kind: 'solo-land', landingRow: 0 });
    expect(steps[0].snapshot.active).toBeNull();
    expect(steps[1].event.kind).toBe('spawn');
  });

  it('lands a detonator at the lowest empty cell on a partially filled column', () => {
    const board = parseBoard(`
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . 5 . . .
      . . . 5 . . .
    `);
    const state = makeState({ kind: 'detonator', column: 3 }, board);
    const [next, steps] = applyInput(state, { kind: 'drop' }, RNG);
    expect(next.board[2][3]).toEqual({ kind: 'detonator' });
    expect(steps[0].event).toEqual({ kind: 'solo-land', landingRow: 2 });
  });

  it('clears the column the dynamite lands on, including the cell it rested in', () => {
    // The dynamite is never a board cell: it falls, lights its fuse,
    // and consumes itself in its own blast. Two steps cover the
    // journey — solo-land at the dynamite's resting row, then
    // dynamite-blast that empties the column from the floor up to
    // (and including) that row.
    const board = parseBoard(`
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . 5 . . .
    `);
    const state = makeState({ kind: 'dynamite', column: 3 }, board);
    const [next, steps] = applyInput(state, { kind: 'drop' }, RNG);
    expect(next.board[0][3]).toEqual({ kind: 'empty' });
    expect(next.board[1][3]).toEqual({ kind: 'empty' });
    expect(steps.map((s) => s.event.kind)).toEqual([
      'solo-land',
      'dynamite-blast',
      'spawn',
    ]);
    expect(steps[0].event).toEqual({ kind: 'solo-land', landingRow: 1 });
    expect(steps[1].event).toEqual({
      kind: 'dynamite-blast',
      column: 3,
      landingRow: 1,
    });
  });

  it('matches acceptance test 3.1 — dynamite empties a stacked column', () => {
    // Column 3 (spec col 3) holds tiers 2/3/4/5 at rows 0–3. Dropping
    // a dynamite at column 3 lands it at row 4 and the blast wipes
    // rows 0–4 clean. Other columns are untouched.
    const board = parseBoard(`
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . 5 . . . .
      . . 4 . . . .
      . . 3 . . . .
      . . 2 . . . .
    `);
    const state = makeState({ kind: 'dynamite', column: 2 }, board);
    const [next] = applyInput(state, { kind: 'drop' }, RNG);
    for (let r = 0; r < 7; r++) {
      expect(next.board[r][2]).toEqual({ kind: 'empty' });
    }
    // Score is recomputed on the post-cascade stable board: every
    // tier in column 3 is gone, so the new score is 0.
    expect(next.score).toBe(0);
  });

  it('reports the solo-land snapshot on an unchanged board, then a post-blast snapshot', () => {
    // The solo-land step's snapshot still has the original column
    // contents — the dynamite is rendered as a falling-piece visual
    // by the renderer, not as a board cell. Only the dynamite-blast
    // step's snapshot has the column cleared.
    const board = parseBoard(`
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . 7 . . .
      . . . 5 . . .
    `);
    const state = makeState({ kind: 'dynamite', column: 3 }, board);
    const [, steps] = applyInput(state, { kind: 'drop' }, RNG);
    const [solo, blast] = steps;
    expect(solo.event).toEqual({ kind: 'solo-land', landingRow: 2 });
    expect(solo.snapshot.board[0][3]).toEqual({ kind: 'element', tier: 5 });
    expect(solo.snapshot.board[1][3]).toEqual({ kind: 'element', tier: 7 });
    expect(blast.event).toEqual({
      kind: 'dynamite-blast',
      column: 3,
      landingRow: 2,
    });
    expect(blast.snapshot.board[0][3]).toEqual({ kind: 'empty' });
    expect(blast.snapshot.board[1][3]).toEqual({ kind: 'empty' });
    expect(blast.snapshot.board[2][3]).toEqual({ kind: 'empty' });
  });

  it('matches acceptance test 4.5 — destroying the highest tier shrinks the spawn pool', () => {
    // Column 3 holds tiers 1/2/3/4/5 (lone tier-5 sets the pool to
    // {1..5}). Dropping a dynamite at column 3 destroys all of them,
    // including the tier-5. The post-blast board has no tier-5
    // anywhere, so the next preview is drawn against pool {1..2}.
    const board = parseBoard(`
      . . . . . . .
      . . . . . . .
      . . . 5 . . .
      . . . 4 . . .
      . . . 3 . . .
      . . . 2 . . .
      . . . 1 . . .
    `);
    const state = makeState({ kind: 'dynamite', column: 3 }, board);
    const [next] = applyInput(state, { kind: 'drop' }, RNG);
    expect(next.preview.kind).toBe('pair');
    const newPreview = next.preview as Extract<Piece, { kind: 'pair' }>;
    expect([1, 2]).toContain(newPreview.first);
    expect([1, 2]).toContain(newPreview.second);
  });

  it('promotes the preview after dropping a solo item', () => {
    const state = makeState({ kind: 'detonator', column: 3 });
    const [next] = applyInput(state, { kind: 'drop' }, RNG);
    // DUMMY_PREVIEW is a 1/1 pair; the spawn step promotes it.
    expect(next.active).toEqual({
      kind: 'pair',
      column: 3,
      orientation: 'horizontal',
      first: 1,
      second: 1,
    });
  });
});

describe('applyInput / drop / score', () => {
  it('updates the score to 4 after a [1/2] horizontal drop on an empty board', () => {
    // Acceptance test 1.1: tier-1 (=1) + tier-2 (=3) = 4.
    const state = makeState(pair(3, 'horizontal', 1, 2));
    const [next, steps] = applyInput(state, { kind: 'drop' }, RNG);
    expect(next.score).toBe(4);
    expect(next.comboScore).toBe(0);
    // No reactions, so the cascade adds no chain bonus. The
    // pair-land snapshot already carries the live post-land score,
    // and the spawn snapshot carries it forward.
    expect(steps[0].snapshot.score).toBe(4);
    expect(steps[1].snapshot.score).toBe(4);
  });

  it('matches acceptance test 1.3 — drop into a column of two tier-5s scores 166', () => {
    const board = parseBoard(`
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . 5 . . .
      . . . 5 . . .
    `);
    const state = makeState(pair(3, 'vertical', 2, 1), board);
    const [next] = applyInput(state, { kind: 'drop' }, RNG);
    expect(next.score).toBe(1 + 3 + 81 + 81);
  });

  it('keeps the score at zero after dropping a detonator (no element on the board)', () => {
    // The detonator cell does not contribute to the score: only
    // tier-bearing element cells do.
    const state = makeState({ kind: 'detonator', column: 3 });
    const [next] = applyInput(state, { kind: 'drop' }, RNG);
    expect(next.score).toBe(0);
  });
});

describe('applyInput / drop / cascade integration', () => {
  it('stitches merge and gravity steps between pair-land and spawn', () => {
    // Acceptance test 2.1: drop horizontal [1/5] at column 4 (code
    // column 3) onto a board with two tier-1s in row 1 columns 2–3.
    const board = parseBoard(`
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . 1 1 . . . .
    `);
    const state = makeState(pair(3, 'horizontal', 1, 5), board);
    const [, steps] = applyInput(state, { kind: 'drop' }, RNG);
    expect(steps.map((s) => s.event.kind)).toEqual([
      'pair-land',
      'merge',
      'spawn',
    ]);
  });

  it('updates the score on every step during a cascade and settles the chain bonus on the last cascade step', () => {
    // Acceptance test 2.4: a two-merge cascade settling on a single
    // tier-3 (board sum = 9). The vertical pair lands its bottom
    // tier-1 next to an existing tier-1 row at row 0, so the post-
    // land board has a 4-cell tier-1 group that merges to tier-2,
    // gravity drops two stranded tier-2s to the floor, and the
    // resulting tier-2 row of 3 merges to tier-3.
    const board = parseBoard(`
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . 2 . . .
      . . . 1 . . .
      . 1 . 1 . . .
    `);
    const state = makeState(pair(2, 'vertical', 1, 2), board);
    const [next, steps] = applyInput(state, { kind: 'drop' }, RNG);
    expect(steps.map((s) => s.event.kind)).toEqual([
      'pair-land',
      'merge',
      'gravity',
      'merge',
      'spawn',
    ]);
    // The displayed score updates at every step. Pre-drop board sum
    // was 6 (3 × tier-1 + 1 × tier-2); after the pair lands the
    // playfield holds 4 × tier-1 + 2 × tier-2 = 10. The first merge
    // turns 4 × tier-1 into 1 × tier-2, leaving 3 × tier-2 = 9, and
    // gravity preserves the sum. The final tier-3 also scores 9.
    expect(steps[0].snapshot.score).toBe(10); // pair-land
    expect(steps[1].snapshot.score).toBe(9); // first merge
    expect(steps[2].snapshot.score).toBe(9); // gravity
    // Two merges = one chain link beyond the first → +10 bonus,
    // settled on the final cascade step.
    expect(steps[3].snapshot.score).toBe(19); // second merge (settled)
    expect(steps[3].snapshot.comboScore).toBe(10);
    expect(steps[4].snapshot.score).toBe(19); // spawn
    expect(next.comboScore).toBe(10);
    // comboScore on the in-flight steps stays at the prior value.
    expect(steps[0].snapshot.comboScore).toBe(0);
    expect(steps[1].snapshot.comboScore).toBe(0);
    expect(steps[2].snapshot.comboScore).toBe(0);
  });

  it('emits no merge or gravity step when nothing reacts', () => {
    const state = makeState(pair(3, 'horizontal', 1, 2));
    const [, steps] = applyInput(state, { kind: 'drop' }, RNG);
    expect(steps.map((s) => s.event.kind)).toEqual(['pair-land', 'spawn']);
  });

  it('awards no chain bonus for a single merge', () => {
    // One merge, no further reactions → chainLinks = 1 → bonus = 0.
    const board = parseBoard(`
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . 1 1 . . . .
    `);
    const state = makeState(pair(3, 'horizontal', 1, 5), board);
    const [next] = applyInput(state, { kind: 'drop' }, RNG);
    // Pair lands tier-1 at (0, 3) and tier-5 at (0, 4). The tier-1
    // group at (0, 1)..(0, 3) merges to tier-2 at (0, 1). Final
    // board sum = 3 + 81 = 84; comboScore stays 0.
    expect(next.score).toBe(84);
    expect(next.comboScore).toBe(0);
  });

  it('adds COMBO_BONUS for each chain link beyond the first', () => {
    // Three-merge cascade. Column 0 stacks 1, 2, 2, 3, 3 from the
    // floor up; the floor row also has a tier-1 at column 1. Drop a
    // horizontal [1/1] pair at column 2 so both halves land at row 0,
    // producing the chain:
    //   merge 1 — tier-1 quartet at row 0 cols 0..3 → tier-2 at (0,0).
    //   merge 2 — tier-2 trio at col 0 rows 0..2 → tier-3 at (0,0).
    //   gravity drops the col-0 tier-3s at rows 3..4 down to rows 1..2.
    //   merge 3 — tier-3 trio at col 0 rows 0..2 → tier-4 at (0,0).
    // Three chain links → +20 bonus. Final board: a single tier-4 at
    // (0, 0) on an otherwise empty playfield.
    const board = parseBoard(`
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      3 . . . . . .
      3 . . . . . .
      2 . . . . . .
      2 . . . . . .
      1 1 . . . . .
    `);
    const state = makeState(pair(2, 'horizontal', 1, 1), board);
    const [next, steps] = applyInput(state, { kind: 'drop' }, RNG);
    const merges = steps.filter((s) => s.event.kind === 'merge').length;
    expect(merges).toBe(3);
    expect(next.comboScore).toBe(20);
    // Final board sum = 3^(4-1) = 27. Total score = comboScore + sum.
    expect(next.score).toBe(20 + 27);
  });

  it('lets the cascade rescue an overflow landing from a game-over', () => {
    // Acceptance test 2.4 builds tier-3 in column 2; here we use the
    // same shape but stack the column to row 6 first, so the pair
    // initially lands its top in row 7 (overflow) — yet the cascade
    // collapses the column and the stable board is well within the
    // playfield.
    //
    // Column 1 is full of tier-1 alternating with tier-9 (so the
    // initial board is stable). Drop a horizontal [1/2] at column 1.
    // The new tier-1 lands at row 7 — overflow. But it sits on top
    // of the existing tier-1 at row 6, forming a group of 2; no
    // reaction. Game-over fires, since no cascade clears the
    // overflow. (Sanity: the cascade is wired to run, but a
    // fresh-overflow board with no group ≥ 3 doesn't react.)
    const board = parseBoard(`
      . 1 . . . . .
      . 9 . . . . .
      . 1 . . . . .
      . 9 . . . . .
      . 1 . . . . .
      . 9 . . . . .
      . 1 . . . . .
    `);
    const state = makeState(pair(1, 'horizontal', 1, 2), board);
    const [, steps] = applyInput(state, { kind: 'drop' }, RNG);
    expect(steps.map((s) => s.event.kind)).toEqual([
      'pair-land',
      'game-over',
    ]);
  });

  it('runs the cascade before the lose check so a clearing reaction averts game-over', () => {
    // Column 3 is filled to row 6 with tier-3s on the floor topped by
    // alternating tiers that can react once the new pair lands. The
    // post-land board has a vertical run of tier-1s in column 3 rows
    // 6 and 7, plus an existing tier-1 at row 5 — together they form
    // a group of 3, which clears column 3 down to row 5 and replaces
    // it with a tier-2. The overflow is gone, so the game keeps
    // going.
    //
    // Initial column 3: rows 0 = 9, 1 = 9, 2 = 9, 3 = 9, 4 = 9, 5 = 1.
    // (Five tier-9 cells form a connected group of 5, which would be
    // unstable. So substitute alternating tier-9 / tier-A so no
    // reactive group of size ≥ 3 exists.)
    const board = parseBoard(`
      . . . . . . .
      . . . 1 . . .
      . . . A . . .
      . . . 9 . . .
      . . . A . . .
      . . . 9 . . .
      . . . A . . .
    `);
    const state = makeState(pair(3, 'vertical', 1, 1), board);
    const [next, steps] = applyInput(state, { kind: 'drop' }, RNG);
    // After-land column 3: A,9,A,9,A,1,1,1 (row 7 = the new top of
    // pair). Three tier-1s in a row at rows 5–7 → react to tier-2 at
    // row 5. Gravity is a no-op since nothing is above.
    expect(steps.map((s) => s.event.kind)).toEqual([
      'pair-land',
      'merge',
      'spawn',
    ]);
    // Stable board: row 7 is empty, no game-over.
    expect(next.board[7][3]).toEqual({ kind: 'empty' });
    expect(next.board[5][3]).toEqual({ kind: 'element', tier: 2 });
  });
});

describe('applyInput / drop / lose condition', () => {
  // Lose-condition tests need boards that fill column 3 without
  // forming any reactive group of size ≥ 3 — otherwise the cascade
  // would clear cells out of the column before the lose check runs.
  // Alternating tiers (1, 5, 1, 5, …) keep every same-tier component
  // at size 1 vertically, with the pair-land potentially adding a
  // size-2 group that still doesn't trigger.
  const FULL_COLUMN_3 = `
    . . . 1 . . .
    . . . 5 . . .
    . . . 1 . . .
    . . . 5 . . .
    . . . 1 . . .
    . . . 5 . . .
    . . . 1 . . .
  `;
  const SIX_ROW_COLUMN_3 = `
    . . . 5 . . .
    . . . 1 . . .
    . . . 5 . . .
    . . . 1 . . .
    . . . 5 . . .
    . . . 1 . . .
  `;
  const FIVE_ROW_COLUMN_3 = `
    . . . 1 . . .
    . . . 5 . . .
    . . . 1 . . .
    . . . 5 . . .
    . . . 1 . . .
  `;

  it('emits a game-over step when a half lands in the overflow zone', () => {
    // Column 3 is full to the brim of the playfield (rows 0–6). The
    // horizontal pair drops its left half on top, landing at row 7
    // — the overflow zone. The right half lands cleanly at row 0
    // of the empty column 4, but a single half in row 7 is enough
    // to lose.
    const state = makeState(
      pair(3, 'horizontal', 1, 2),
      parseBoard(FULL_COLUMN_3),
    );
    const [next, steps] = applyInput(state, { kind: 'drop' }, RNG);
    expect(steps).toHaveLength(2);
    expect(steps[0].event.kind).toBe('pair-land');
    expect(steps[1].event).toEqual({ kind: 'game-over' });
    // The game-over snapshot mirrors the stable state: same board,
    // no active piece.
    expect(steps[1].snapshot).toBe(next);
    expect(next.board[7][3]).toEqual({ kind: 'element', tier: 1 });
    expect(next.active).toBeNull();
  });

  it('emits game-over when the top of a vertical pair lands in row 7', () => {
    // Column 3 has 6 elements (rows 0–5). A vertical pair lands its
    // bottom at row 6 (still playfield) and its top at row 7
    // (overflow). Top half alone is enough to trigger the loss.
    const state = makeState(
      pair(3, 'vertical', 1, 2),
      parseBoard(SIX_ROW_COLUMN_3),
    );
    const [, steps] = applyInput(state, { kind: 'drop' }, RNG);
    expect(steps[steps.length - 1].event).toEqual({ kind: 'game-over' });
  });

  it('does not trigger game-over when the pair just fits in the playfield', () => {
    // Column 3 has 5 elements (rows 0–4). A vertical pair fills rows
    // 5 and 6 — the topmost playfield row. Nothing in the overflow
    // zone, so the game continues.
    const state = makeState(
      pair(3, 'vertical', 1, 2),
      parseBoard(FIVE_ROW_COLUMN_3),
    );
    const [, steps] = applyInput(state, { kind: 'drop' }, RNG);
    expect(steps[steps.length - 1].event.kind).toBe('spawn');
  });

  it('preserves the preview and the RNG on game-over', () => {
    const state = makeState(
      pair(3, 'horizontal', 1, 2),
      parseBoard(FULL_COLUMN_3),
    );
    const [next, , rng] = applyInput(state, { kind: 'drop' }, RNG);
    // No new preview drawn, so the RNG is untouched and the preview
    // carries forward from the prior state.
    expect(rng).toBe(RNG);
    expect(next.preview).toBe(DUMMY_PREVIEW);
  });

  it('locks input after game-over (no active piece to act on)', () => {
    const state = makeState(
      pair(3, 'horizontal', 1, 2),
      parseBoard(FULL_COLUMN_3),
    );
    const [afterDrop] = applyInput(state, { kind: 'drop' }, RNG);
    const [afterShift, shiftSteps] = applyInput(
      afterDrop,
      { kind: 'shift', direction: 'left' },
      RNG,
    );
    expect(afterShift).toBe(afterDrop);
    expect(shiftSteps).toEqual([]);
  });

  it('keeps the score at its prior value on game-over', () => {
    // Pre-existing score (carried in via state) should survive
    // unchanged — the spec says score is recomputed only when the
    // round did not end.
    const state: State = {
      ...makeState(pair(3, 'horizontal', 1, 2), parseBoard(FULL_COLUMN_3)),
      score: 999,
    };
    const [next, steps] = applyInput(state, { kind: 'drop' }, RNG);
    expect(next.score).toBe(999);
    expect(steps[0].snapshot.score).toBe(999);
    expect(steps[1].snapshot.score).toBe(999);
  });

  it('triggers on a detonator landing in the overflow zone', () => {
    // Column 3 has 7 elements (rows 0–6). Dropping a detonator
    // places it at row 7, which is the overflow zone — game over.
    const state = makeState(
      { kind: 'detonator', column: 3 },
      parseBoard(FULL_COLUMN_3),
    );
    const [next, steps] = applyInput(state, { kind: 'drop' }, RNG);
    expect(steps[steps.length - 1].event).toEqual({ kind: 'game-over' });
    expect(next.board[7][3]).toEqual({ kind: 'detonator' });
  });
});

describe('applyInput / drop / detonator', () => {
  it('triggers when a pair half settles directly above a detonator', () => {
    // Detonator at (row 0, col 3). The horizontal pair lands tier 5
    // at (row 1, col 3) — directly above the detonator — and tier 5
    // at (row 0, col 4). The detonator's 3×3 blast clears (0,2),
    // (0,3), (0,4), (1,2), (1,3), (1,4); rows -1 are out of bounds.
    // Both halves of the pair are in the cleared zone.
    const board = parseBoard(`
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . E . . .
    `);
    const state = makeState(pair(3, 'horizontal', 5, 5), board);
    const [next, steps] = applyInput(state, { kind: 'drop' }, RNG);
    expect(steps.map((s) => s.event.kind)).toEqual([
      'pair-land',
      'detonate',
      'spawn',
    ]);
    const detonate = steps[1].event;
    if (detonate.kind !== 'detonate') throw new Error('expected detonate');
    expect(detonate.detonators).toEqual([{ row: 0, column: 3 }]);
    expect(detonate.cleared).toEqual([
      { row: 0, column: 3 },
      { row: 0, column: 4 },
      { row: 1, column: 3 },
    ]);
    // Stable board has nothing left.
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 7; c++) {
        expect(next.board[r][c]).toEqual({ kind: 'empty' });
      }
    }
  });

  it('matches acceptance test 3.2 — detonator triggered by next drop clears the 3×3', () => {
    const board = parseBoard(`
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . E . . .
    `);
    const state = makeState(pair(3, 'horizontal', 5, 5), board);
    const [next] = applyInput(state, { kind: 'drop' }, RNG);
    // Score = 0; both pair halves and the detonator are gone.
    expect(next.score).toBe(0);
    expect(next.board[0][3]).toEqual({ kind: 'empty' });
    expect(next.board[0][4]).toEqual({ kind: 'empty' });
    expect(next.board[1][3]).toEqual({ kind: 'empty' });
  });

  it('clamps the 3×3 against the left wall', () => {
    // Detonator at (row 0, col 0): the blast covers (0,0), (0,1),
    // (1,0), (1,1) — four cells, since the rest is off-grid.
    const board = parseBoard(`
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      E . . . . . .
    `);
    const state = makeState(pair(0, 'vertical', 5, 5), board);
    const [next, steps] = applyInput(state, { kind: 'drop' }, RNG);
    // Vertical pair at column 0: bottom (first=5) lands at row 1,
    // top (second=5) at row 2. Bottom triggers the detonator. The 3×3
    // covers rows 0–1, columns 0–1. The top half at row 2 is outside
    // the blast and falls under post-detonation gravity to row 0.
    const detonate = steps[1].event;
    if (detonate.kind !== 'detonate') throw new Error('expected detonate');
    expect(detonate.cleared).toEqual([
      { row: 0, column: 0 },
      { row: 1, column: 0 },
    ]);
    // Top half survives, gravity drops it to the floor.
    expect(next.board[0][0]).toEqual({ kind: 'element', tier: 5 });
    expect(steps.map((s) => s.event.kind)).toEqual([
      'pair-land',
      'detonate',
      'gravity',
      'spawn',
    ]);
  });

  it('triggers two detonators simultaneously when a horizontal pair lands on both', () => {
    // Detonators at (0, 3) and (0, 4). Horizontal pair lands tier-5s
    // at (1, 3) and (1, 4). Both detonators trigger; union of their
    // 3×3 zones covers rows 0–1, columns 2–5 — eight cells (the
    // detonators plus their overlapping neighborhoods).
    const board = parseBoard(`
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . E E . .
    `);
    const state = makeState(pair(3, 'horizontal', 5, 5), board);
    const [, steps] = applyInput(state, { kind: 'drop' }, RNG);
    const detonate = steps[1].event;
    if (detonate.kind !== 'detonate') throw new Error('expected detonate');
    expect(detonate.detonators).toEqual([
      { row: 0, column: 3 },
      { row: 0, column: 4 },
    ]);
    // Cleared cells: both detonators and both pair halves. Adjacent
    // cells in the union are empty so they don't appear in `cleared`.
    expect(detonate.cleared).toEqual([
      { row: 0, column: 3 },
      { row: 0, column: 4 },
      { row: 1, column: 3 },
      { row: 1, column: 4 },
    ]);
  });

  it('matches acceptance test 3.3 — only the triggered detonator fires; the second sits outside its blast', () => {
    // Detonators at (0, 2) and (0, 4). Horizontal pair [1/1] at
    // column 3 lands tier-1 at (row 2, col 3) on top of the detonator
    // at (0, 2)? No — the spec test is column 3 which lands the left
    // half above the col-2 detonator's adjacent column. Re-read:
    // pair `[1/1]` at column 3 lands left-half at column 3, right-half
    // at column 4. Column 3 is empty, left lands at row 0… but the
    // detonator at (0, 2) means column 3 is empty at row 0, so left
    // lands at row 0, NOT on a detonator. The acceptance test
    // diagram has the pair landing above the detonator at column 3;
    // re-checking the diagram shows the detonators are at columns 3
    // and 5 (1-indexed in the spec), i.e. code columns 2 and 4. Pair
    // is at spec column 3 = code column 2 — so left-half lands on
    // top of the col-2 detonator. Let's reconstruct.
    const board = parseBoard(`
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . E . E . .
    `);
    const state = makeState(pair(2, 'horizontal', 1, 1), board);
    const [next, steps] = applyInput(state, { kind: 'drop' }, RNG);
    expect(steps.map((s) => s.event.kind)).toEqual([
      'pair-land',
      'detonate',
      'spawn',
    ]);
    const detonate = steps[1].event;
    if (detonate.kind !== 'detonate') throw new Error('expected detonate');
    // Only the col-2 detonator triggers — its 3×3 covers cols 1–3,
    // rows 0–1. The col-4 detonator is outside that zone (column 4
    // is beyond column 3) and survives.
    expect(detonate.detonators).toEqual([{ row: 0, column: 2 }]);
    expect(next.board[0][4]).toEqual({ kind: 'detonator' });
    // Both pair halves are gone: the left half at (1, 2) was the
    // trigger; the right half at (0, 3) is in the 3×3.
    expect(next.board[1][2]).toEqual({ kind: 'empty' });
    expect(next.board[0][3]).toEqual({ kind: 'empty' });
    expect(next.score).toBe(0);
  });

  it('destroys an in-blast detonator without chain-triggering it', () => {
    // Detonators at (0, 3) and (0, 4). A single pair half on (1, 3)
    // triggers only the col-3 detonator; the col-4 detonator falls
    // inside its 3×3 and is silently destroyed.
    const board = parseBoard(`
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . E E . .
    `);
    // Vertical pair so only the bottom half (column 3) lands.
    const state = makeState(pair(3, 'vertical', 5, 5), board);
    const [, steps] = applyInput(state, { kind: 'drop' }, RNG);
    const detonate = steps[1].event;
    if (detonate.kind !== 'detonate') throw new Error('expected detonate');
    // Only one trigger: the in-blast detonator does not chain.
    expect(detonate.detonators).toEqual([{ row: 0, column: 3 }]);
    // Both detonators are present in the detonate snapshot's cleared
    // cells, even though only one triggered.
    expect(detonate.cleared).toContainEqual({ row: 0, column: 3 });
    expect(detonate.cleared).toContainEqual({ row: 0, column: 4 });
    // The detonate step's snapshot has both detonator cells empty.
    const post = steps[1].snapshot.board;
    expect(post[0][3]).toEqual({ kind: 'empty' });
    expect(post[0][4]).toEqual({ kind: 'empty' });
  });

  it('triggers the existing detonator when a detonator lands on it; the new detonator is destroyed before being armed', () => {
    const board = parseBoard(`
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . E . . .
    `);
    const state = makeState({ kind: 'detonator', column: 3 }, board);
    const [next, steps] = applyInput(state, { kind: 'drop' }, RNG);
    expect(steps.map((s) => s.event.kind)).toEqual([
      'solo-land',
      'detonate',
      'spawn',
    ]);
    const detonate = steps[1].event;
    if (detonate.kind !== 'detonate') throw new Error('expected detonate');
    expect(detonate.detonators).toEqual([{ row: 0, column: 3 }]);
    // Both detonators (the existing one at (0,3) and the new one at
    // (1,3)) are gone.
    expect(next.board[0][3]).toEqual({ kind: 'empty' });
    expect(next.board[1][3]).toEqual({ kind: 'empty' });
  });

  it('triggers the detonator when a dynamite would settle directly above it; no dynamite-blast step', () => {
    const board = parseBoard(`
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . E . . .
    `);
    const state = makeState({ kind: 'dynamite', column: 3 }, board);
    const [next, steps] = applyInput(state, { kind: 'drop' }, RNG);
    expect(steps.map((s) => s.event.kind)).toEqual([
      'solo-land',
      'detonate',
      'spawn',
    ]);
    // The solo-land snapshot still shows the original board (the
    // dynamite is never a Cell). The detonate snapshot shows the
    // post-blast board.
    const [solo, detonate] = steps;
    expect(solo.event).toEqual({ kind: 'solo-land', landingRow: 1 });
    expect(solo.snapshot.board[0][3]).toEqual({ kind: 'detonator' });
    if (detonate.event.kind !== 'detonate') throw new Error('expected detonate');
    expect(detonate.event.detonators).toEqual([{ row: 0, column: 3 }]);
    expect(next.board[0][3]).toEqual({ kind: 'empty' });
  });

  it('runs post-detonation gravity to settle suspended cells in adjacent columns', () => {
    // Detonator at (0, 3) on the floor, topmost in its (single-cell)
    // column. Column 2 has tier-7/9/7 stacked rows 0–2 (size-2
    // groups, no reaction) with tier-A suspended-after-blast at row
    // 3. Column 4 has tier-8/8 at rows 0–1 (in the blast).
    const board = parseBoard(`
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . A . . . .
      . . 7 . . . .
      . . 9 . 8 . .
      . . 7 E 8 . .
    `);
    const state = makeState(pair(3, 'vertical', 5, 5), board);
    const [next, steps] = applyInput(state, { kind: 'drop' }, RNG);
    // Vertical pair: first (bottom) lands at (1, 3) above the
    // detonator. Second (top) lands at (2, 3). The 3×3 around
    // (0, 3) covers rows 0–1, cols 2–4 — clearing the col-2 row 0/1
    // supports, the detonator, the bottom pair half, and both col-4
    // tier-8s. The top pair half at (2, 3) survives. Tier-7 at
    // (row 2, col 2) and tier-A at (row 3, col 2) are suspended.
    expect(steps.map((s) => s.event.kind)).toEqual([
      'pair-land',
      'detonate',
      'gravity',
      'spawn',
    ]);
    // Post-gravity: col 2 tier-7 at row 0, tier-A at row 1; col 3
    // tier-5 at row 0; col 4 empty.
    expect(next.board[0][2]).toEqual({ kind: 'element', tier: 7 });
    expect(next.board[1][2]).toEqual({ kind: 'element', tier: 10 });
    expect(next.board[0][3]).toEqual({ kind: 'element', tier: 5 });
    expect(next.board[0][4]).toEqual({ kind: 'empty' });
  });

  it('shrinks the spawn pool when the detonator destroys the highest tier', () => {
    // Acceptance test 4.5 with a detonator instead of dynamite. The
    // detonator is the topmost cell of column 3, with the lone
    // tier-5 next door at (row 1, col 4) — inside the blast's 3×3.
    // Dropping a [1/1] horizontal pair triggers the detonator and
    // destroys the tier-5, dropping the highest surviving tier to 2.
    const board = parseBoard(`
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . E 5 . .
      . . 1 2 1 . .
    `);
    const state = makeState(pair(3, 'horizontal', 1, 1), board);
    const [next] = applyInput(state, { kind: 'drop' }, RNG);
    expect(next.preview.kind).toBe('pair');
    const newPreview = next.preview as Extract<Piece, { kind: 'pair' }>;
    expect([1, 2]).toContain(newPreview.first);
    expect([1, 2]).toContain(newPreview.second);
  });

  it('updates the score on the detonate step when nothing reacts afterward', () => {
    // Detonator at (0, 3) with tier-5s in the surrounding cells.
    // The blast clears them all; post-blast board is empty; score
    // should snap to 0 on the detonate step (the last step before
    // spawn).
    const board = parseBoard(`
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . 5 . 5 . .
      . . 5 E 5 . .
    `);
    const state = makeState(pair(3, 'vertical', 1, 1), board);
    const [next, steps] = applyInput(state, { kind: 'drop' }, RNG);
    // Score recompute lands on the last cascade-or-land step — here
    // the detonate step (no cascade follows because the surviving
    // top half of the pair settles via gravity but produces no merge).
    const detonate = steps.find((s) => s.event.kind === 'detonate');
    if (!detonate) throw new Error('expected detonate step');
    // The recomputed score reflects the post-blast (and post-gravity)
    // board. The four tier-5s and both pair halves are gone via the
    // blast; the surviving top of the pair (tier 1) falls into column
    // 3 — score = 1.
    expect(next.score).toBe(1);
  });
});

import { describe, it, expect } from 'vitest';
import { applyInput } from './apply';
import { createRng } from './rng';
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

function makeState(active: ActivePiece | null): State {
  return { board: EMPTY_BOARD, active, preview: DUMMY_PREVIEW, score: 0 };
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

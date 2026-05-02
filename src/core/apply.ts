// Pure transition function for the core: `(state, input, rng) →
// (state', steps, rng')`. Currently handles `shift` and `rotate`.
// `drop` will land alongside the cascade simulator.

import type { ActivePiece, Input, State, Step } from './state';
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
      throw new Error('applyInput: drop is not yet implemented');
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

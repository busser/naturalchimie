// Maps keyboard arrows to core Inputs and handles held-key repeat
// per 08-software-design.md ("Held keys"). OS-level auto-repeat
// (event.repeat) is dropped; we roll our own by tracking
// keydown/keyup transitions and, on each `tick()` while the buffer
// and animation queue are empty, firing one input for any held
// movement key. The repeat rate naturally becomes one action per
// animation cycle.

import type { Input } from '../core/state';
import type { Store } from '../store';

export type Keyboard = {
  tick(): void;
  detach(): void;
};

export function attachKeyboard(store: Store): Keyboard {
  const heldKeys = new Set<string>();

  function onKeyDown(e: KeyboardEvent): void {
    if (e.repeat) return;
    const input = mapKey(e.key);
    if (input === null) return;
    e.preventDefault();
    heldKeys.add(e.key);
    store.dispatch(input);
  }

  function onKeyUp(e: KeyboardEvent): void {
    heldKeys.delete(e.key);
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  return {
    tick() {
      // Held-key repeat: fire one input per idle frame. peekNextStep
      // returns null only when both the input buffer and the step
      // queue are empty, so this respects the "fire when idle and
      // buffer empty" rule from 08-software-design.md.
      if (store.peekNextStep() !== null) return;
      for (const key of heldKeys) {
        const input = mapKey(key);
        if (input !== null) {
          store.dispatch(input);
          return;
        }
      }
    },
    detach() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    },
  };
}

function mapKey(key: string): Input | null {
  switch (key) {
    case 'ArrowLeft':
      return { kind: 'shift', direction: 'left' };
    case 'ArrowRight':
      return { kind: 'shift', direction: 'right' };
    case 'ArrowUp':
      return { kind: 'rotate' };
    case 'ArrowDown':
      return { kind: 'drop' };
    default:
      return null;
  }
}

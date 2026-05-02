// Maps keyboard arrows to core Inputs. OS-level auto-repeat
// (event.repeat) is dropped per 08-software-design.md ("Held keys");
// the input layer's own held-key repeat lands alongside the real
// tweens, when "wait for the animation to finish" becomes a
// meaningful gate.

import type { Input } from '../core/state';
import type { Store } from '../store';

export function attachKeyboard(store: Store): () => void {
  function onKeyDown(e: KeyboardEvent): void {
    if (e.repeat) return;
    const input = mapKey(e.key);
    if (input === null) return;
    e.preventDefault();
    store.dispatch(input);
  }
  window.addEventListener('keydown', onKeyDown);
  return () => window.removeEventListener('keydown', onKeyDown);
}

function mapKey(key: string): Input | null {
  switch (key) {
    case 'ArrowLeft':
      return { kind: 'shift', direction: 'left' };
    case 'ArrowRight':
      return { kind: 'shift', direction: 'right' };
    case 'ArrowUp':
      return { kind: 'rotate' };
    // ArrowDown maps to drop — wired when the core implements it.
    default:
      return null;
  }
}

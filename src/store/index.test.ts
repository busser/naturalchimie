import { describe, it, expect } from 'vitest';
import { createStore } from './index';

// Drains step-by-step the way the renderer driver does: peek, commit,
// repeat until the queue is empty.
function drain(store: ReturnType<typeof createStore>): void {
  while (store.peekNextStep() !== null) {
    store.commitNextStep();
  }
}

describe('store / input buffering across pairs', () => {
  it('discards inputs dispatched after a drop, before the next pair spawns', () => {
    const store = createStore(1);
    const beforeFirstDrop = store.getSnapshot();
    expect(beforeFirstDrop.active).not.toBeNull();

    // Player presses drop, then mashes drop two more times during the
    // fall animation. Per the spec, only the first drop should take
    // effect; the next two pairs must NOT auto-drop.
    store.dispatch({ kind: 'drop' });
    store.dispatch({ kind: 'drop' });
    store.dispatch({ kind: 'drop' });

    drain(store);

    const afterCascade = store.getSnapshot();
    // A spawn step should have committed a fresh active piece, but it
    // should be sitting at the spawn position, untouched — not landed.
    expect(afterCascade.active).not.toBeNull();
    expect(afterCascade.active).not.toEqual(beforeFirstDrop.active);

    // Confirm the second pair is still in the spawn area: dropping it
    // produces fresh steps. If the buffered drops had leaked through,
    // it would already be on the board and this drop would land a
    // third pair instead.
    const beforeSecondDrop = store.getSnapshot();
    store.dispatch({ kind: 'drop' });
    drain(store);
    const afterSecondDrop = store.getSnapshot();
    expect(afterSecondDrop.active).not.toEqual(beforeSecondDrop.active);
  });

  it('discards non-drop inputs that arrive after a drop', () => {
    const store = createStore(1);
    store.dispatch({ kind: 'drop' });
    // These should be ignored — drop closed the buffer for this pair,
    // and the next pair has not spawned yet.
    store.dispatch({ kind: 'shift', direction: 'left' });
    store.dispatch({ kind: 'rotate' });

    drain(store);

    // After the cascade, a fresh pair sits at the spawn column.
    // SPAWN_COLUMN is 3 (0-indexed); a shift would have moved it to 2.
    const afterCascade = store.getSnapshot();
    expect(afterCascade.active).not.toBeNull();
    expect(afterCascade.active!.column).toBe(3);
    if (afterCascade.active!.kind === 'pair') {
      expect(afterCascade.active!.orientation).toBe('horizontal');
    }
  });

  it('reopens the buffer when a spawn step commits', () => {
    const store = createStore(1);
    store.dispatch({ kind: 'drop' });

    // Walk the queue forward step by step; the buffer should still be
    // closed until we cross the spawn step.
    let spawnCommitted = false;
    while (store.peekNextStep() !== null) {
      const step = store.peekNextStep()!;
      store.commitNextStep();
      if (step.event.kind === 'spawn') {
        spawnCommitted = true;
        break;
      }
    }
    expect(spawnCommitted).toBe(true);

    // Now a fresh shift should be accepted and produce a step.
    store.dispatch({ kind: 'shift', direction: 'left' });
    expect(store.peekNextStep()).not.toBeNull();
  });

  it('restart reopens the buffer for the new round', () => {
    const store = createStore(1);
    store.dispatch({ kind: 'drop' });
    drain(store);

    store.restart(2);
    // After restart the initial state has an active piece, so input
    // should be accepted again.
    store.dispatch({ kind: 'shift', direction: 'left' });
    expect(store.peekNextStep()).not.toBeNull();
  });
});

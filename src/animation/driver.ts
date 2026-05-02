// Animation driver. Pulls one step at a time from the store, plays
// it for the step's duration, and on completion commits the snapshot.
// See 08-software-design.md ("Animation layer") for the rationale.
//
// Durations are all zero in this iteration: the driver immediately
// commits any step it sees. Real tweens land in a follow-up.

import type { Step } from '../core/state';
import type { Store } from '../store';

export type Driver = {
  tick(now: number): void;
};

export function createDriver(store: Store): Driver {
  let current: Step | null = null;
  let currentStart = 0;

  function tick(now: number): void {
    // Loop so a frame can drain multiple zero-duration steps. Once
    // real durations land, the in-progress step's branch returns
    // early and at most one step starts per frame.
    while (true) {
      if (current === null) {
        current = store.peekNextStep();
        if (current === null) return;
        currentStart = now;
      }
      const duration = stepDuration(current);
      if (now - currentStart < duration) return;
      store.commitNextStep();
      current = null;
    }
  }

  return { tick };
}

function stepDuration(_step: Step): number {
  // Real tween durations land alongside the per-event interpolation
  // logic. Until then, every step plays instantly.
  return 0;
}

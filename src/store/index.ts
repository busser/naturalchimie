// Holds the latest committed snapshot, the RNG, and the queues that
// connect input to playback. Inputs are buffered as inputs (not as
// pre-applied steps) and only run through the core when the step
// queue drains, matching the buffering rule in
// 08-software-design.md ("Input handling") and the tween-buffer
// behavior in 05-animations.md.

import { applyInput } from '../core/apply';
import { createInitialState } from '../core/initial-state';
import { createRng } from '../core/rng';
import type { Input, State, Step } from '../core/state';

export type Store = {
  // Renderer reads this every frame.
  getSnapshot(): State;
  // Driver-facing API. peekNextStep lazily pulls inputs through the
  // core when nothing is animating, so a no-op input (e.g. a shift
  // into a wall) doesn't sit in the buffer and the driver only sees
  // real animations.
  peekNextStep(): Step | null;
  commitNextStep(): void;
  // Input layer calls dispatch on every fresh keydown.
  dispatch(input: Input): void;
  // Discards the current run and starts fresh from `seed`. Pending
  // inputs and pending steps are dropped so the new run starts clean.
  restart(seed: number): void;
};

export function createStore(seed: number): Store {
  let [committed, rng] = createInitialState(createRng(seed));
  const inputQueue: Input[] = [];
  const stepQueue: Step[] = [];

  function drainInputs(): void {
    while (stepQueue.length === 0 && inputQueue.length > 0) {
      const input = inputQueue.shift()!;
      const [, steps, nextRng] = applyInput(committed, input, rng);
      rng = nextRng;
      stepQueue.push(...steps);
    }
  }

  return {
    getSnapshot: () => committed,
    peekNextStep: () => {
      drainInputs();
      return stepQueue[0] ?? null;
    },
    commitNextStep: () => {
      const step = stepQueue.shift();
      if (!step) return;
      committed = step.snapshot;
    },
    dispatch: (input) => {
      inputQueue.push(input);
    },
    restart: (newSeed) => {
      [committed, rng] = createInitialState(createRng(newSeed));
      inputQueue.length = 0;
      stepQueue.length = 0;
    },
  };
}

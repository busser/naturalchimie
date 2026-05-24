// Holds the latest committed snapshot, the RNG, and the queues that
// connect input to playback. Inputs are buffered as inputs (not as
// pre-applied steps) and only run through the core when the step
// queue drains, matching the buffering rule in
// 08-software-design.md ("Input handling") and the tween-buffer
// behavior in 05-animations.md.

import { applyInput } from '../core/apply';
import { createInitialState } from '../core/initial-state';
import { createRng } from '../core/rng';
import { samplePiece } from '../core/spawn';
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
  // Dev-only: re-rolls the preview piece against the current board.
  // No-op while inputs or steps are pending so it can't race with a
  // cascade whose spawn step has already baked in the old preview.
  randomizePreview(): void;
  // Dev-only: forces the round into the lost state immediately. Drops
  // any pending inputs and steps so the game-over step plays right
  // away, regardless of whether a cascade was in flight.
  forceGameOver(): void;
};

// `resumeFrom` skips the fresh-round initial state and starts the
// store from a previously committed snapshot (typically loaded from
// localStorage). The RNG still seeds from `seed`: the PRNG state is
// intentionally not persisted (docs/10-persistence.md "RNG state is
// not persisted"), so post-resume spawns diverge from the original
// run.
export function createStore(seed: number, resumeFrom?: State): Store {
  let rng = createRng(seed);
  let committed: State;
  if (resumeFrom !== undefined) {
    committed = resumeFrom;
  } else {
    [committed, rng] = createInitialState(rng);
  }
  const inputQueue: Input[] = [];
  const stepQueue: Step[] = [];
  // Closes the moment a `drop` is dispatched (not when it applies — the
  // pair is committed from the player's perspective as soon as they
  // press down) and reopens when a `spawn` step commits a fresh active
  // piece. Implements the "drop closes the buffer" rule from
  // 08-software-design.md.
  let acceptingInput = committed.active !== null;

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
      if (step.event.kind === 'spawn') acceptingInput = true;
    },
    dispatch: (input) => {
      if (!acceptingInput) return;
      inputQueue.push(input);
      if (input.kind === 'drop') acceptingInput = false;
    },
    restart: (newSeed) => {
      [committed, rng] = createInitialState(createRng(newSeed));
      inputQueue.length = 0;
      stepQueue.length = 0;
      acceptingInput = committed.active !== null;
    },
    randomizePreview: () => {
      if (inputQueue.length > 0 || stepQueue.length > 0) return;
      const [preview, nextRng] = samplePiece(committed.board, rng);
      committed = { ...committed, preview };
      rng = nextRng;
    },
    forceGameOver: () => {
      inputQueue.length = 0;
      stepQueue.length = 0;
      acceptingInput = false;
      const snapshot: State = { ...committed, active: null };
      stepQueue.push({ event: { kind: 'game-over' }, snapshot });
    },
  };
}

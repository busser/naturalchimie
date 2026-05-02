// Animation driver. Pulls one step at a time from the store, plays
// it for the step's duration, and on completion commits the snapshot.
// The renderer asks `getInFlight(now)` each frame to interpolate
// between the prior snapshot and the in-flight step's snapshot.
// See 08-software-design.md ("Animation layer").

import { SPAWN_ROW, type State, type Step } from '../core/state';
import type { Store } from '../store';

const SHIFT_DURATION_MS = 150;
const ROTATE_DURATION_MS = 200;
// Per 05-animations.md: 50 ms per cell of fall distance. Both halves
// fall at the same rate; the slower half (longer drop) sets the step's
// total duration.
const FALL_MS_PER_CELL = 50;
// 05-animations.md gives 200 ms (white bloom) + 150 ms (new element
// fade-in) as starting values. The renderer's effects.ts uses this
// budget for shine (~100 ms) + bubble travel (~340 ms peak) + pop
// (~70 ms): each cell shines, pops into bubbles of light, those
// converge and merge into a growing central orb that pops to reveal
// the new tier sprite. See effects.ts for the timeline.
export const MERGE_DURATION_MS = 510;
// Per 05-animations.md "Gravity fall": 50 ms per cell of fall
// distance, all columns animating in parallel. The 80 ms
// "inter-cascade pause" lives at the end of the gravity step — the
// renderer clamps the fall tween at t=1 and the residual time is a
// dead beat for the eye to catch up before the next merge fires.
export const GRAVITY_MS_PER_CELL = 50;
export const INTER_CASCADE_PAUSE_MS = 80;
// Per 05-animations.md "Preview window animation", reshaped for our
// sidebar-on-the-left layout: prev preview slides out of the preview
// recess, then the new active slides into the spawn row, then the new
// preview slides into the recess. Renderers split the step's `t`
// against these phase boundaries. Strictly sequential — overlapping
// phases 1 and 2 broke the illusion of one piece moving from preview
// to spawn area (the prev preview was leaving while a duplicate of it
// was already arriving).
export const SPAWN_PHASE_OUT_MS = 200;
export const SPAWN_PHASE_DOWN_MS = 200;
export const SPAWN_PHASE_IN_MS = 200;
export const SPAWN_DURATION_MS =
  SPAWN_PHASE_OUT_MS + SPAWN_PHASE_DOWN_MS + SPAWN_PHASE_IN_MS;

export type InFlight = {
  readonly step: Step;
  readonly prevSnapshot: State;
  readonly t: number;
};

export type Driver = {
  tick(now: number): void;
  getInFlight(now: number): InFlight | null;
  reset(): void;
};

type Current = {
  readonly step: Step;
  readonly prevSnapshot: State;
  readonly startNow: number;
};

export function createDriver(store: Store): Driver {
  let current: Current | null = null;

  function tick(now: number): void {
    // Loop so a frame can drain multiple zero-duration steps
    // back-to-back. For non-zero durations the inner branch returns
    // and we resume next frame.
    while (true) {
      if (current === null) {
        const step = store.peekNextStep();
        if (step === null) return;
        current = { step, prevSnapshot: store.getSnapshot(), startNow: now };
      }
      const duration = stepDuration(current.step);
      if (now - current.startNow < duration) return;
      store.commitNextStep();
      current = null;
    }
  }

  function getInFlight(now: number): InFlight | null {
    if (current === null) return null;
    const duration = stepDuration(current.step);
    const t = duration === 0
      ? 1
      : Math.min(1, (now - current.startNow) / duration);
    return { step: current.step, prevSnapshot: current.prevSnapshot, t };
  }

  return {
    tick,
    getInFlight,
    reset: () => {
      current = null;
    },
  };
}

function stepDuration(step: Step): number {
  switch (step.event.kind) {
    case 'pair-shift':
      return SHIFT_DURATION_MS;
    case 'pair-rotate':
      return ROTATE_DURATION_MS;
    case 'pair-land': {
      // Vertical pairs spawn straddling the spawn row (bottom at
      // SPAWN_ROW - 0.5, top at SPAWN_ROW + 0.5), so the bottom half's
      // fall is half a cell shorter than its target row would suggest
      // and the top half's is half a cell longer. Either way the
      // larger distance dominates the step duration; the per-half
      // tweens use the precise distance to stay in sync at 50 ms/cell.
      const firstDistance = SPAWN_ROW - step.event.firstLandingRow;
      const secondDistance = SPAWN_ROW - step.event.secondLandingRow;
      return FALL_MS_PER_CELL * Math.max(firstDistance, secondDistance);
    }
    case 'solo-land':
      return FALL_MS_PER_CELL * (SPAWN_ROW - step.event.landingRow);
    case 'spawn':
      return SPAWN_DURATION_MS;
    case 'merge':
      return MERGE_DURATION_MS;
    case 'gravity': {
      let maxDistance = 0;
      for (const m of step.event.movements) {
        const distance = m.from.row - m.to.row;
        if (distance > maxDistance) maxDistance = distance;
      }
      return GRAVITY_MS_PER_CELL * maxDistance + INTER_CASCADE_PAUSE_MS;
    }
    case 'detonate':
    case 'dynamite-blast':
    case 'game-over':
      // Durations land alongside each step's implementation.
      return 0;
  }
}

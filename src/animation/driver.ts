// Animation driver. Pulls one step at a time from the store, plays
// it for the step's duration, and on completion commits the snapshot.
// The renderer asks `getInFlight(now)` each frame to interpolate
// between the prior snapshot and the in-flight step's snapshot.
// See 08-software-design.md ("Animation layer").

import { SPAWN_ROW, type State, type Step } from '../core/state';
import { gameOverEffectDurationMs } from '../renderer/game-over-plan';
import type { Store } from '../store';

const SHIFT_DURATION_MS = 150;
const ROTATE_DURATION_MS = 200;
// Per 05-animations.md: 50 ms per cell of fall distance with ease-in.
// Both halves of a pair fall at the same rate; the slower half (longer
// drop) sets the step's total duration. Exported because the dynamite
// blast extends the drop's motion into the fireball — same curve,
// same landing velocity, same per-drop acceleration.
export const FALL_MS_PER_CELL = 50;
// 05-animations.md gives 200 ms (white bloom) + 150 ms (new element
// fade-in) as starting values. The renderer's effects.ts uses this
// budget for shine (~140 ms) + bubble travel (~480 ms peak) + pop
// (~100 ms) + droplet scatter (~250 ms): each cell shines, pops into
// bubbles of light, those converge and merge into a growing central
// orb that pops to reveal the new tier sprite, with a final ring of
// droplets fanning out as if the orb's membrane just burst. See
// effects.ts for the timeline.
export const MERGE_DURATION_MS = 970;
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
// Per 05-animations.md "Dynamite explosion": a fireball descends to
// the floor. The fireball's motion is the continuation of the
// dynamite's drop — same ease-in curve, picking up at the dynamite's
// landing velocity and accelerating onward. The descent time is
// derived from that continuation (see dynamiteDescentDurationMs
// below). After the fireball reaches the floor, the floor-impact
// tail plays out — embers settle, smoke disperses — adding
// BLAST_FLOOR_IMPACT_MS to the step.
export const BLAST_FLOOR_IMPACT_MS = 480;

// The fireball's descent uses the dynamite drop's curve, stretched
// in wall-clock time by this factor. 1.0 = pure physical continuation
// of the drop, which clocks in at ~18 ms per cell and reads as a
// blink. Larger values stretch the whole motion (and slow the start
// proportionally — initial velocity becomes v_landing / scale) so
// the eye can track the fireball. Tuned by feel; the velocity
// profile shape is preserved across scales.
export const FIREBALL_TIME_SCALE = 3;

// Per 05-animations.md "Detonator detonation". The plunger press
// runs first, then the layered detonation effects (initial flash,
// shockwave ring, fireball bloom + dispersion, per-cell debris,
// continuous fireball embers, smoke wisps) share the remaining
// window. SHOCKWAVE_MS_PER_CELL is the rate at which the leading
// concussion ring expands outward — fast enough to precede the
// fireball, so cleared cells see the ring pass through well before
// the flame consumes them. Per-cell engulfment timing is derived
// inside effects.ts from the fireball's actual bloom curve, so
// each cell's sprite vanishes exactly as the visible flame edge
// sweeps past it. The press is long enough for the eye to
// register the wind-up: a too-short press lets the detonation feel
// arbitrary rather than earned.
export const DETONATOR_PRESS_MS = 200;
// ~900 ms is the lifetime of the explosion proper (flash +
// shockwave + fireball bloom and dispersion + smoke). The rest
// covers the long tail of bouncing shrapnel chunks — pieces that
// hit the floor and slide for a while before fading out. Sized
// to fit SHRAPNEL_LIFETIME_MS plus the worst-case engulf delay
// (corner cells, ~80 ms after detonation), so chunks born late
// still have time to fully fade before the step commits.
export const DETONATOR_EFFECTS_MS = 1700;
export const DETONATOR_SHOCKWAVE_MS_PER_CELL = 50;

// Per 05-animations.md "Game over": every element on the board
// unravels into light before the modal appears. The duration is
// computed per-snapshot from the actual BFS propagation + per-orb
// travel times sampled in effects.ts, so the step commits — and
// the reveal fades in — the moment the last orb finishes fading,
// not after a fixed worst-case budget.

// Time the fireball spends descending from landingRow to the floor.
// Derived by treating the dynamite's drop as a partial ease-in over a
// hypothetical full-column fall (SPAWN_ROW cells in
// FALL_MS_PER_CELL * SPAWN_ROW ms) and continuing the same parabola
// past the landing point, then stretched by FIREBALL_TIME_SCALE.
// Closed form for the unscaled descent:
//   FALL_MS_PER_CELL * (sqrt(D * SPAWN_ROW) - D)
// where D = SPAWN_ROW - landingRow is the distance the dynamite fell.
// At D = 0 (column was full when dynamite spawned) the descent is 0.
export function dynamiteDescentDurationMs(landingRow: number): number {
  const distanceFall = SPAWN_ROW - landingRow;
  if (distanceFall <= 0) return 0;
  return (
    FIREBALL_TIME_SCALE *
    FALL_MS_PER_CELL *
    (Math.sqrt(distanceFall * SPAWN_ROW) - distanceFall)
  );
}

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

export function createDriver(
  store: Store,
  onStepCommit?: (step: Step) => void,
): Driver {
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
      const duration = stepDuration(current.step, current.prevSnapshot);
      if (now - current.startNow < duration) return;
      const committed = current.step;
      store.commitNextStep();
      current = null;
      onStepCommit?.(committed);
    }
  }

  function getInFlight(now: number): InFlight | null {
    if (current === null) return null;
    const duration = stepDuration(current.step, current.prevSnapshot);
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

function stepDuration(step: Step, prevSnapshot: State): number {
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
    case 'dynamite-blast':
      return (
        dynamiteDescentDurationMs(step.event.landingRow) +
        BLAST_FLOOR_IMPACT_MS
      );
    case 'detonate':
      return DETONATOR_PRESS_MS + DETONATOR_EFFECTS_MS;
    case 'game-over':
      return gameOverEffectDurationMs(prevSnapshot);
  }
}

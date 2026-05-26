// Game-over: one giant merge.
//
// Every occupied cell on the board takes part in a single reaction
// that targets the center of the visible playfield. The shine, the
// bubble flight, and the central orb are all the same primitives as
// a normal merge - just oversized. Once every bubble has arrived
// the orb doesn't pop: it degrades into a swarm of small light
// bubbles that drift upward off the board and fade to nothing.
//
// The shine staggers row by row, from the overflow rows outward, so
// the eye sees the elements that caused the loss start dissolving
// first and the wave sweeps down the column.
//
// Per-cell timeline:
//   cell.shineStartMs                          - sprite begins brightening
//   cell.burstMs (= start + SHINE)             - sprite vanishes, bubbles emit
//   bubble.arrivalMs                           - bubble absorbed into central orb
//   plan.lastArrivalMs                         - last bubble arrives, orb peaks,
//                                                dissolve begins (drift bubbles
//                                                emit, orb fades and shrinks)
//   plan.orbFadeEndMs (= last + ORB_FADE)      - central orb fully faded
//   plan.endMs                                 - last dissolve bubble has faded
//
// Consumed by the renderer (to draw shine, converging bubbles, orb,
// dissolve bubbles) and the animation driver (to know when the step
// should commit so the modal reveal lands the moment the last
// dissolve bubble finishes). Both must see the same sampled jitter,
// so the plan is built once per snapshot and cached. Lives in its
// own module to avoid a circular import between effects.ts and
// driver.ts.
//
// Spec: docs/05-animations.md ("Game over").

import type { State } from "../core/state";
import {
  BUBBLES_PER_CELL,
  BUBBLE_BASE_RADIUS_MAX_CELLS,
  BUBBLE_BASE_RADIUS_MIN_CELLS,
  BUBBLE_SCATTER_DISTANCE_MAX_CELLS,
  BUBBLE_SCATTER_DISTANCE_MIN_CELLS,
  SHINE_DURATION_MS,
} from "./merge-constants";

// Center of the visible playfield (rows 0-6, columns 0-6). All cells
// on the board converge here regardless of where the loss happened.
const LANDING_ROW = 3;
const LANDING_COLUMN = 3;

// Rows 7 and 8 are the overflow zone (see core/state.ts). Cells at
// or above this row are the elements that caused the loss; they
// start shining at t=0 and the wave staggers downward from there.
const OVERFLOW_ROW_MIN = 7;
// Stagger from overflow rows outward: a far-from-overflow row starts
// over a second after the overflow. Slow enough to read as a
// propagation sweep down the board, but the wave never reverses or
// branches - it's one big merge being kicked off row by row.
const STAGGER_STEP_MS = 180;
const STAGGER_JITTER_MS = 75;

// Converging bubbles travel longer than in a normal merge because
// they cover much larger distances - up to 6+ cells from a corner
// to the center. Reusing the merge's 280-480 ms range made the
// fastest bubbles read as visually brutal across that span; this
// roughly doubles travel time so even corner bubbles feel like they
// drift rather than rush.
const CONVERGE_TRAVEL_MIN_MS = 550;
const CONVERGE_TRAVEL_MAX_MS = 900;

// After the last bubble arrives, the central orb starts fading and
// shrinking. Its alpha fades to zero over ORB_FADE_MS while its
// radius shrinks linearly to zero over the same window. Ease-in
// fade: the orb stays bright at first so the moment of dissolution
// is legible, then drops away as the drift bubbles take over.
export const ORB_FADE_MS = 350;

// Dissolve bubbles released from the central orb at lastArrivalMs.
// Counts, sizes, and trajectories match the orbs from the previous
// game-over animation: a generous handful arc upward, drift outward,
// then shrink and fade together at the end of their lives.
const DISSOLVE_BUBBLE_COUNT = 36;
const DISSOLVE_TRAVEL_MIN_MS = 1900;
const DISSOLVE_TRAVEL_MAX_MS = 2500;
export const DISSOLVE_TAIL_FADE_MS = 280;
// Radius shrinks over the last stretch of a bubble's life, reaching
// zero exactly when the alpha fade does. Spread over a long window so
// the dissipation reads as energy slowly running out rather than
// bubbles blinking off in place.
export const DISSOLVE_SHRINK_MS = 900;

const REFERENCE_CELL_PX = 48;
// Bubbles a touch larger than merge bubbles. The trajectory is the
// focal point, not a quick flicker - bubbles need readable mass the
// whole way along.
const DISSOLVE_RADIUS_MIN_CELLS = 5.0 / REFERENCE_CELL_PX;
const DISSOLVE_RADIUS_MAX_CELLS = 7.5 / REFERENCE_CELL_PX;
// Bezier control point: pushed out from the origin in any direction
// (full 360 deg), creating the lateral bulge of the arc.
const DISSOLVE_CONTROL_DIST_MIN_CELLS = 1.4;
const DISSOLVE_CONTROL_DIST_MAX_CELLS = 2.8;
// Endpoint angle, measured counter-clockwise from +x. pi/2 is
// straight up; the range below is a wide upper fan (~14..166 deg),
// so every bubble drifts upward with horizontal spread.
const DISSOLVE_END_ANGLE_MIN_RAD = Math.PI / 2 - Math.PI / 2.3;
const DISSOLVE_END_ANGLE_MAX_RAD = Math.PI / 2 + Math.PI / 2.3;
const DISSOLVE_END_DIST_MIN_CELLS = 4.5;
const DISSOLVE_END_DIST_MAX_CELLS = 7.0;

export type ConvergeBubble = {
  readonly originRow: number;
  readonly originColumn: number;
  readonly burstMs: number;
  readonly arrivalMs: number;
  readonly travelMs: number;
  readonly scatterAngleRad: number;
  readonly scatterDistanceCells: number;
  readonly baseRadiusCells: number;
  readonly hue: "white" | "pale-yellow";
};

export type ConvergeCell = {
  readonly row: number;
  readonly column: number;
  readonly shineStartMs: number;
  readonly burstMs: number;
};

export type DissolveBubble = {
  readonly travelMs: number;
  readonly controlAngleRad: number;
  readonly controlDistanceCells: number;
  readonly endAngleRad: number;
  readonly endDistanceCells: number;
  readonly baseRadiusCells: number;
  readonly hue: "white" | "pale-yellow";
};

export type GameOverPlan = {
  readonly landing: { readonly row: number; readonly column: number };
  readonly cells: readonly ConvergeCell[];
  readonly bubbles: readonly ConvergeBubble[];
  readonly dissolveBubbles: readonly DissolveBubble[];
  readonly lastArrivalMs: number;
  readonly orbFadeEndMs: number;
  readonly endMs: number;
};

const planCache = new WeakMap<State, GameOverPlan>();

export function getGameOverPlan(snapshot: State): GameOverPlan {
  let plan = planCache.get(snapshot);
  if (plan === undefined) {
    plan = buildPlan(snapshot);
    planCache.set(snapshot, plan);
  }
  return plan;
}

// Duration of the game-over animation for `snapshot`, in ms. Driven
// by the cached plan so the moment the step commits matches the
// moment the last dissolve bubble has visibly faded.
export function gameOverEffectDurationMs(snapshot: State): number {
  return getGameOverPlan(snapshot).endMs;
}

function buildPlan(snapshot: State): GameOverPlan {
  const landing = { row: LANDING_ROW, column: LANDING_COLUMN };
  const cells: ConvergeCell[] = [];
  const bubbles: ConvergeBubble[] = [];
  let lastArrivalMs = 0;
  for (let r = 0; r < snapshot.board.length; r++) {
    const row = snapshot.board[r];
    for (let c = 0; c < row.length; c++) {
      if (row[c].kind === "empty") continue;
      const stagger =
        r >= OVERFLOW_ROW_MIN ? 0 : (OVERFLOW_ROW_MIN - r) * STAGGER_STEP_MS;
      const jitter = (Math.random() * 2 - 1) * STAGGER_JITTER_MS;
      const shineStartMs = Math.max(0, stagger + jitter);
      const burstMs = shineStartMs + SHINE_DURATION_MS;
      cells.push({ row: r, column: c, shineStartMs, burstMs });
      // Distribute bubble angles around the circle so they fan out
      // of the cell instead of clumping. Per-bubble jitter keeps the
      // swarm from looking gridded.
      const baseAngle = Math.random() * Math.PI * 2;
      for (let i = 0; i < BUBBLES_PER_CELL; i++) {
        const angle =
          baseAngle +
          (i * (Math.PI * 2)) / BUBBLES_PER_CELL +
          (Math.random() - 0.5) * 0.4;
        const travelMs = lerp(
          CONVERGE_TRAVEL_MIN_MS,
          CONVERGE_TRAVEL_MAX_MS,
          Math.random(),
        );
        const arrivalMs = burstMs + travelMs;
        if (arrivalMs > lastArrivalMs) lastArrivalMs = arrivalMs;
        bubbles.push({
          originRow: r,
          originColumn: c,
          burstMs,
          arrivalMs,
          travelMs,
          scatterAngleRad: angle,
          scatterDistanceCells: lerp(
            BUBBLE_SCATTER_DISTANCE_MIN_CELLS,
            BUBBLE_SCATTER_DISTANCE_MAX_CELLS,
            Math.random(),
          ),
          baseRadiusCells: lerp(
            BUBBLE_BASE_RADIUS_MIN_CELLS,
            BUBBLE_BASE_RADIUS_MAX_CELLS,
            Math.random(),
          ),
          hue: Math.random() < 0.55 ? "white" : "pale-yellow",
        });
      }
    }
  }
  const dissolveBubbles: DissolveBubble[] = [];
  const dissolveBaseAngle = Math.random() * Math.PI * 2;
  let dissolveMaxLifetimeMs = 0;
  for (let i = 0; i < DISSOLVE_BUBBLE_COUNT; i++) {
    const controlAngle =
      dissolveBaseAngle +
      (i * (Math.PI * 2)) / DISSOLVE_BUBBLE_COUNT +
      (Math.random() - 0.5) * 0.4;
    const travelMs = lerp(
      DISSOLVE_TRAVEL_MIN_MS,
      DISSOLVE_TRAVEL_MAX_MS,
      Math.random(),
    );
    const lifetimeMs = travelMs + DISSOLVE_TAIL_FADE_MS;
    if (lifetimeMs > dissolveMaxLifetimeMs) dissolveMaxLifetimeMs = lifetimeMs;
    dissolveBubbles.push({
      travelMs,
      controlAngleRad: controlAngle,
      controlDistanceCells: lerp(
        DISSOLVE_CONTROL_DIST_MIN_CELLS,
        DISSOLVE_CONTROL_DIST_MAX_CELLS,
        Math.random(),
      ),
      endAngleRad: lerp(
        DISSOLVE_END_ANGLE_MIN_RAD,
        DISSOLVE_END_ANGLE_MAX_RAD,
        Math.random(),
      ),
      endDistanceCells: lerp(
        DISSOLVE_END_DIST_MIN_CELLS,
        DISSOLVE_END_DIST_MAX_CELLS,
        Math.random(),
      ),
      baseRadiusCells: lerp(
        DISSOLVE_RADIUS_MIN_CELLS,
        DISSOLVE_RADIUS_MAX_CELLS,
        Math.random(),
      ),
      hue: Math.random() < 0.55 ? "white" : "pale-yellow",
    });
  }
  const orbFadeEndMs = lastArrivalMs + ORB_FADE_MS;
  const endMs = lastArrivalMs + dissolveMaxLifetimeMs;
  return {
    landing,
    cells,
    bubbles,
    dissolveBubbles,
    lastArrivalMs,
    orbFadeEndMs,
    endMs,
  };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

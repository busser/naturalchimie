// Game-over unraveling: shared plan construction.
//
// Every occupied cell dissolves into a handful of light orbs that arc
// outward and upward along a quadratic-Bezier path. Cells don't all
// light up at once: the unraveling spreads from the overflow rows
// (where the loss originated) outward through orthogonally-connected
// occupied cells, then a final straggler sweep catches anything the
// BFS couldn't reach.
//
// Per-cell timeline:
//   cell.shineStartMs                — sprite begins brightening
//   cell.burstMs (= start + SHINE)   — sprite vanishes, orbs burst
//   orb.startMs + orb.travelMs       — orb has reached its endpoint
//   ..+ UNRAVEL_TAIL_FADE_MS         — orb fully faded
//
// This module is consumed by two callers: the renderer (to draw the
// shine halos and orbs) and the animation driver (to know when the
// step should commit so the reveal fires the moment the last orb
// finishes fading). Both must see the same sampled jitter, so the
// plan is built once per snapshot and cached. Lives in its own
// module to avoid a circular import between effects.ts and
// driver.ts.
//
// Spec: docs/05-animations.md ("Game over").

import type { State } from "../core/state";

// Reference cell size the original pixel-tuned values were authored
// against. Constants below were divided by this once so they read as
// cell-units; the renderer multiplies by the live cellSize.
const REFERENCE_CELL_PX = 48;

// Overflow rows (0-indexed) — these are the cells whose presence on
// a stable board triggers the loss; BFS phase A starts from every
// occupied cell here. Mirrors apply.ts's OVERFLOW_ROW_MIN.
const UNRAVEL_OVERFLOW_ROW_MIN = 7;
// Delay before a cell triggers each of its occupied neighbors,
// sampled uniformly in [STEP - JITTER, STEP + JITTER] independently
// per propagation edge so the wave doesn't advance in lockstep. The
// spec's starting value was 80 ms per step with ±25 ms jitter;
// tuned slower and much wider so a fast far-away path can outrun a
// slow near path — the front dissolves into a scatter rather than
// reading as a rank-by-rank advance. The 5:1 max/min ratio is what
// makes the wave look genuinely organic.
const UNRAVEL_BFS_STEP_MS = 750;
const UNRAVEL_BFS_STEP_JITTER_MS = 500;
// Phase B (straggler sweep): how long after the last phase-A cell
// started, and the per-cell jitter applied to that base time. Rare
// in practice — dense boards usually leave every occupied cell
// reachable from the overflow.
const UNRAVEL_PHASE_B_GAP_MS = 250;
const UNRAVEL_PHASE_B_JITTER_MS = 120;
export const UNRAVEL_SHINE_MS = 220;
const UNRAVEL_TRAVEL_MIN_MS = 1900;
const UNRAVEL_TRAVEL_MAX_MS = 2500;
export const UNRAVEL_TAIL_FADE_MS = 280;
// Radius shrinks over the last stretch of an orb's life, reaching
// zero exactly when the alpha fade does. Spread over a long window
// so the dissipation reads as energy slowly running out rather than
// orbs blinking off in place. Linear ramp: the loss is distributed
// evenly across the window so the orb visibly thins from the start
// of the shrink rather than clinging to full mass until the very end.
export const UNRAVEL_SHRINK_MS = 900;

const UNRAVEL_ORBS_PER_CELL = 8;
// Larger than merge bubbles. The trajectory is the focal point, not
// a quick flicker — orbs need readable mass the whole way along.
const UNRAVEL_ORB_RADIUS_MIN_CELLS = 5.0 / REFERENCE_CELL_PX;
const UNRAVEL_ORB_RADIUS_MAX_CELLS = 7.5 / REFERENCE_CELL_PX;

// Bezier control point: pushed out from the cell in any direction
// (full 360°), creating the lateral bulge of the arc.
const UNRAVEL_CONTROL_DIST_MIN_CELLS = 1.4;
const UNRAVEL_CONTROL_DIST_MAX_CELLS = 2.8;
// Endpoint angle, measured counter-clockwise from +x. π/2 is
// straight up; the range below is a wide upper fan (~14°..166°),
// so every orb drifts upward with horizontal spread.
const UNRAVEL_END_ANGLE_MIN_RAD = Math.PI / 2 - Math.PI / 2.3;
const UNRAVEL_END_ANGLE_MAX_RAD = Math.PI / 2 + Math.PI / 2.3;
const UNRAVEL_END_DIST_MIN_CELLS = 4.5;
const UNRAVEL_END_DIST_MAX_CELLS = 7.0;

export type UnravelOrb = {
  readonly cellRow: number;
  readonly cellColumn: number;
  readonly startMs: number;
  readonly travelMs: number;
  readonly controlAngleRad: number;
  readonly controlDistanceCells: number;
  readonly endAngleRad: number;
  readonly endDistanceCells: number;
  readonly baseRadiusCells: number;
  readonly hue: "white" | "pale-yellow";
};

export type UnravelCell = {
  readonly row: number;
  readonly column: number;
  readonly shineStartMs: number;
  readonly burstMs: number;
  readonly orbs: readonly UnravelOrb[];
};

export type UnravelPlan = {
  readonly cells: readonly UnravelCell[];
  // Wall-clock offset (from step start) at which the last orb has
  // fully faded — i.e., the earliest moment the reveal can take
  // over without cutting off a still-visible orb.
  readonly endMs: number;
};

const unravelPlanCache = new WeakMap<State, UnravelPlan>();

export function getUnravelPlan(snapshot: State): UnravelPlan {
  let plan = unravelPlanCache.get(snapshot);
  if (plan === undefined) {
    plan = buildUnravelPlan(snapshot);
    unravelPlanCache.set(snapshot, plan);
  }
  return plan;
}

// Duration of the game-over unravel for `snapshot`, in ms. Driven
// by the cached plan so the moment the step commits matches the
// moment the last orb has visibly faded.
export function gameOverEffectDurationMs(snapshot: State): number {
  return getUnravelPlan(snapshot).endMs;
}

function buildUnravelPlan(snapshot: State): UnravelPlan {
  const shineStartByKey = computeUnravelShineStarts(snapshot);
  const cells: UnravelCell[] = [];
  let endMs = 0;
  for (let r = 0; r < snapshot.board.length; r++) {
    const row = snapshot.board[r];
    for (let c = 0; c < row.length; c++) {
      const cell = row[c];
      if (cell.kind === "empty") continue;
      const shineStartMs = shineStartByKey.get(cellKey(r, c)) ?? 0;
      const burstMs = shineStartMs + UNRAVEL_SHINE_MS;
      // Distribute control angles around the circle so orbs fan out
      // rather than clustering. Per-orb jitter keeps them un-gridded.
      const baseControlAngle = Math.random() * Math.PI * 2;
      const orbs: UnravelOrb[] = [];
      for (let i = 0; i < UNRAVEL_ORBS_PER_CELL; i++) {
        const controlAngle =
          baseControlAngle +
          (i * (Math.PI * 2)) / UNRAVEL_ORBS_PER_CELL +
          (Math.random() - 0.5) * 0.4;
        const travelMs = lerp(
          UNRAVEL_TRAVEL_MIN_MS,
          UNRAVEL_TRAVEL_MAX_MS,
          Math.random(),
        );
        orbs.push({
          cellRow: r,
          cellColumn: c,
          startMs: burstMs,
          travelMs,
          controlAngleRad: controlAngle,
          controlDistanceCells: lerp(
            UNRAVEL_CONTROL_DIST_MIN_CELLS,
            UNRAVEL_CONTROL_DIST_MAX_CELLS,
            Math.random(),
          ),
          endAngleRad: lerp(
            UNRAVEL_END_ANGLE_MIN_RAD,
            UNRAVEL_END_ANGLE_MAX_RAD,
            Math.random(),
          ),
          endDistanceCells: lerp(
            UNRAVEL_END_DIST_MIN_CELLS,
            UNRAVEL_END_DIST_MAX_CELLS,
            Math.random(),
          ),
          baseRadiusCells: lerp(
            UNRAVEL_ORB_RADIUS_MIN_CELLS,
            UNRAVEL_ORB_RADIUS_MAX_CELLS,
            Math.random(),
          ),
          hue: Math.random() < 0.55 ? "white" : "pale-yellow",
        });
        const orbEndMs = burstMs + travelMs + UNRAVEL_TAIL_FADE_MS;
        if (orbEndMs > endMs) endMs = orbEndMs;
      }
      cells.push({ row: r, column: c, shineStartMs, burstMs, orbs });
    }
  }
  return { cells, endMs };
}

// Propagates the unraveling outward from the overflow rows. Phase A
// is a Dijkstra-style BFS where each edge takes
// UNRAVEL_BFS_STEP_MS ± UNRAVEL_BFS_STEP_JITTER_MS, sampled
// independently per propagation. A cell's start time is the earliest
// arrival from any source. Phase B sweeps up cells the BFS couldn't
// reach (occupied cells with no orthogonal path back to an overflow
// cell) — rare on real lose-state boards, but the spec defines it
// for completeness.
function computeUnravelShineStarts(snapshot: State): Map<string, number> {
  const startTimes = new Map<string, number>();
  type Entry = { row: number; column: number; time: number };
  const pending: Entry[] = [];
  const rows = snapshot.board.length;
  for (let r = UNRAVEL_OVERFLOW_ROW_MIN; r < rows; r++) {
    const row = snapshot.board[r];
    if (!row) continue;
    for (let c = 0; c < row.length; c++) {
      if (row[c].kind === "empty") continue;
      const key = cellKey(r, c);
      startTimes.set(key, 0);
      pending.push({ row: r, column: c, time: 0 });
    }
  }
  let phaseAMaxStart = 0;
  while (pending.length > 0) {
    let minIdx = 0;
    for (let i = 1; i < pending.length; i++) {
      if (pending[i].time < pending[minIdx].time) minIdx = i;
    }
    const current = pending.splice(minIdx, 1)[0];
    const currentKey = cellKey(current.row, current.column);
    // Skip stale entries: a later push may have lowered this cell's
    // best-known time, in which case we've already propagated from
    // the better value.
    if (startTimes.get(currentKey) !== current.time) continue;
    if (current.time > phaseAMaxStart) phaseAMaxStart = current.time;
    const neighbors: ReadonlyArray<readonly [number, number]> = [
      [current.row - 1, current.column],
      [current.row + 1, current.column],
      [current.row, current.column - 1],
      [current.row, current.column + 1],
    ];
    for (const [nr, nc] of neighbors) {
      const nRow = snapshot.board[nr];
      if (!nRow) continue;
      const nCell = nRow[nc];
      if (!nCell || nCell.kind === "empty") continue;
      const nKey = cellKey(nr, nc);
      const delay =
        UNRAVEL_BFS_STEP_MS +
        (Math.random() * 2 - 1) * UNRAVEL_BFS_STEP_JITTER_MS;
      const arrival = current.time + delay;
      const existing = startTimes.get(nKey);
      if (existing === undefined || arrival < existing) {
        startTimes.set(nKey, arrival);
        pending.push({ row: nr, column: nc, time: arrival });
      }
    }
  }
  const phaseBBase = phaseAMaxStart + UNRAVEL_PHASE_B_GAP_MS;
  for (let r = 0; r < rows; r++) {
    const row = snapshot.board[r];
    for (let c = 0; c < row.length; c++) {
      if (row[c].kind === "empty") continue;
      const key = cellKey(r, c);
      if (startTimes.has(key)) continue;
      const jitter = (Math.random() * 2 - 1) * UNRAVEL_PHASE_B_JITTER_MS;
      startTimes.set(key, phaseBBase + jitter);
    }
  }
  return startTimes;
}

function cellKey(row: number, column: number): string {
  return `${row},${column}`;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

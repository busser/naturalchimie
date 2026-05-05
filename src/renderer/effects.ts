// Renders animated effects for cascade-stage steps. Today: the merge
// (shine → bubbles fly in arcs to landing → central orb grows in
// bumps → orb pops, droplets scatter around the new sprite) and
// gravity (cells slide down to repack their column). The playfield
// asks for an Effect when the in-flight step changes, removes
// effect.skipCells from its normal board pass, and calls effect.draw
// on top.
//
// Each effect captures its own startNow so it can read elapsed time
// directly from the frame's `now`, independent of the driver's `t`.
// Bubble paths and arrival times are seeded once at construction
// with Math.random — every merge looks slightly different, and per
// cell the bubbles arrive in distinct, visible bumps.
//
// Spec: docs/05-animations.md ("The merge animation", "Gravity fall").

import {
  BLAST_FLOOR_IMPACT_MS,
  DETONATOR_PRESS_MS,
  DETONATOR_SHOCKWAVE_MS_PER_CELL,
  FALL_MS_PER_CELL,
  FIREBALL_TIME_SCALE,
  GRAVITY_MS_PER_CELL,
  dynamiteDescentDurationMs,
} from "../animation/driver";
import type { SpriteAtlas } from "../assets/sprite-loader";
import { drawSpriteAtCell, type SpriteAsset } from "../assets/sprite-renderer";
import {
  SPAWN_ROW,
  type Movement,
  type Pos,
  type ReactingGroup,
  type State,
  type Step,
} from "../core/state";

// Merge animation phases ----------------------------------------
//
// 0..SHINE_DURATION_MS                       — original sprite stays at
//                                              cell, growing white halo
//                                              behind it ("filling with
//                                              energy")
// SHINE_DURATION_MS                          — cell pops; bubbles emerge
// SHINE_DURATION_MS..bubble.arrivalMs        — each bubble traces a
//                                              quadratic Bezier from its
//                                              cell to the group's
//                                              landing, control point
//                                              pushed out in its scatter
//                                              direction. Per-bubble
//                                              travel time is randomized
//                                              so arrivals stagger.
// bubble.arrivalMs                           — bubble absorbed into the
//                                              group's central orb (orb
//                                              steps up in size, brief
//                                              pulse)
// group.lastArrivalMs..+POP_DURATION_MS      — central orb swells and
//                                              snaps off
// group.lastArrivalMs + POP_DURATION_MS      — new tier sprite snaps in
//                                              at full size; droplets
//                                              emit from the orb's
//                                              pop-end perimeter as if
//                                              its membrane just burst
// group.lastArrivalMs + POP_DURATION_MS
//   ..+DROPLET_LIFETIME_MS                   — droplets scatter outward
//                                              with a slight gravity sag
//                                              and fade out
//
// MERGE_DURATION_MS in driver.ts is sized to fit the worst case:
// SHINE_DURATION_MS + BUBBLE_TRAVEL_MAX_MS + POP_DURATION_MS +
// DROPLET_LIFETIME_MS.

const SHINE_DURATION_MS = 140;

const BUBBLES_PER_CELL = 4;
const BUBBLE_TRAVEL_MIN_MS = 280;
const BUBBLE_TRAVEL_MAX_MS = 480;
// The Bezier control point sits at cell + scatterDir * scatterDistance.
// The visible apex of the curve is roughly halfway between cell and
// the control point, so this number is the "how far does P1 push out"
// rather than "how far the bubble travels outward".
const BUBBLE_SCATTER_DISTANCE_MIN_CELLS = 1.1;
const BUBBLE_SCATTER_DISTANCE_MAX_CELLS = 2.0;
const BUBBLE_BASE_RADIUS_MIN_PX = 4.0;
const BUBBLE_BASE_RADIUS_MAX_PX = 6.0;
const BUBBLE_HALO_RADIUS_FACTOR = 2.5;
// Slight growth toward arrival — bubble gathers energy as it pulls in.
const BUBBLE_ARRIVAL_GROWTH = 0.35;

const CENTRAL_ORB_BASE_RADIUS_PX = 3;
// Growth scales with sqrt of the arrival count rather than linearly:
// a 3-cell merge has 12 bubbles, a 5-cell has 20, and linear growth
// blew the orb past a full cell. sqrt keeps the central orb visibly
// growing without dwarfing the playfield.
const CENTRAL_ORB_GROWTH_PX = 2.8;
const CENTRAL_ORB_HALO_RADIUS_FACTOR = 2.0;
// Each arrival kicks a transient size pulse on the central orb so the
// merge bumps are visible. Pulses from concurrent arrivals sum.
const CENTRAL_ORB_PULSE_DURATION_MS = 170;
const CENTRAL_ORB_PULSE_AMOUNT = 0.32;

const POP_DURATION_MS = 100;
const POP_PEAK_SCALE = 1.55;

// Droplets sell the "soap bubble pop" feel: when the orb snaps off,
// a ring of small bright points scatters outward, sags slightly under
// gravity, and fades. Count is fixed (not scaled with merge size) —
// the orb's own radius already grows with cell count, so droplet
// parity isn't perceivable, and a fixed budget keeps overdraw bounded.
const DROPLET_COUNT_PER_GROUP = 10;
const DROPLET_LIFETIME_MS = 250;
// Travel distance is measured outward *from the orb's perimeter*, not
// from its center — droplets fly off the membrane.
const DROPLET_SCATTER_DISTANCE_MIN_CELLS = 0.7;
const DROPLET_SCATTER_DISTANCE_MAX_CELLS = 1.2;
// Smaller than bubbles (4–6 px) so they read as "tiny droplets",
// not "more bubbles".
const DROPLET_BASE_RADIUS_MIN_PX = 2.5;
const DROPLET_BASE_RADIUS_MAX_PX = 4.0;
// Downward sag at end of life, in cell units. Small — droplets are
// flying outward, not falling.
const DROPLET_GRAVITY_CELLS = 0.18;
const DROPLET_SHRINK_FACTOR = 0.35;

const SHINE_HALO_RADIUS_FACTOR = 0.7;

export type RenderItem = {
  readonly sprite: SpriteAsset;
  readonly col: number;
  readonly row: number;
};

export type Effect = {
  // Cells whose normal board rendering must be skipped — the effect
  // owns them either as sprite items (shining originals, post-pop
  // new tier, falling cells) or as glow (bubbles, orbs).
  readonly skipCells: ReadonlySet<string>;
  // Sprite-bound items at their current visual rows. Folded into the
  // playfield's row-descending sort so extruding sprite art occludes
  // correctly across board / falling / merging sprites.
  getSpriteItems(
    now: number,
    prevSnapshot: State,
    sprites: SpriteAtlas,
  ): readonly RenderItem[];
  // Additive glow (halos, bubbles, central orbs). Drawn after the
  // sorted sprite pass — these read as light, not occluding shapes,
  // so they don't need to participate in the sort.
  draw(
    ctx: CanvasRenderingContext2D,
    now: number,
    prevSnapshot: State,
    sprites: SpriteAtlas,
    cellSize: number,
    canvasHeight: number,
  ): void;
  // Optional canvas-wide translation, in CSS pixels, applied around
  // the playfield render pass. The detonator uses this for the
  // screen kick at the moment of detonation; other effects don't
  // need it.
  getCanvasShake?(now: number): { readonly x: number; readonly y: number };
};

export function createEffect(
  step: Step,
  startNow: number,
  prevSnapshot: State,
  sprites: SpriteAtlas,
): Effect | null {
  switch (step.event.kind) {
    case "merge":
      return createMergeEffect(step.event.groups, startNow);
    case "gravity":
      return createGravityEffect(step.event.movements, startNow);
    case "dynamite-blast":
      return createDynamiteBlastEffect(
        step.event.column,
        step.event.landingRow,
        startNow,
      );
    case "detonate":
      return createDetonateEffect(
        step.event.detonators,
        step.event.cleared,
        startNow,
        prevSnapshot,
        sprites,
      );
    default:
      return null;
  }
}

export function cellKey(row: number, column: number): string {
  return `${row},${column}`;
}

// Merge ----------------------------------------------------------

type Bubble = {
  readonly groupIdx: number;
  readonly originRow: number;
  readonly originColumn: number;
  readonly landingRow: number;
  readonly landingColumn: number;
  readonly travelMs: number;
  readonly arrivalMs: number;
  readonly scatterAngleRad: number;
  readonly scatterDistanceCells: number;
  readonly baseRadiusPx: number;
  readonly hue: "white" | "pale-yellow";
};

type Droplet = {
  readonly angleRad: number;
  readonly scatterDistanceCells: number;
  readonly baseRadiusPx: number;
  readonly hue: "white" | "pale-yellow";
};

type GroupState = {
  readonly group: ReactingGroup;
  readonly bubbles: readonly Bubble[];
  readonly droplets: readonly Droplet[];
  readonly lastArrivalMs: number;
};

function createMergeEffect(
  groups: readonly ReactingGroup[],
  startNow: number,
): Effect {
  const skipCells = new Set<string>();
  for (const group of groups) {
    for (const cell of group.cells) {
      skipCells.add(cellKey(cell.row, cell.column));
    }
  }
  const states = seedGroupStates(groups);
  return {
    skipCells,
    getSpriteItems(now, _prev, sprites) {
      const elapsedMs = now - startNow;
      const items: RenderItem[] = [];
      for (const state of states) {
        const popEndMs = state.lastArrivalMs + POP_DURATION_MS;
        if (elapsedMs >= popEndMs) {
          // Phase 4: new tier sprite snapped in at landing.
          items.push({
            sprite: sprites.byTier[state.group.tierAfter],
            col: state.group.landing.column,
            row: state.group.landing.row,
          });
        } else if (elapsedMs < SHINE_DURATION_MS) {
          // Phase 1: originals still at their cells, shining.
          const sprite = sprites.byTier[state.group.tierBefore];
          for (const cell of state.group.cells) {
            items.push({ sprite, col: cell.column, row: cell.row });
          }
        }
      }
      return items;
    },
    draw(ctx, now, _prev, _sprites, cellSize, canvasHeight) {
      const elapsedMs = now - startNow;
      // Halos behind the shining originals. Drawn after sprites with
      // `lighter` composite — the sprite reads as lit up rather than
      // occluded.
      if (elapsedMs < SHINE_DURATION_MS) {
        for (const state of states) {
          drawShineHalos(ctx, state.group, elapsedMs, cellSize, canvasHeight);
        }
      }
      // Bubbles in flight (drawn before the orb so late arrivals
      // converge into it visually).
      for (const state of states) {
        drawBubbles(ctx, state, elapsedMs, cellSize, canvasHeight);
      }
      // Central orb growing in bumps, then the pop swell. The new
      // tier sprite that follows the pop is rendered via getSpriteItems.
      for (const state of states) {
        drawCentralOrbAndPop(ctx, state, elapsedMs, cellSize, canvasHeight);
      }
      // Droplets scatter from the landing center after the pop. Drawn
      // last so they layer above the new tier sprite.
      for (const state of states) {
        drawDroplets(ctx, state, elapsedMs, cellSize, canvasHeight);
      }
    },
  };
}

function seedGroupStates(groups: readonly ReactingGroup[]): GroupState[] {
  const states: GroupState[] = [];
  for (let g = 0; g < groups.length; g++) {
    const group = groups[g];
    const bubbles: Bubble[] = [];
    for (const cell of group.cells) {
      // Distribute angles around the circle so the bubbles fan out
      // rather than clumping in one direction. A small random rotation
      // and per-bubble jitter keep the swarm from looking gridded.
      const baseAngle = Math.random() * Math.PI * 2;
      for (let i = 0; i < BUBBLES_PER_CELL; i++) {
        const angle =
          baseAngle +
          (i * (Math.PI * 2)) / BUBBLES_PER_CELL +
          (Math.random() - 0.5) * 0.4;
        const travelMs = lerp(
          BUBBLE_TRAVEL_MIN_MS,
          BUBBLE_TRAVEL_MAX_MS,
          Math.random(),
        );
        bubbles.push({
          groupIdx: g,
          originRow: cell.row,
          originColumn: cell.column,
          landingRow: group.landing.row,
          landingColumn: group.landing.column,
          travelMs,
          arrivalMs: SHINE_DURATION_MS + travelMs,
          scatterAngleRad: angle,
          scatterDistanceCells: lerp(
            BUBBLE_SCATTER_DISTANCE_MIN_CELLS,
            BUBBLE_SCATTER_DISTANCE_MAX_CELLS,
            Math.random(),
          ),
          baseRadiusPx: lerp(
            BUBBLE_BASE_RADIUS_MIN_PX,
            BUBBLE_BASE_RADIUS_MAX_PX,
            Math.random(),
          ),
          hue: Math.random() < 0.55 ? "white" : "pale-yellow",
        });
      }
    }
    let lastArrivalMs = 0;
    for (const bubble of bubbles) {
      if (bubble.arrivalMs > lastArrivalMs) lastArrivalMs = bubble.arrivalMs;
    }
    const droplets: Droplet[] = [];
    // Same fan-and-jitter pattern as bubbles so droplets don't grid up.
    const dropletBaseAngle = Math.random() * Math.PI * 2;
    for (let i = 0; i < DROPLET_COUNT_PER_GROUP; i++) {
      const angle =
        dropletBaseAngle +
        (i * (Math.PI * 2)) / DROPLET_COUNT_PER_GROUP +
        (Math.random() - 0.5) * 0.5;
      droplets.push({
        angleRad: angle,
        scatterDistanceCells: lerp(
          DROPLET_SCATTER_DISTANCE_MIN_CELLS,
          DROPLET_SCATTER_DISTANCE_MAX_CELLS,
          Math.random(),
        ),
        baseRadiusPx: lerp(
          DROPLET_BASE_RADIUS_MIN_PX,
          DROPLET_BASE_RADIUS_MAX_PX,
          Math.random(),
        ),
        hue: Math.random() < 0.55 ? "white" : "pale-yellow",
      });
    }
    states.push({ group, bubbles, droplets, lastArrivalMs });
  }
  return states;
}

function drawShineHalos(
  ctx: CanvasRenderingContext2D,
  group: ReactingGroup,
  elapsedMs: number,
  cellSize: number,
  canvasHeight: number,
): void {
  const t = clamp01(elapsedMs / SHINE_DURATION_MS);
  // Halo intensity ramps up faster than linear so the cell looks like
  // it's charging up toward the pop.
  const haloIntensity = t * t;
  if (haloIntensity <= 0) return;
  for (const cell of group.cells) {
    const cx = (cell.column + 0.5) * cellSize;
    const cy = canvasHeight - (cell.row + 0.5) * cellSize;
    drawShineHalo(ctx, cx, cy, cellSize, haloIntensity);
  }
}

function drawShineHalo(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  cellSize: number,
  intensity: number,
): void {
  const r = cellSize * SHINE_HALO_RADIUS_FACTOR;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  grad.addColorStop(0, `rgba(255, 255, 255, ${intensity * 0.6})`);
  grad.addColorStop(0.5, `rgba(255, 240, 180, ${intensity * 0.3})`);
  grad.addColorStop(1, "rgba(255, 240, 180, 0)");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawBubbles(
  ctx: CanvasRenderingContext2D,
  state: GroupState,
  elapsedMs: number,
  cellSize: number,
  canvasHeight: number,
): void {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const bubble of state.bubbles) {
    if (elapsedMs < SHINE_DURATION_MS) continue;
    if (elapsedMs >= bubble.arrivalMs) continue; // absorbed
    const travelT = (elapsedMs - SHINE_DURATION_MS) / bubble.travelMs;
    const u = easeOutIn(travelT);
    const cellCx = (bubble.originColumn + 0.5) * cellSize;
    const cellCy = canvasHeight - (bubble.originRow + 0.5) * cellSize;
    const landingCx = (bubble.landingColumn + 0.5) * cellSize;
    const landingCy = canvasHeight - (bubble.landingRow + 0.5) * cellSize;
    // Quadratic Bezier with control point pushed out in the scatter
    // direction. The curve starts at cell heading along scatterDir,
    // bulges outward, and curves back into landing.
    const ctrlX =
      cellCx +
      Math.cos(bubble.scatterAngleRad) * bubble.scatterDistanceCells * cellSize;
    const ctrlY =
      cellCy -
      Math.sin(bubble.scatterAngleRad) * bubble.scatterDistanceCells * cellSize;
    const oneMinus = 1 - u;
    const x =
      oneMinus * oneMinus * cellCx +
      2 * oneMinus * u * ctrlX +
      u * u * landingCx;
    const y =
      oneMinus * oneMinus * cellCy +
      2 * oneMinus * u * ctrlY +
      u * u * landingCy;
    const radius = bubble.baseRadiusPx * (1 + BUBBLE_ARRIVAL_GROWTH * travelT);
    drawBubble(ctx, x, y, radius, 1, bubble.hue);
  }
  ctx.restore();
}

function drawBubble(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  coreRadiusPx: number,
  alpha: number,
  hue: "white" | "pale-yellow",
): void {
  const haloR = coreRadiusPx * BUBBLE_HALO_RADIUS_FACTOR;
  const haloEdge = hue === "white" ? "255, 255, 255" : "255, 247, 200";
  const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, haloR);
  halo.addColorStop(0, `rgba(255, 255, 255, ${alpha * 0.85})`);
  halo.addColorStop(0.45, `rgba(${haloEdge}, ${alpha * 0.4})`);
  halo.addColorStop(1, `rgba(${haloEdge}, 0)`);
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(cx, cy, haloR, 0, Math.PI * 2);
  ctx.fill();
  const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreRadiusPx);
  core.addColorStop(0, `rgba(255, 255, 255, ${alpha})`);
  core.addColorStop(1, "rgba(255, 255, 255, 0)");
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(cx, cy, coreRadiusPx, 0, Math.PI * 2);
  ctx.fill();
}

function drawCentralOrbAndPop(
  ctx: CanvasRenderingContext2D,
  state: GroupState,
  elapsedMs: number,
  cellSize: number,
  canvasHeight: number,
): void {
  const { group, bubbles, lastArrivalMs } = state;
  const popEndMs = lastArrivalMs + POP_DURATION_MS;
  // Post-pop: new tier sprite is rendered via getSpriteItems.
  if (elapsedMs >= popEndMs) return;
  let arrivedCount = 0;
  let pulse = 0;
  for (const bubble of bubbles) {
    if (elapsedMs < bubble.arrivalMs) continue;
    arrivedCount++;
    const sinceArrival = elapsedMs - bubble.arrivalMs;
    if (sinceArrival < CENTRAL_ORB_PULSE_DURATION_MS) {
      const u = sinceArrival / CENTRAL_ORB_PULSE_DURATION_MS;
      // Triangle-ish pulse: peaks immediately, decays smoothly.
      pulse += (1 - u) * (1 - u) * CENTRAL_ORB_PULSE_AMOUNT;
    }
  }
  if (arrivedCount === 0) return;
  let radius =
    CENTRAL_ORB_BASE_RADIUS_PX +
    CENTRAL_ORB_GROWTH_PX * Math.sqrt(arrivedCount);
  radius *= 1 + pulse;
  // Pop swell: orb keeps growing through POP_DURATION_MS, then snaps
  // off when popEndMs is reached (handled by the early return above).
  if (elapsedMs >= lastArrivalMs) {
    const popT = clamp01((elapsedMs - lastArrivalMs) / POP_DURATION_MS);
    // Ease-out so the swell looks snappy rather than linear.
    const swell = 1 - (1 - popT) * (1 - popT);
    radius *= 1 + swell * (POP_PEAK_SCALE - 1);
  }
  const cx = (group.landing.column + 0.5) * cellSize;
  const cy = canvasHeight - (group.landing.row + 0.5) * cellSize;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  drawCentralOrb(ctx, cx, cy, radius, 1);
  ctx.restore();
}

function drawCentralOrb(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radiusPx: number,
  alpha: number,
): void {
  const haloR = radiusPx * CENTRAL_ORB_HALO_RADIUS_FACTOR;
  const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, haloR);
  halo.addColorStop(0, `rgba(255, 255, 255, ${alpha * 0.9})`);
  halo.addColorStop(0.4, `rgba(255, 240, 180, ${alpha * 0.5})`);
  halo.addColorStop(1, "rgba(255, 240, 180, 0)");
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(cx, cy, haloR, 0, Math.PI * 2);
  ctx.fill();
  const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, radiusPx);
  core.addColorStop(0, `rgba(255, 255, 255, ${alpha})`);
  core.addColorStop(0.7, `rgba(255, 250, 200, ${alpha * 0.7})`);
  core.addColorStop(1, "rgba(255, 250, 200, 0)");
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(cx, cy, radiusPx, 0, Math.PI * 2);
  ctx.fill();
}

function drawDroplets(
  ctx: CanvasRenderingContext2D,
  state: GroupState,
  elapsedMs: number,
  cellSize: number,
  canvasHeight: number,
): void {
  const { group, droplets, lastArrivalMs } = state;
  const popEndMs = lastArrivalMs + POP_DURATION_MS;
  const dropletEndMs = popEndMs + DROPLET_LIFETIME_MS;
  if (elapsedMs < popEndMs || elapsedMs >= dropletEndMs) return;
  const t01 = (elapsedMs - popEndMs) / DROPLET_LIFETIME_MS;
  // Outward motion eases out: shoot fast at the moment of pop, settle
  // toward the end of life.
  const u = 1 - (1 - t01) * (1 - t01);
  // Quadratic fade so droplets are bright early, gone cleanly at end.
  const alpha = (1 - t01) * (1 - t01);
  const radiusFactor = 1 - DROPLET_SHRINK_FACTOR * t01;
  const sag = DROPLET_GRAVITY_CELLS * t01 * t01 * cellSize;
  const cx = (group.landing.column + 0.5) * cellSize;
  const cy = canvasHeight - (group.landing.row + 0.5) * cellSize;
  // Orb radius at popEndMs: every bubble has arrived (so arrivedCount
  // equals bubbles.length), the pulse contribution has effectively
  // decayed, and the swell has reached POP_PEAK_SCALE. Reusing the
  // orb's own formula keeps the droplet emission ring tied to the
  // visible membrane the player just saw burst.
  const orbPopRadiusPx =
    POP_PEAK_SCALE *
    (CENTRAL_ORB_BASE_RADIUS_PX +
      CENTRAL_ORB_GROWTH_PX * Math.sqrt(state.bubbles.length));
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const droplet of droplets) {
    const dist = orbPopRadiusPx + u * droplet.scatterDistanceCells * cellSize;
    const x = cx + Math.cos(droplet.angleRad) * dist;
    const y = cy - Math.sin(droplet.angleRad) * dist + sag;
    drawBubble(
      ctx,
      x,
      y,
      droplet.baseRadiusPx * radiusFactor,
      alpha,
      droplet.hue,
    );
  }
  ctx.restore();
}

// Dynamite blast -------------------------------------------------
//
// Phases per 05-animations.md, with the renderer's enhancements:
//
// 0..descentDurationMs                 — a fireball larger than one
//                                        cell descends from
//                                        landingRow to the floor,
//                                        continuing the dynamite's
//                                        drop motion: same ease-in
//                                        curve, picking up at the
//                                        dynamite's landing velocity
//                                        and accelerating onward, as
//                                        if the dynamite was powering
//                                        through the column without
//                                        resistance. Its leading
//                                        core, body, and trailing
//                                        wake form a teardrop that
//                                        swallows every cell in its
//                                        path. Embers shed
//                                        continuously off its body
//                                        and smoke wisps trail
//                                        behind.
// ..+ BLAST_FLOOR_IMPACT_MS            — floor impact: a wider
//                                        terminal flash, embers
//                                        fanned sideways along the
//                                        floor, a column of smoke
//                                        puffs drifting upward.
//
// The effect owns every cell of the column from row 0 up to and
// including landingRow: prevSnapshot has the original elements there
// (the solo-land step left the board untouched), and they need to
// disappear progressively as the fireball passes through. The
// committed snapshot at end-of-step has those rows empty, so once
// the step commits the renderer falls back to its normal empty-cell
// rendering.
//
// All particle paths are seeded once at construction with
// Math.random — the animation is deterministic from elapsed time
// onward, so frame-rate stutters don't shift particle positions.

// Fireball geometry, in cell-units relative to the fireball's center.
// Wake offset > leading offset so the fireball reads as a teardrop
// pointing downward (a moving body with a tail), not a circle. Body
// radius > 1 cell so the fireball spreads visibly into adjacent
// columns — additive blending onto neighbors reads as the fireball's
// heat lighting up the surrounding playfield, not as a containment
// problem.
const FIREBALL_LEADING_OFFSET = 0.55;
const FIREBALL_WAKE_OFFSET = 1.25;
const FIREBALL_LEADING_RADIUS = 1.0;
const FIREBALL_BODY_RADIUS = 1.15;
const FIREBALL_WAKE_RADIUS = 1.0;

// Continuous emission. Min counts keep short descents (1–2 cells)
// from looking sparse — a one-cell descent should still shed a
// visible flurry of sparks.
const EMBER_DENSITY_PER_CELL = 14;
const MIN_DESCENT_EMBERS = 22;
const EMBER_LIFETIME_MS = 380;
const EMBER_SPEED_MIN_CELLS = 0.6;
const EMBER_SPEED_MAX_CELLS = 1.3;
const EMBER_GRAVITY_CELLS = 1.4;
const EMBER_BASE_RADIUS_MIN_PX = 2.0;
const EMBER_BASE_RADIUS_MAX_PX = 3.5;
const EMBER_SHRINK_FACTOR = 0.55;
// Embers shed off the sides and trailing edge of the fireball, so
// angles cluster horizontally and upward (positive sin = above
// horizontal). This keeps embers behind/beside the fireball, where
// real debris would shed, rather than in front of it.
const EMBER_ANGLE_MIN_RAD = 0.45;
const EMBER_ANGLE_MAX_RAD = Math.PI - 0.45;

const SMOKE_DENSITY_PER_CELL = 2.2;
const MIN_DESCENT_SMOKE = 5;
const SMOKE_LIFETIME_MS = 460;
const SMOKE_RADIUS_FACTOR = 0.55;
const SMOKE_DRIFT_CELLS = 0.6;

// Floor-impact tuning. The floor burst peaks bigger and brighter
// than the moving fireball so the eye locks onto the moment of
// impact.
const FLOOR_BURST_DURATION_MS = 240;
const FLOOR_BURST_RADIUS_FACTOR = 1.15;
const FLOOR_EMBER_COUNT = 22;
const FLOOR_EMBER_LIFETIME_MS = 460;
const FLOOR_EMBER_SPEED_MIN_CELLS = 1.0;
const FLOOR_EMBER_SPEED_MAX_CELLS = 1.9;
// Floor embers fan above horizontal so gravity has time to arc them
// down to floor level rather than below it.
const FLOOR_EMBER_ANGLE_MIN_RAD = 0.15;
const FLOOR_EMBER_ANGLE_MAX_RAD = 0.65;
// Lower than descent embers — the spray hugs the floor instead of
// crashing back through it.
const FLOOR_EMBER_GRAVITY_CELLS = 0.7;
// Floor smoke: born inside the fireball at impact, briefly riding
// the fireball's downward momentum, then splashing outward when it
// hits the floor — like a puff hitting a wall. Initial altitude
// varies up to roughly the fireball's wake top so puffs read as
// emerging from across the body, not just from the leading edge.
const FLOOR_SMOKE_PUFF_COUNT = 9;
const FLOOR_SMOKE_LIFETIME_MS = BLAST_FLOOR_IMPACT_MS;
const FLOOR_SMOKE_INITIAL_ALTITUDE_MIN_CELLS = 0.1;
const FLOOR_SMOKE_INITIAL_ALTITUDE_MAX_CELLS = 2.2;
// Horizontal travel after the puff splashes against the floor.
const FLOOR_SMOKE_SPLASH_DISTANCE_MIN_CELLS = 1.0;
const FLOOR_SMOKE_SPLASH_DISTANCE_MAX_CELLS = 2.4;
// Brief upward arc immediately after the splash — the puff bounces
// off the floor before settling.
const FLOOR_SMOKE_BOUNCE_PEAK_MIN_CELLS = 0.1;
const FLOOR_SMOKE_BOUNCE_PEAK_MAX_CELLS = 0.4;
// Slow buoyancy lifting the puff over its remaining lifetime.
const FLOOR_SMOKE_BUOYANCY_MIN_CELLS = 0.5;
const FLOOR_SMOKE_BUOYANCY_MAX_CELLS = 1.0;
const FLOOR_SMOKE_RADIUS_MIN_FACTOR = 0.4;
const FLOOR_SMOKE_RADIUS_MAX_FACTOR = 0.85;

// Mismatched-frequency sines drive per-frame radius wobble on each
// fireball blob and the floor burst, so the silhouettes flicker
// without locking to the frame clock.
const FLAME_JITTER_FREQS_HZ: readonly number[] = [9, 13, 11];
const FLAME_JITTER_AMPLITUDE = 0.14;

type Ember = {
  readonly birthMs: number;
  readonly originRow: number;
  readonly originColumnOffset: number;
  readonly angleRad: number;
  readonly speedCells: number;
  readonly baseRadiusPx: number;
  readonly hue: "yellow" | "orange" | "red";
  readonly gravityCells: number;
  readonly lifetimeMs: number;
};

type SmokeWisp = {
  readonly birthMs: number;
  readonly originRow: number;
  readonly originColumnOffset: number;
};

function createDynamiteBlastEffect(
  column: number,
  landingRow: number,
  startNow: number,
): Effect {
  const skipCells = new Set<string>();
  for (let r = 0; r <= landingRow; r++) {
    skipCells.add(cellKey(r, column));
  }
  // Fireball motion: continuation of the dynamite's drop. The drop
  // is an ease-in (t² shape) from spawn to landing, hitting landing
  // velocity v_landing = 2 / FALL_MS_PER_CELL = 0.04 cell/ms. The
  // fireball picks up at that speed and continues along the same
  // parabola, riding the curve down to the floor.
  //
  // The whole motion is then stretched in wall-clock time by
  // FIREBALL_TIME_SCALE, since the unscaled physics descent is
  // ~18 ms/cell — too fast to read. With the stretch, the velocity
  // profile keeps its shape (slow start, accelerating end) but plays
  // out over a watchable window. Initial velocity becomes
  // v_landing / FIREBALL_TIME_SCALE.
  //
  // For a drop of D = SPAWN_ROW - landingRow cells with spec
  // semantics y(τ) = (τ/T_drop)² * D and T_drop = FALL_MS_PER_CELL *
  // D, the fireball's row at wall-clock time blastElapsedMs is:
  //   τ_phys   = blastElapsedMs / FIREBALL_TIME_SCALE
  //   currentY = SPAWN_ROW - (T_drop + τ_phys)²
  //                          / (FALL_MS_PER_CELL² * D)
  // For D = 0 the dynamite never fell — fall back to no descent.
  const distanceFall = SPAWN_ROW - landingRow;
  const descentDurationMs = dynamiteDescentDurationMs(landingRow);
  const tDropMs = FALL_MS_PER_CELL * distanceFall;
  const denom = FALL_MS_PER_CELL * FALL_MS_PER_CELL * Math.max(1, distanceFall);
  const fireballRowAt = (blastElapsedMs: number): number => {
    if (distanceFall <= 0) return landingRow;
    const t = tDropMs + blastElapsedMs / FIREBALL_TIME_SCALE;
    return SPAWN_ROW - (t * t) / denom;
  };
  const embers: Ember[] = [];
  // Continuous descent embers: shed from the fireball at random
  // points along its travel. Each ember's origin is the fireball's y
  // position at its birth time.
  if (landingRow > 0) {
    const numDescentEmbers = Math.max(
      MIN_DESCENT_EMBERS,
      Math.round(EMBER_DENSITY_PER_CELL * landingRow),
    );
    for (let i = 0; i < numDescentEmbers; i++) {
      const birthFraction = Math.random();
      const birthMs = birthFraction * descentDurationMs;
      embers.push({
        birthMs,
        originRow: fireballRowAt(birthMs),
        // Spawn within the fireball's body so embers fan from a
        // visible volume, not from a single spine point. Spread
        // matches the body's diameter so sparks shed all across the
        // visible silhouette.
        originColumnOffset: (Math.random() - 0.5) * 1.4,
        angleRad: lerp(EMBER_ANGLE_MIN_RAD, EMBER_ANGLE_MAX_RAD, Math.random()),
        speedCells: lerp(
          EMBER_SPEED_MIN_CELLS,
          EMBER_SPEED_MAX_CELLS,
          Math.random(),
        ),
        baseRadiusPx: lerp(
          EMBER_BASE_RADIUS_MIN_PX,
          EMBER_BASE_RADIUS_MAX_PX,
          Math.random(),
        ),
        hue: pickEmberHue(),
        gravityCells: EMBER_GRAVITY_CELLS,
        lifetimeMs: EMBER_LIFETIME_MS,
      });
    }
  }
  // Floor embers: a sideways spray fired when the fireball slams
  // into the floor.
  for (let i = 0; i < FLOOR_EMBER_COUNT; i++) {
    const goesLeft = i % 2 === 0;
    const offset = lerp(
      FLOOR_EMBER_ANGLE_MIN_RAD,
      FLOOR_EMBER_ANGLE_MAX_RAD,
      Math.random(),
    );
    const angle = goesLeft ? Math.PI - offset : offset;
    embers.push({
      birthMs: descentDurationMs,
      originRow: 0,
      originColumnOffset: 0,
      angleRad: angle,
      speedCells: lerp(
        FLOOR_EMBER_SPEED_MIN_CELLS,
        FLOOR_EMBER_SPEED_MAX_CELLS,
        Math.random(),
      ),
      baseRadiusPx: lerp(
        EMBER_BASE_RADIUS_MIN_PX,
        EMBER_BASE_RADIUS_MAX_PX,
        Math.random(),
      ),
      hue: pickEmberHue(),
      gravityCells: FLOOR_EMBER_GRAVITY_CELLS,
      lifetimeMs: FLOOR_EMBER_LIFETIME_MS,
    });
  }
  // Smoke wisps trailing the fireball as it descends. Births are
  // spaced evenly along the descent (with small jitter) so the trail
  // is continuous, not per-cell.
  const smokeWisps: SmokeWisp[] = [];
  if (landingRow > 0) {
    const numSmokeWisps = Math.max(
      MIN_DESCENT_SMOKE,
      Math.round(SMOKE_DENSITY_PER_CELL * landingRow),
    );
    for (let i = 0; i < numSmokeWisps; i++) {
      const baseFraction = (i + 0.5) / numSmokeWisps;
      const jitter = (Math.random() - 0.5) * 0.1;
      const birthFraction = clamp01(baseFraction + jitter);
      const birthMs = birthFraction * descentDurationMs;
      smokeWisps.push({
        birthMs,
        originRow: fireballRowAt(birthMs),
        originColumnOffset: (Math.random() - 0.5) * 1.0,
      });
    }
  }
  // Fireball's downward velocity at impact (cells per ms). Floor
  // smoke puffs inherit this velocity for their brief falling phase
  // so the smoke reads as carried by the fireball, not materializing
  // motionless. Closed form: v = 2*(T_drop + descent/k) / (k * denom)
  // with descent + T_drop = FALL_MS_PER_CELL * sqrt(D * SPAWN_ROW).
  // For D = 0 (no descent) fall back to a sensible default.
  const fireballTerminalSpeedCellsPerMs =
    distanceFall > 0
      ? (2 * FALL_MS_PER_CELL * Math.sqrt(distanceFall * SPAWN_ROW)) /
        (FIREBALL_TIME_SCALE * denom)
      : 0.025;
  // Floor smoke puffs: each puff has two phases. (1) Falling: born
  // inside the fireball at altitude h, descending at the fireball's
  // terminal speed. Lasts h / v_terminal ms. (2) Splashing: at the
  // floor, redirected sideways with a small upward bounce, then
  // slowly buoyant.
  const floorSmokePuffs: ReadonlyArray<{
    readonly delayMs: number;
    readonly initialAltitudeCells: number;
    readonly fallDurationMs: number;
    readonly originColumnOffset: number;
    readonly splashGoesLeft: boolean;
    readonly splashDistanceCells: number;
    readonly bouncePeakCells: number;
    readonly buoyancyCells: number;
    readonly radiusFactor: number;
  }> = Array.from({ length: FLOOR_SMOKE_PUFF_COUNT }, (_, i) => {
    const initialAltitudeCells = lerp(
      FLOOR_SMOKE_INITIAL_ALTITUDE_MIN_CELLS,
      FLOOR_SMOKE_INITIAL_ALTITUDE_MAX_CELLS,
      Math.random(),
    );
    return {
      delayMs: Math.random() * 40,
      initialAltitudeCells,
      fallDurationMs: initialAltitudeCells / fireballTerminalSpeedCellsPerMs,
      originColumnOffset: (Math.random() - 0.5) * 1.0,
      // Alternate sides so the splash fan is balanced rather than
      // randomly clumped on one side.
      splashGoesLeft: i % 2 === 0,
      splashDistanceCells: lerp(
        FLOOR_SMOKE_SPLASH_DISTANCE_MIN_CELLS,
        FLOOR_SMOKE_SPLASH_DISTANCE_MAX_CELLS,
        Math.random(),
      ),
      bouncePeakCells: lerp(
        FLOOR_SMOKE_BOUNCE_PEAK_MIN_CELLS,
        FLOOR_SMOKE_BOUNCE_PEAK_MAX_CELLS,
        Math.random(),
      ),
      buoyancyCells: lerp(
        FLOOR_SMOKE_BUOYANCY_MIN_CELLS,
        FLOOR_SMOKE_BUOYANCY_MAX_CELLS,
        Math.random(),
      ),
      radiusFactor: lerp(
        FLOOR_SMOKE_RADIUS_MIN_FACTOR,
        FLOOR_SMOKE_RADIUS_MAX_FACTOR,
        Math.random(),
      ),
    };
  });
  return {
    skipCells,
    getSpriteItems(now, prev, sprites) {
      const elapsedMs = now - startNow;
      const items: RenderItem[] = [];
      // A cell is alive while the fireball's body has not yet
      // overlapped it. Once currentY drops to the cell's top edge
      // (= row + 1), the cell stops rendering — the fireball
      // visually replaces it.
      const currentY = fireballRowAt(elapsedMs);
      const lastAlive = Math.min(landingRow - 1, Math.floor(currentY) - 1);
      for (let r = 0; r <= lastAlive; r++) {
        const cell = prev.board[r]?.[column];
        if (!cell || cell.kind === "empty") continue;
        const sprite =
          cell.kind === "detonator"
            ? sprites.detonator
            : sprites.byTier[cell.tier];
        items.push({ sprite, col: column, row: r });
      }
      return items;
    },
    draw(ctx, now, _prev, _sprites, cellSize, canvasHeight) {
      const elapsedMs = now - startNow;
      // Smoke trail (drawn first, behind the flame).
      drawSmokeTrail(
        ctx,
        column,
        smokeWisps,
        elapsedMs,
        cellSize,
        canvasHeight,
      );
      // Active fireball: riding the dynamite's drop curve down from
      // landingRow to the floor. After descent ends the floor
      // impact takes over.
      if (elapsedMs < descentDurationMs) {
        drawFireball(
          ctx,
          column,
          fireballRowAt(elapsedMs),
          elapsedMs,
          cellSize,
          canvasHeight,
        );
      }
      const sinceImpactMs = elapsedMs - descentDurationMs;
      if (sinceImpactMs >= 0) {
        drawFloorBurst(
          ctx,
          column,
          sinceImpactMs,
          elapsedMs,
          cellSize,
          canvasHeight,
        );
        drawFloorSmoke(
          ctx,
          column,
          sinceImpactMs,
          floorSmokePuffs,
          cellSize,
          canvasHeight,
        );
      }
      // Embers last so they layer on top of flame and smoke.
      drawEmbers(ctx, column, embers, elapsedMs, cellSize, canvasHeight);
    },
  };
}

function pickEmberHue(): "yellow" | "orange" | "red" {
  const r = Math.random();
  if (r < 0.35) return "yellow";
  if (r < 0.85) return "orange";
  return "red";
}

function drawFireball(
  ctx: CanvasRenderingContext2D,
  column: number,
  currentY: number,
  elapsedMs: number,
  cellSize: number,
  canvasHeight: number,
): void {
  const cx = (column + 0.5) * cellSize;
  // Larger cy = lower on screen. Fireball moves toward the floor =
  // toward larger cy, i.e., the leading core sits at +cellSize from
  // center, the wake sits at -cellSize from center.
  const centerCy = canvasHeight - (currentY + 0.5) * cellSize;
  const jitterAt = (idx: number, phase: number): number =>
    Math.sin(
      (elapsedMs / 1000) * Math.PI * 2 * FLAME_JITTER_FREQS_HZ[idx] + phase,
    ) * FLAME_JITTER_AMPLITUDE;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  // Wake (drawn first, behind the body): dim red-orange smear
  // trailing above the fireball.
  drawFireblob(
    ctx,
    cx,
    centerCy - FIREBALL_WAKE_OFFSET * cellSize,
    cellSize * FIREBALL_WAKE_RADIUS * (1 + jitterAt(0, 0.5)),
    "wake",
  );
  // Body: orange-yellow flame at the fireball's center.
  drawFireblob(
    ctx,
    cx,
    centerCy,
    cellSize * FIREBALL_BODY_RADIUS * (1 + jitterAt(1, 1.7)),
    "body",
  );
  // Leading core: bright white-yellow at the active edge, slightly
  // ahead of center so the teardrop reads as moving downward.
  drawFireblob(
    ctx,
    cx,
    centerCy + FIREBALL_LEADING_OFFSET * cellSize,
    cellSize * FIREBALL_LEADING_RADIUS * (1 + jitterAt(2, 3.4)),
    "leading",
  );
  ctx.restore();
}

function drawFireblob(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  kind: "leading" | "body" | "wake",
): void {
  if (r <= 0) return;
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  if (kind === "leading") {
    grad.addColorStop(0, "rgba(255, 255, 245, 0.95)");
    grad.addColorStop(0.3, "rgba(255, 240, 150, 0.85)");
    grad.addColorStop(0.7, "rgba(255, 180, 50, 0.55)");
    grad.addColorStop(1, "rgba(255, 110, 20, 0)");
  } else if (kind === "body") {
    grad.addColorStop(0, "rgba(255, 230, 130, 0.85)");
    grad.addColorStop(0.4, "rgba(255, 180, 60, 0.65)");
    grad.addColorStop(0.8, "rgba(240, 110, 30, 0.4)");
    grad.addColorStop(1, "rgba(200, 70, 20, 0)");
  } else {
    grad.addColorStop(0, "rgba(255, 150, 50, 0.55)");
    grad.addColorStop(0.5, "rgba(220, 90, 30, 0.4)");
    grad.addColorStop(1, "rgba(120, 50, 20, 0)");
  }
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
}

function drawSmokeTrail(
  ctx: CanvasRenderingContext2D,
  column: number,
  wisps: readonly SmokeWisp[],
  blastElapsedMs: number,
  cellSize: number,
  canvasHeight: number,
): void {
  // Drawn with default composite (not 'lighter') so smoke actually
  // darkens against the sky behind the playfield, like real smoke.
  ctx.save();
  for (const wisp of wisps) {
    const ageMs = blastElapsedMs - wisp.birthMs;
    if (ageMs < 0 || ageMs >= SMOKE_LIFETIME_MS) continue;
    const t = ageMs / SMOKE_LIFETIME_MS;
    const cx = (column + 0.5 + wisp.originColumnOffset) * cellSize;
    const baseY = canvasHeight - (wisp.originRow + 0.5) * cellSize;
    const cy = baseY - SMOKE_DRIFT_CELLS * t * cellSize;
    const radius = cellSize * SMOKE_RADIUS_FACTOR * (0.6 + 0.7 * t);
    // Alpha eases in then fades out so wisps don't pop into being.
    const fadeIn = clamp01(t * 4);
    const fadeOut = 1 - t;
    const alpha = 0.45 * fadeIn * fadeOut * fadeOut;
    if (alpha <= 0) continue;
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    grad.addColorStop(0, `rgba(110, 95, 85, ${alpha})`);
    grad.addColorStop(0.6, `rgba(90, 78, 70, ${alpha * 0.6})`);
    grad.addColorStop(1, "rgba(60, 50, 45, 0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawEmbers(
  ctx: CanvasRenderingContext2D,
  column: number,
  embers: readonly Ember[],
  blastElapsedMs: number,
  cellSize: number,
  canvasHeight: number,
): void {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const ember of embers) {
    const ageMs = blastElapsedMs - ember.birthMs;
    if (ageMs < 0 || ageMs >= ember.lifetimeMs) continue;
    const t = ageMs / ember.lifetimeMs;
    // Outward motion eases out: shoots fast at birth, settles toward
    // end of life. Gravity adds a downward parabolic component.
    const u = 1 - (1 - t) * (1 - t);
    const dist = ember.speedCells * cellSize * u;
    const sag = ember.gravityCells * t * t * cellSize;
    const baseX = (column + 0.5 + ember.originColumnOffset) * cellSize;
    const baseY = canvasHeight - (ember.originRow + 0.5) * cellSize;
    const x = baseX + Math.cos(ember.angleRad) * dist;
    const y = baseY - Math.sin(ember.angleRad) * dist + sag;
    const radius = ember.baseRadiusPx * (1 - EMBER_SHRINK_FACTOR * t);
    const alpha = (1 - t) * (1 - t);
    drawEmber(ctx, x, y, radius, alpha, ember.hue);
  }
  ctx.restore();
}

function drawEmber(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  coreRadiusPx: number,
  alpha: number,
  hue: "yellow" | "orange" | "red",
): void {
  const haloR = coreRadiusPx * 2.6;
  const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, haloR);
  // Hue determines the outer flame color; the core is always near-white
  // so embers read as hot points wrapped in colored fire.
  let outer: string;
  let mid: string;
  if (hue === "yellow") {
    outer = "255, 200, 60";
    mid = "255, 230, 130";
  } else if (hue === "orange") {
    outer = "255, 140, 30";
    mid = "255, 180, 70";
  } else {
    outer = "230, 70, 20";
    mid = "255, 120, 40";
  }
  halo.addColorStop(0, `rgba(255, 250, 220, ${alpha * 0.85})`);
  halo.addColorStop(0.4, `rgba(${mid}, ${alpha * 0.55})`);
  halo.addColorStop(1, `rgba(${outer}, 0)`);
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(cx, cy, haloR, 0, Math.PI * 2);
  ctx.fill();
  const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreRadiusPx);
  core.addColorStop(0, `rgba(255, 255, 245, ${alpha})`);
  core.addColorStop(1, `rgba(${mid}, 0)`);
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(cx, cy, coreRadiusPx, 0, Math.PI * 2);
  ctx.fill();
}

function drawFloorBurst(
  ctx: CanvasRenderingContext2D,
  column: number,
  sinceImpactMs: number,
  elapsedMs: number,
  cellSize: number,
  canvasHeight: number,
): void {
  if (sinceImpactMs >= FLOOR_BURST_DURATION_MS) return;
  const t = sinceImpactMs / FLOOR_BURST_DURATION_MS;
  // Burst swells fast, then fades. ease-out swell, quadratic fade.
  const swellU = 1 - (1 - t) * (1 - t);
  const fade = (1 - t) * (1 - t);
  const baseR = cellSize * FLOOR_BURST_RADIUS_FACTOR;
  const r = baseR * (0.4 + 0.6 * swellU);
  const cx = (column + 0.5) * cellSize;
  // Origin sits a touch above the floor so the burst bulges into the
  // playfield rather than half-clipping below it.
  const cy = canvasHeight - 0.35 * cellSize;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  // Two stacked blobs with a small jitter: the same trick the running
  // flame uses, scaled up.
  for (let i = 0; i < 2; i++) {
    const jitter =
      Math.sin(
        (elapsedMs / 1000) * Math.PI * 2 * FLAME_JITTER_FREQS_HZ[i] + i * 1.7,
      ) * FLAME_JITTER_AMPLITUDE;
    const blobR = r * (1 + jitter) * (i === 0 ? 1 : 0.7);
    const dx = i === 0 ? 0 : (i % 2 === 0 ? -0.12 : 0.12) * cellSize;
    const grad = ctx.createRadialGradient(cx + dx, cy, 0, cx + dx, cy, blobR);
    if (i === 0) {
      grad.addColorStop(0, `rgba(255, 255, 255, ${0.9 * fade})`);
      grad.addColorStop(0.3, `rgba(255, 230, 130, ${0.85 * fade})`);
    } else {
      grad.addColorStop(0, `rgba(255, 220, 100, ${0.7 * fade})`);
      grad.addColorStop(0.4, `rgba(255, 170, 50, ${0.6 * fade})`);
    }
    grad.addColorStop(0.8, `rgba(255, 120, 30, ${0.4 * fade})`);
    grad.addColorStop(1, "rgba(255, 80, 0, 0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx + dx, cy, blobR, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawFloorSmoke(
  ctx: CanvasRenderingContext2D,
  column: number,
  sinceImpactMs: number,
  puffs: ReadonlyArray<{
    readonly delayMs: number;
    readonly initialAltitudeCells: number;
    readonly fallDurationMs: number;
    readonly originColumnOffset: number;
    readonly splashGoesLeft: boolean;
    readonly splashDistanceCells: number;
    readonly bouncePeakCells: number;
    readonly buoyancyCells: number;
    readonly radiusFactor: number;
  }>,
  cellSize: number,
  canvasHeight: number,
): void {
  ctx.save();
  for (const puff of puffs) {
    const ageMs = sinceImpactMs - puff.delayMs;
    if (ageMs < 0 || ageMs >= FLOOR_SMOKE_LIFETIME_MS) continue;
    const baseCx = (column + 0.5 + puff.originColumnOffset) * cellSize;
    let cx: number;
    let altitudeCells: number;
    if (ageMs < puff.fallDurationMs) {
      // Phase 1: falling. Puff descends from initial altitude at
      // the fireball's terminal speed; column position fixed.
      cx = baseCx;
      const fallProgress =
        puff.fallDurationMs > 0 ? ageMs / puff.fallDurationMs : 1;
      altitudeCells = puff.initialAltitudeCells * (1 - fallProgress);
    } else {
      // Phase 2: splashed against the floor. Outward motion
      // ease-out, brief upward bounce (peaks at midpoint), then
      // buoyancy slowly lifts the puff over the rest of its life.
      const splashAgeMs = ageMs - puff.fallDurationMs;
      const splashLifetimeMs = Math.max(
        1,
        FLOOR_SMOKE_LIFETIME_MS - puff.fallDurationMs,
      );
      const tSplash = clamp01(splashAgeMs / splashLifetimeMs);
      const u = 1 - (1 - tSplash) * (1 - tSplash);
      const dir = puff.splashGoesLeft ? -1 : 1;
      cx = baseCx + dir * puff.splashDistanceCells * u * cellSize;
      // Bounce: 4t(1-t) peaks at t=0.5 with value 1, zero at both
      // ends — the puff hops up briefly off the floor and settles
      // back down before buoyancy takes over.
      const bounceCells = puff.bouncePeakCells * 4 * tSplash * (1 - tSplash);
      const buoyancyCells = puff.buoyancyCells * tSplash;
      altitudeCells = bounceCells + buoyancyCells;
    }
    const cy = canvasHeight - altitudeCells * cellSize;
    const t = ageMs / FLOOR_SMOKE_LIFETIME_MS;
    const radius = cellSize * puff.radiusFactor * (0.5 + 0.9 * t);
    const fadeIn = clamp01(t * 5);
    const fadeOut = 1 - t;
    const alpha = 0.45 * fadeIn * fadeOut * fadeOut;
    if (alpha <= 0) continue;
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    grad.addColorStop(0, `rgba(120, 100, 90, ${alpha})`);
    grad.addColorStop(0.6, `rgba(95, 80, 72, ${alpha * 0.6})`);
    grad.addColorStop(1, "rgba(60, 50, 45, 0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// Detonator detonation ------------------------------------------
//
// Phases per 05-animations.md, with the renderer's enhancements:
//
// 0..DETONATOR_PRESS_MS                — plunger press: the
//                                        detonator sprite y-squashes
//                                        with a small upward bounce
//                                        in the final 20% of the
//                                        window before bottoming out.
// DETONATOR_PRESS_MS..                 — detonation effects, layered:
//                                        a brief detonation flash
//                                        punctuates the moment of
//                                        detonation; a thin shockwave
//                                        ring expands outward at high
//                                        speed (the pre-cursor
//                                        concussion front); behind it
//                                        a multi-layered fireball
//                                        blooms over the 3×3 area,
//                                        sustains, then fades; each
//                                        cleared cell renders its
//                                        original sprite until the
//                                        fireball reaches it, then
//                                        bursts into a small radial
//                                        debris cloud; continuous
//                                        embers shed from the
//                                        fireball's body throughout
//                                        bloom + sustain; smoke wisps
//                                        lift from the explosion area
//                                        and linger past the fade.
//
// The shockwave's pale-blue tint at its leading edge is the only
// cool-toned element; the fireball, embers, and aftermath fill all
// run warm (yellow → orange → red), the same palette as dynamite.
// The two effects share that warm core deliberately — both are
// explosions — but the detonator's shape (radial, stationary, with
// a 3×3 footprint) and the shockwave ring (which dynamite doesn't
// have) keep them distinct.
//
// Per-cell engulfment times are derived from constant-speed fireball
// expansion: a cell at Euclidean distance d from a detonator is
// reached at d * DETONATOR_ENGULF_MS_PER_CELL after the press —
// slower than the shockwave, so the ring visibly leads the flame.
// Multi-detonator: every detonator runs every layer in parallel
// from its own cell; cells in overlap zones are engulfed by
// whichever fireball reaches them first. Particle origins, angles,
// speeds, and birth times are seeded once at construction with
// Math.random — the animation is deterministic from elapsed time
// onward, so frame-rate stutters don't shift particle positions.

const SQUASH_MIN = 0.65;
const SQUASH_BOUNCE = 0.85;
// Bounce phase is the final tail of the press window; t < 0.8
// compresses, then t in [0.8, 1] eases back up before detonation.
const SQUASH_BOUNCE_START_T = 0.8;

// Anticipation jitter on the squashed detonator. Translation (not
// scale) so it layers cleanly with the squash curve: the box looks
// like it's straining to contain something rather than vibrating
// in place. Amplitude ramps from 0 across the press, so the rumble
// builds — by the time it's loud enough to read, the plunger is
// also at peak compression.
const PRESS_JITTER_AMPLITUDE_PX = 1.5;
const PRESS_JITTER_FREQ_X_HZ = 32;
const PRESS_JITTER_FREQ_Y_HZ = 39;

// Warm anticipation glow under the cell during the press. Builds
// alpha through the press, peaking at the bounce — the seam-leaked
// light right before the bang. Color matches the detonation flash
// so the glow reads as the same fire about to burst.
const PRESS_GLOW_RADIUS_CELLS = 0.65;
const PRESS_GLOW_PEAK_ALPHA = 0.55;

const DETONATION_FLASH_PEAK_MS = 35;
const DETONATION_FLASH_DURATION_MS = 130;
const DETONATION_FLASH_RADIUS_CELLS = 0.7;

// Fireball phases. Bloom: radius grows from 0 to full with ease-out
// (fast initial growth, decelerating). No sustain: real explosions
// don't hold at peak — they expand, peak, and immediately disperse.
// Disperse: alpha decays to zero while the radius keeps growing
// outward, so the fireball reads as a real explosion thinning into
// the air rather than a glow that pulses in place.
const FIREBALL_BLOOM_MS = 180;
const FIREBALL_DISPERSE_MS = 400;
const FIREBALL_TOTAL_MS = FIREBALL_BLOOM_MS + FIREBALL_DISPERSE_MS;
// Three concentric layers: the outer wake provides red-orange
// glow well past the cell perimeter, the body is the bulk
// yellow-orange flame, and the inner core is a small bright
// white-yellow hot spot. Outer radius generously exceeds the 3×3
// area's corner distance (√2 ≈ 1.41 cells) so the fireball
// visibly spills past the destroyed cells into adjacent space.
const FIREBALL_OUTER_RADIUS_CELLS = 2.0;
const FIREBALL_BODY_RADIUS_CELLS = 1.45;
const FIREBALL_INNER_RADIUS_CELLS = 0.8;
// Outward expansion during the disperse phase: the fireball keeps
// growing past full bloom while alpha decays. Fraction of full
// radius added (so 0.2 means the outer edge ends at 1.2 × full).
const FIREBALL_DISPERSE_EXPAND = 0.2;

const CELL_WHITE_FLASH_MS = 80;
const CELL_WHITE_FLASH_RADIUS_CELLS = 0.55;

// Shrapnel: tumbling polygon chunks thrown by the blast. Each chunk
// launches from a cleared cell's center, but its initial velocity
// is directed *away from the owning detonator*, not radially from
// its own cell — so the blast visibly throws everything outward
// from the source. Polygons are tinted from each element's sampled
// palette so a shattered tier-3 element scatters tier-3-colored
// fragments. The detonator itself shatters too, contributing chunks
// colored from its own palette in evenly-spread directions (since
// source and cell coincide, there's no outward axis).
//
// Motion is real ballistic physics: initial velocity in cells/sec,
// gravity pulling toward the floor, and elastic-but-damped bounces
// off the playfield's left wall, right wall, and floor. Chunks fly
// off the top of the canvas (no top bounce) and either come back
// down under gravity or just fade out. Each chunk's trajectory is
// pre-computed at construction time as a list of constant-velocity
// (with gravity) segments separated by bounce events, so position
// lookup at draw time is O(segments) — no per-frame integration,
// and motion stays deterministic from elapsed time.
const SHRAPNEL_PER_CELL = 9;
const SHRAPNEL_DETONATOR_COUNT = 14;
const SHRAPNEL_LIFETIME_MS = 1600;
// Initial speed in cells per second. Wide range so a burst has a
// mix of close-range chunks and ones that genuinely fly across
// the board.
const SHRAPNEL_SPEED_MIN_CPS = 9;
const SHRAPNEL_SPEED_MAX_CPS = 16;
// Gravity in cells per second squared, pulling toward row 0. Tuned
// so chunks fired sideways from the upper rows visibly arc down
// within their lifetime.
const SHRAPNEL_GRAVITY_CPS2 = 16;
// Velocity multiplier on the bounce-perpendicular component.
// 0.5 = a chunk loses half its perpendicular speed each bounce, so
// after 3 bounces it's at 1/8 — bouncing decays out naturally.
const SHRAPNEL_BOUNCE_DAMPING = 0.5;
// Velocity multiplier on the bounce-tangential component (friction
// along the surface). Chunks scrub along the wall a little, but
// don't slide forever.
const SHRAPNEL_BOUNCE_FRICTION = 0.85;
// Stop simulating once a chunk's speed drops below this. Avoids
// an infinite-bounce loop on the floor as gravity reasserts.
const SHRAPNEL_REST_SPEED_CPS = 0.5;
// Hard cap on simulated bounces per chunk to bound construction
// cost. With 0.5 damping, ~6–8 bounces is more than the eye reads.
const SHRAPNEL_MAX_BOUNCES = 8;

const SHRAPNEL_SIZE_MIN_PX = 7;
const SHRAPNEL_SIZE_MAX_PX = 13;
// Tumble speed, radians per ms. ~0.012 rad/ms ≈ 1.9 turns/sec.
const SHRAPNEL_ROTATION_SPEED_MAX_RAD_PER_MS = 0.012;
// Cone half-width around the radial direction. Chunks fan out
// rather than firing in a perfect line away from the detonator,
// so the burst reads as messy debris, not a directed beam.
const SHRAPNEL_DIRECTION_JITTER_RAD = 0.5;

// Playfield bounds in cell units, used as bounce surfaces for
// shrapnel. Mirrors playfield.ts BOARD_WIDTH and the floor row;
// kept here to avoid a renderer-internal dependency cycle. Update
// both if the board size ever changes.
const SHRAPNEL_BOUND_LEFT_COL = 0;
const SHRAPNEL_BOUND_RIGHT_COL = 7;
const SHRAPNEL_BOUND_FLOOR_ROW = 0;

// Continuous fireball embers: shed throughout the bloom + sustain
// phases from random points within the fireball's body. Mirrors
// the dynamite's continuous emission. Births are spread across
// FIREBALL_EMBER_BIRTH_END_MS so the stream feels alive across the
// explosion's whole duration.
const FIREBALL_EMBERS_PER_DET = 24;
const FIREBALL_EMBER_BIRTH_END_MS = 500;
const FIREBALL_EMBER_LIFETIME_MS = 400;
const FIREBALL_EMBER_SPEED_MIN_CELLS = 0.5;
const FIREBALL_EMBER_SPEED_MAX_CELLS = 1.2;
const FIREBALL_EMBER_GRAVITY_CELLS = 1.2;

// Smoke wisps lifting from random points within the explosion area.
// Drawn with the default blend so they darken the playfield like
// real smoke (additive smoke would lighten the sky behind the
// playfield, which reads wrong).
const DET_SMOKE_PER_DET = 10;
const DET_SMOKE_BIRTH_END_MS = 500;
const DET_SMOKE_LIFETIME_MS = 400;
const DET_SMOKE_RADIUS_FACTOR = 0.55;
const DET_SMOKE_DRIFT_CELLS = 1.2;
const DET_SMOKE_ORIGIN_RADIUS_CELLS = 1.2;

// The shockwave keeps drawing past the diagonal-corner arrival time
// (~71 ms) for this trail before fully dissipating. Without a
// trail the ring would pop out of existence the instant it cleared
// the corners, which reads as abrupt; the trail lets it dissolve.
const SHOCKWAVE_TRAIL_MS = 60;
const SHOCKWAVE_HALF_THICKNESS_CELLS = 0.16;

// Screen kick at the moment of detonation. The whole playfield
// translates by a small, fast-decaying offset so the eye registers
// the bang as a physical jolt rather than a glow on a still field.
// The dynamite gets its visceral weight from the fireball's downward
// motion; the detonator is stationary, so the shake is what carries
// that weight here. Two mismatched sine frequencies per axis avoid
// a recognizable pattern, and amplitude decays linearly over the
// shake's life so the kick feels like a bang, not a rumble.
const SHAKE_DURATION_MS = 180;
const SHAKE_AMPLITUDE_PX = 6;
const SHAKE_FREQ_X_HZ = 28;
const SHAKE_FREQ_Y_HZ = 33;

type DetEmber = {
  readonly birthMs: number;
  readonly originColumnCells: number;
  readonly originRowCells: number;
  readonly angleRad: number;
  readonly speedCells: number;
  readonly baseRadiusPx: number;
  readonly hue: "yellow" | "orange" | "red";
  readonly gravityCells: number;
  readonly lifetimeMs: number;
};

type DetSmokeWisp = {
  readonly birthMs: number;
  readonly originColumnCells: number;
  readonly originRowCells: number;
};

type ShrapnelSegment = {
  readonly tStartMs: number; // ms from chunk birth
  readonly xStartCells: number;
  readonly yStartCells: number; // row-units (row 0 = floor)
  readonly vxCellsPerMs: number;
  readonly vyCellsPerMs: number; // positive = upward
};

type Shrapnel = {
  readonly birthMs: number;
  readonly lifetimeMs: number;
  readonly rotationStartRad: number;
  readonly rotationSpeedRadPerMs: number;
  readonly color: string;
  readonly sizePx: number;
  readonly polygon: readonly { readonly x: number; readonly y: number }[];
  readonly gravityCellsPerMs2: number;
  readonly segments: readonly ShrapnelSegment[];
};

function createDetonateEffect(
  detonators: readonly Pos[],
  cleared: readonly Pos[],
  startNow: number,
  prevSnapshot: State,
  sprites: SpriteAtlas,
): Effect {
  // The effect owns every cleared cell: each one renders its
  // original sprite until the fireball reaches it, then disappears.
  // Detonators are part of `cleared` and are also drawn (squashed)
  // during the press by draw().
  const skipCells = new Set<string>();
  for (const cell of cleared) skipCells.add(cellKey(cell.row, cell.column));

  // Engulfment time + owning-detonator per cleared cell. The
  // engulf time is when the fireball's outer edge sweeps past the
  // cell's center; tying it to the actual bloom curve (rather than
  // a separate per-cell-distance constant) means each cell's
  // sprite vanishes exactly as the visible flame arrives. The
  // bloom curve is r(t) = (1 - (1-t/B)²)·R for B = FIREBALL_BLOOM_MS
  // and R = FIREBALL_OUTER_RADIUS_CELLS; inverting gives
  // t = B · (1 - √(1 - d/R)). With multi-detonator overlap, a cell
  // is engulfed by whichever fireball reaches it first — i.e. the
  // closest detonator wins. The owning-detonator is also the
  // source point shrapnel is hurled away from.
  const engulfByKey = new Map<string, number>();
  const sourceByKey = new Map<string, Pos>();
  for (const cell of cleared) {
    let earliest = Infinity;
    let source: Pos = detonators[0];
    for (const det of detonators) {
      const dx = cell.column - det.column;
      const dy = cell.row - det.row;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const ratio = Math.min(1, distance / FIREBALL_OUTER_RADIUS_CELLS);
      const engulfMs =
        DETONATOR_PRESS_MS + FIREBALL_BLOOM_MS * (1 - Math.sqrt(1 - ratio));
      if (engulfMs < earliest) {
        earliest = engulfMs;
        source = det;
      }
    }
    const key = cellKey(cell.row, cell.column);
    engulfByKey.set(key, earliest);
    sourceByKey.set(key, source);
  }

  const detonatorKeys = new Set<string>();
  for (const det of detonators) {
    detonatorKeys.add(cellKey(det.row, det.column));
  }

  // Shrapnel: each cleared element shatters at fireball-engulfment
  // time and throws polygon chunks outward from the owning
  // detonator. Origin = cell center; velocity direction = away from
  // the detonator + jitter, so the burst reads as "the blast threw
  // these pieces away" rather than "this cell exploded inward".
  // Detonators themselves emit chunks at the moment of detonation;
  // direction is fully random because source and cell coincide.
  const shrapnel: Shrapnel[] = [];
  for (const cell of cleared) {
    const key = cellKey(cell.row, cell.column);
    const isDetonator = detonatorKeys.has(key);
    const palette = paletteForCell(cell, prevSnapshot, sprites);
    if (isDetonator) {
      // Source = cell, so radial direction is undefined. Spread
      // chunks evenly around the circle for a balanced burst.
      const baseAngle = Math.random() * Math.PI * 2;
      for (let i = 0; i < SHRAPNEL_DETONATOR_COUNT; i++) {
        const angle =
          baseAngle +
          (i * Math.PI * 2) / SHRAPNEL_DETONATOR_COUNT +
          (Math.random() - 0.5) * 0.3;
        shrapnel.push(
          buildShrapnel(
            DETONATOR_PRESS_MS,
            cell.column + 0.5,
            cell.row + 0.5,
            angle,
            palette,
          ),
        );
      }
      continue;
    }
    const engulfMs = engulfByKey.get(key);
    const source = sourceByKey.get(key);
    if (engulfMs === undefined || source === undefined) continue;
    const radial = Math.atan2(
      cell.row - source.row,
      cell.column - source.column,
    );
    for (let i = 0; i < SHRAPNEL_PER_CELL; i++) {
      const angle =
        radial + (Math.random() - 0.5) * 2 * SHRAPNEL_DIRECTION_JITTER_RAD;
      shrapnel.push(
        buildShrapnel(
          engulfMs,
          cell.column + 0.5,
          cell.row + 0.5,
          angle,
          palette,
        ),
      );
    }
  }

  // Continuous fireball embers shed from the fireball's body
  // throughout bloom + sustain. Origins are uniformly distributed
  // within the fireball's full radius (sqrt(uniform) for the
  // radial component avoids clustering at the center). Each ember
  // travels outward from its birth point with some angle jitter.
  const fireballEmbers: DetEmber[] = [];
  for (const det of detonators) {
    for (let i = 0; i < FIREBALL_EMBERS_PER_DET; i++) {
      const birthMs =
        DETONATOR_PRESS_MS + Math.random() * FIREBALL_EMBER_BIRTH_END_MS;
      const r = Math.sqrt(Math.random()) * FIREBALL_OUTER_RADIUS_CELLS;
      const theta = Math.random() * Math.PI * 2;
      fireballEmbers.push({
        birthMs,
        originColumnCells: det.column + 0.5 + Math.cos(theta) * r,
        originRowCells: det.row + 0.5 + Math.sin(theta) * r,
        // Travel direction is outward (theta) with jitter so embers
        // fan out rather than firing perfectly radially.
        angleRad: theta + (Math.random() - 0.5) * 0.7,
        speedCells: lerp(
          FIREBALL_EMBER_SPEED_MIN_CELLS,
          FIREBALL_EMBER_SPEED_MAX_CELLS,
          Math.random(),
        ),
        baseRadiusPx: lerp(
          EMBER_BASE_RADIUS_MIN_PX,
          EMBER_BASE_RADIUS_MAX_PX,
          Math.random(),
        ),
        hue: pickEmberHue(),
        gravityCells: FIREBALL_EMBER_GRAVITY_CELLS,
        lifetimeMs: FIREBALL_EMBER_LIFETIME_MS,
      });
    }
  }

  // Smoke wisps lifting from random points within the explosion
  // area, throughout the explosion's life.
  const smokeWisps: DetSmokeWisp[] = [];
  for (const det of detonators) {
    for (let i = 0; i < DET_SMOKE_PER_DET; i++) {
      const birthMs =
        DETONATOR_PRESS_MS + Math.random() * DET_SMOKE_BIRTH_END_MS;
      const r = Math.sqrt(Math.random()) * DET_SMOKE_ORIGIN_RADIUS_CELLS;
      const theta = Math.random() * Math.PI * 2;
      smokeWisps.push({
        birthMs,
        originColumnCells: det.column + 0.5 + Math.cos(theta) * r,
        originRowCells: det.row + 0.5 + Math.sin(theta) * r,
      });
    }
  }

  return {
    skipCells,
    getCanvasShake(now: number) {
      const sinceDetonationMs = now - startNow - DETONATOR_PRESS_MS;
      return shakeOffset(sinceDetonationMs);
    },
    getSpriteItems(now, prev, sprites) {
      const elapsedMs = now - startNow;
      const items: RenderItem[] = [];
      for (const cell of cleared) {
        // Detonators are drawn squashed by draw() during the press
        // and gone after detonation (engulfMs = DETONATOR_PRESS_MS),
        // so they're never in items.
        if (detonatorKeys.has(cellKey(cell.row, cell.column))) continue;
        const engulfMs = engulfByKey.get(cellKey(cell.row, cell.column));
        if (engulfMs === undefined || elapsedMs >= engulfMs) continue;
        const c = prev.board[cell.row]?.[cell.column];
        if (!c || c.kind === "empty") continue;
        const sprite =
          c.kind === "detonator" ? sprites.detonator : sprites.byTier[c.tier];
        items.push({ sprite, col: cell.column, row: cell.row });
      }
      return items;
    },
    draw(ctx, now, _prev, sprites, cellSize, canvasHeight) {
      const elapsedMs = now - startNow;
      // Smoke is drawn first (default blend, drawn before any
      // additive layers) so it sits behind the flame and embers.
      drawDetSmoke(ctx, smokeWisps, elapsedMs, cellSize, canvasHeight);
      // Phase 1: plunger press. Detonators y-squash into the cell
      // floor, with a brief bounce back at the tail of the window.
      // A warm glow blooms under the cell as the press progresses
      // (light leaking from the seams), and the squashed sprite
      // jitters with translation so the box reads as straining.
      // Drawn via draw() (not getSpriteItems) so the effect can
      // apply transforms around the cell's anchor row.
      if (elapsedMs < DETONATOR_PRESS_MS) {
        const pressT = elapsedMs / DETONATOR_PRESS_MS;
        const squashY = squashCurve(pressT);
        const jitter = pressJitterOffset(elapsedMs, pressT);
        drawPressGlow(ctx, detonators, pressT, cellSize, canvasHeight);
        for (const det of detonators) {
          drawSquashedDetonator(
            ctx,
            sprites.detonator,
            det.column,
            det.row,
            squashY,
            jitter,
            cellSize,
            canvasHeight,
          );
        }
        return;
      }
      // Phase 2: detonation. Layers are drawn back-to-front:
      // per-cell white flashes (sit on the destroyed cells), then
      // the fireball (warm body of the explosion), the detonation
      // flash punctuating the bang, fireball embers, shrapnel
      // chunks, then the shockwave ring on top as the leading edge.
      const sinceDetonationMs = elapsedMs - DETONATOR_PRESS_MS;
      drawCellFlashes(
        ctx,
        cleared,
        engulfByKey,
        elapsedMs,
        cellSize,
        canvasHeight,
      );
      drawDetFireball(
        ctx,
        detonators,
        sinceDetonationMs,
        cellSize,
        canvasHeight,
      );
      drawDetonationFlash(
        ctx,
        detonators,
        sinceDetonationMs,
        cellSize,
        canvasHeight,
      );
      drawDetEmbers(ctx, fireballEmbers, elapsedMs, cellSize, canvasHeight);
      drawShrapnel(ctx, shrapnel, elapsedMs, cellSize, canvasHeight);
      drawShockwave(ctx, detonators, sinceDetonationMs, cellSize, canvasHeight);
    },
  };
}

// Squash curve: ease-in to SQUASH_MIN at t = SQUASH_BOUNCE_START_T,
// then ease back up to SQUASH_BOUNCE at t = 1. The bounce reads as
// "wind-up before release" — the detonator gathers anticipation
// just before detonation rather than uniformly compressing into
// detonation.
function squashCurve(t: number): number {
  if (t < SQUASH_BOUNCE_START_T) {
    const k = t / SQUASH_BOUNCE_START_T;
    return lerp(1, SQUASH_MIN, k * k);
  }
  const k = (t - SQUASH_BOUNCE_START_T) / (1 - SQUASH_BOUNCE_START_T);
  return lerp(SQUASH_MIN, SQUASH_BOUNCE, k);
}

function shakeOffset(sinceDetonationMs: number): {
  readonly x: number;
  readonly y: number;
} {
  if (sinceDetonationMs < 0 || sinceDetonationMs >= SHAKE_DURATION_MS) {
    return { x: 0, y: 0 };
  }
  const t = sinceDetonationMs / SHAKE_DURATION_MS;
  const amp = SHAKE_AMPLITUDE_PX * (1 - t);
  const phase = (sinceDetonationMs / 1000) * Math.PI * 2;
  return {
    x: amp * Math.sin(phase * SHAKE_FREQ_X_HZ),
    y: amp * Math.sin(phase * SHAKE_FREQ_Y_HZ + 1.0),
  };
}

function drawSquashedDetonator(
  ctx: CanvasRenderingContext2D,
  sprite: SpriteAsset,
  column: number,
  row: number,
  squashY: number,
  jitter: { readonly x: number; readonly y: number },
  cellSize: number,
  canvasHeight: number,
): void {
  const cellScreenX = column * cellSize;
  const cellScreenY = canvasHeight - (row + 1) * cellSize;
  // Pivot on the cell's floor (the sprite's anchor row), so the
  // squash compresses the plunger into the box rather than
  // shrinking toward the cell center.
  const pivotY = cellScreenY + cellSize;
  ctx.save();
  ctx.translate(jitter.x, jitter.y + pivotY);
  ctx.scale(1, squashY);
  ctx.translate(0, -pivotY);
  drawSpriteAtCell(ctx, sprite, cellScreenX, cellScreenY, cellSize);
  ctx.restore();
}

function pressJitterOffset(
  elapsedMs: number,
  pressT: number,
): { readonly x: number; readonly y: number } {
  // Amplitude eases in across the press as t² so the rumble is
  // imperceptible at the start and unmistakable at the bounce.
  const amp = PRESS_JITTER_AMPLITUDE_PX * pressT * pressT;
  const phase = (elapsedMs / 1000) * Math.PI * 2;
  return {
    x: amp * Math.sin(phase * PRESS_JITTER_FREQ_X_HZ),
    y: amp * Math.sin(phase * PRESS_JITTER_FREQ_Y_HZ + 1.0),
  };
}

function drawPressGlow(
  ctx: CanvasRenderingContext2D,
  detonators: readonly Pos[],
  pressT: number,
  cellSize: number,
  canvasHeight: number,
): void {
  // Alpha eases in across the press (t³ — slow start, sharp finish)
  // so the glow only really commits in the final third, when the
  // squash is also at its deepest. Radius grows modestly so the
  // halo expands as well as brightens.
  const alpha = PRESS_GLOW_PEAK_ALPHA * pressT * pressT * pressT;
  if (alpha <= 0) return;
  const radius = cellSize * PRESS_GLOW_RADIUS_CELLS * (0.7 + 0.3 * pressT);
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const det of detonators) {
    const cx = (det.column + 0.5) * cellSize;
    const cy = canvasHeight - (det.row + 0.5) * cellSize;
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    grad.addColorStop(0, `rgba(255, 240, 180, ${alpha})`);
    grad.addColorStop(0.5, `rgba(255, 200, 90, ${alpha * 0.65})`);
    grad.addColorStop(1, "rgba(255, 150, 40, 0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawDetonationFlash(
  ctx: CanvasRenderingContext2D,
  detonators: readonly Pos[],
  sinceDetonationMs: number,
  cellSize: number,
  canvasHeight: number,
): void {
  if (sinceDetonationMs >= DETONATION_FLASH_DURATION_MS) return;
  // Linear ramp up to peak, then quadratic decay.
  let alpha;
  if (sinceDetonationMs < DETONATION_FLASH_PEAK_MS) {
    alpha = sinceDetonationMs / DETONATION_FLASH_PEAK_MS;
  } else {
    const decayT =
      (sinceDetonationMs - DETONATION_FLASH_PEAK_MS) /
      (DETONATION_FLASH_DURATION_MS - DETONATION_FLASH_PEAK_MS);
    alpha = (1 - decayT) * (1 - decayT);
  }
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const det of detonators) {
    const cx = (det.column + 0.5) * cellSize;
    const cy = canvasHeight - (det.row + 0.5) * cellSize;
    const r = cellSize * DETONATION_FLASH_RADIUS_CELLS;
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    grad.addColorStop(0, `rgba(255, 255, 250, ${alpha})`);
    grad.addColorStop(0.4, `rgba(255, 245, 180, ${alpha * 0.7})`);
    grad.addColorStop(1, "rgba(255, 220, 100, 0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawDetFireball(
  ctx: CanvasRenderingContext2D,
  detonators: readonly Pos[],
  sinceDetonationMs: number,
  cellSize: number,
  canvasHeight: number,
): void {
  if (sinceDetonationMs < 0 || sinceDetonationMs >= FIREBALL_TOTAL_MS) {
    return;
  }
  // Two phases: bloom (radius grows from 0 to full, alpha 0 to 1)
  // and disperse (alpha decays to 0 while the radius keeps growing
  // past full by FIREBALL_DISPERSE_EXPAND with ease-out — the
  // fireball reads as thinning into the air, not pulsing in place).
  let scale: number;
  let alpha: number;
  if (sinceDetonationMs < FIREBALL_BLOOM_MS) {
    const t = sinceDetonationMs / FIREBALL_BLOOM_MS;
    scale = 1 - (1 - t) * (1 - t);
    alpha = t;
  } else {
    const t = (sinceDetonationMs - FIREBALL_BLOOM_MS) / FIREBALL_DISPERSE_MS;
    const expandU = 1 - (1 - t) * (1 - t);
    scale = 1 + FIREBALL_DISPERSE_EXPAND * expandU;
    alpha = (1 - t) * (1 - t);
  }
  if (alpha <= 0 || scale <= 0) return;
  // Mismatched-frequency sines drive per-frame radius wobble on
  // each layer so the silhouette flickers without locking to the
  // frame clock. Same trick as the dynamite fireball.
  const jitterAt = (idx: number, phase: number): number =>
    Math.sin(
      (sinceDetonationMs / 1000) * Math.PI * 2 * FLAME_JITTER_FREQS_HZ[idx] +
        phase,
    ) * FLAME_JITTER_AMPLITUDE;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const det of detonators) {
    const cx = (det.column + 0.5) * cellSize;
    const cy = canvasHeight - (det.row + 0.5) * cellSize;
    drawDetFireblob(
      ctx,
      cx,
      cy,
      cellSize * FIREBALL_OUTER_RADIUS_CELLS * scale * (1 + jitterAt(0, 0.5)),
      alpha,
      "wake",
    );
    drawDetFireblob(
      ctx,
      cx,
      cy,
      cellSize * FIREBALL_BODY_RADIUS_CELLS * scale * (1 + jitterAt(1, 1.7)),
      alpha,
      "body",
    );
    drawDetFireblob(
      ctx,
      cx,
      cy,
      cellSize * FIREBALL_INNER_RADIUS_CELLS * scale * (1 + jitterAt(2, 3.4)),
      alpha,
      "leading",
    );
  }
  ctx.restore();
}

function drawDetFireblob(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  alpha: number,
  kind: "leading" | "body" | "wake",
): void {
  if (r <= 0) return;
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  if (kind === "leading") {
    grad.addColorStop(0, `rgba(255, 255, 245, ${0.95 * alpha})`);
    grad.addColorStop(0.3, `rgba(255, 240, 150, ${0.85 * alpha})`);
    grad.addColorStop(0.7, `rgba(255, 180, 50, ${0.55 * alpha})`);
    grad.addColorStop(1, "rgba(255, 110, 20, 0)");
  } else if (kind === "body") {
    grad.addColorStop(0, `rgba(255, 230, 130, ${0.85 * alpha})`);
    grad.addColorStop(0.4, `rgba(255, 180, 60, ${0.65 * alpha})`);
    grad.addColorStop(0.8, `rgba(240, 110, 30, ${0.4 * alpha})`);
    grad.addColorStop(1, "rgba(200, 70, 20, 0)");
  } else {
    grad.addColorStop(0, `rgba(255, 150, 50, ${0.55 * alpha})`);
    grad.addColorStop(0.5, `rgba(220, 90, 30, ${0.4 * alpha})`);
    grad.addColorStop(1, "rgba(120, 50, 20, 0)");
  }
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
}

function drawCellFlashes(
  ctx: CanvasRenderingContext2D,
  cleared: readonly Pos[],
  arrivalByKey: ReadonlyMap<string, number>,
  elapsedMs: number,
  cellSize: number,
  canvasHeight: number,
): void {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const cell of cleared) {
    const arrivalMs = arrivalByKey.get(cellKey(cell.row, cell.column));
    if (arrivalMs === undefined) continue;
    const sinceArrivalMs = elapsedMs - arrivalMs;
    if (sinceArrivalMs < 0 || sinceArrivalMs >= CELL_WHITE_FLASH_MS) continue;
    const t = sinceArrivalMs / CELL_WHITE_FLASH_MS;
    const alpha = (1 - t) * (1 - t);
    const cx = (cell.column + 0.5) * cellSize;
    const cy = canvasHeight - (cell.row + 0.5) * cellSize;
    const r = cellSize * CELL_WHITE_FLASH_RADIUS_CELLS;
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    grad.addColorStop(0, `rgba(255, 255, 255, ${alpha})`);
    grad.addColorStop(0.7, `rgba(255, 250, 230, ${alpha * 0.5})`);
    grad.addColorStop(1, "rgba(255, 240, 200, 0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function paletteForCell(
  cell: Pos,
  prevSnapshot: State,
  sprites: SpriteAtlas,
): readonly string[] {
  const c = prevSnapshot.board[cell.row]?.[cell.column];
  if (!c || c.kind === "empty") return sprites.detonator.palette;
  return c.kind === "detonator"
    ? sprites.detonator.palette
    : sprites.byTier[c.tier].palette;
}

function buildShrapnel(
  birthMs: number,
  originColumnCells: number,
  originRowCells: number,
  angleRad: number,
  palette: readonly string[],
): Shrapnel {
  const color =
    palette.length === 0
      ? "rgb(180, 130, 80)"
      : palette[Math.floor(Math.random() * palette.length)];
  // Convert from cells/sec to cells/ms once. Velocity vy is positive
  // upward; angleRad already follows that convention (cos for x,
  // sin for y, with sin>0 meaning upward in the renderer's
  // row-up coordinate system).
  const speedCellsPerMs =
    lerp(SHRAPNEL_SPEED_MIN_CPS, SHRAPNEL_SPEED_MAX_CPS, Math.random()) / 1000;
  const vx = Math.cos(angleRad) * speedCellsPerMs;
  const vy = Math.sin(angleRad) * speedCellsPerMs;
  // Gravity in cells/ms². The 0.5*g*t² formula in `simulateSegments`
  // and `shrapnelPositionAtAge` needs gravity in the same time unit
  // as t (ms), so divide by 1000 twice.
  const gravityCellsPerMs2 = SHRAPNEL_GRAVITY_CPS2 / (1000 * 1000);
  return {
    birthMs,
    lifetimeMs: SHRAPNEL_LIFETIME_MS,
    rotationStartRad: Math.random() * Math.PI * 2,
    rotationSpeedRadPerMs:
      (Math.random() - 0.5) * 2 * SHRAPNEL_ROTATION_SPEED_MAX_RAD_PER_MS,
    color,
    sizePx: lerp(SHRAPNEL_SIZE_MIN_PX, SHRAPNEL_SIZE_MAX_PX, Math.random()),
    polygon: randomPolygon(),
    gravityCellsPerMs2,
    segments: simulateShrapnelSegments(
      originColumnCells,
      originRowCells,
      vx,
      vy,
      gravityCellsPerMs2,
      SHRAPNEL_LIFETIME_MS,
    ),
  };
}

// Walk the chunk's trajectory at construction time. Each iteration
// finds the next collision (left wall, right wall, or floor) within
// the remaining lifetime. If nothing collides, we're done — the
// chunk fades out where it is. Otherwise we record the post-collision
// state as a new segment with reflected velocity (perpendicular
// component damped, tangential component scaled by friction) and
// keep going. Top of canvas is intentionally not a bounce surface;
// chunks fired upward fly off and either come back down under
// gravity or fade out off-screen.
function simulateShrapnelSegments(
  x0: number,
  y0: number,
  vx0: number,
  vy0: number,
  gravity: number,
  lifetimeMs: number,
): readonly ShrapnelSegment[] {
  const segments: ShrapnelSegment[] = [];
  let t = 0;
  let x = x0;
  let y = y0;
  let vx = vx0;
  let vy = vy0;
  for (let i = 0; i <= SHRAPNEL_MAX_BOUNCES; i++) {
    segments.push({
      tStartMs: t,
      xStartCells: x,
      yStartCells: y,
      vxCellsPerMs: vx,
      vyCellsPerMs: vy,
    });
    const remaining = lifetimeMs - t;
    if (remaining <= 0) break;
    let dt = remaining;
    let collision: "none" | "left" | "right" | "floor" = "none";
    // Wall collisions: x has no acceleration, so a linear solve.
    // The 0.001 ms tolerance avoids the just-bounced segment
    // immediately re-colliding with the same surface.
    if (vx < 0) {
      const tWall = (SHRAPNEL_BOUND_LEFT_COL - x) / vx;
      if (tWall > 0.001 && tWall < dt) {
        dt = tWall;
        collision = "left";
      }
    } else if (vx > 0) {
      const tWall = (SHRAPNEL_BOUND_RIGHT_COL - x) / vx;
      if (tWall > 0.001 && tWall < dt) {
        dt = tWall;
        collision = "right";
      }
    }
    // Floor collision: y(τ) = y + vy·τ - ½·g·τ². Solving for
    // y = floorRow gives the quadratic ½·g·τ² - vy·τ + (floor - y) = 0.
    // Take the smallest positive root above the tolerance.
    if (gravity > 0) {
      const a = 0.5 * gravity;
      const b = -vy;
      const c = y - SHRAPNEL_BOUND_FLOOR_ROW;
      const disc = b * b - 4 * a * c;
      if (disc >= 0) {
        const sqrtDisc = Math.sqrt(disc);
        const t1 = (-b - sqrtDisc) / (2 * a);
        const t2 = (-b + sqrtDisc) / (2 * a);
        const tFloor = t1 > 0.001 ? t1 : t2 > 0.001 ? t2 : -1;
        if (tFloor > 0 && tFloor < dt) {
          dt = tFloor;
          collision = "floor";
        }
      }
    }
    if (collision === "none") break;
    // Advance position and velocity to the collision point.
    const newX = x + vx * dt;
    const newY = y + vy * dt - 0.5 * gravity * dt * dt;
    let newVx = vx;
    let newVy = vy - gravity * dt;
    // Reflect: perpendicular component flips and is damped, the
    // tangential component is just scaled by friction. Math.abs
    // forces the post-bounce velocity direction in case numerical
    // drift left it on the wrong side of zero.
    if (collision === "left") {
      newVx = Math.abs(newVx) * SHRAPNEL_BOUNCE_DAMPING;
      newVy *= SHRAPNEL_BOUNCE_FRICTION;
    } else if (collision === "right") {
      newVx = -Math.abs(newVx) * SHRAPNEL_BOUNCE_DAMPING;
      newVy *= SHRAPNEL_BOUNCE_FRICTION;
    } else {
      newVy = Math.abs(newVy) * SHRAPNEL_BOUNCE_DAMPING;
      newVx *= SHRAPNEL_BOUNCE_FRICTION;
    }
    t += dt;
    x = newX;
    y = newY;
    vx = newVx;
    vy = newVy;
    // Settle: once the chunk is moving slowly enough, further
    // bounces are imperceptible and just compound numerical noise.
    const restThreshold = SHRAPNEL_REST_SPEED_CPS / 1000;
    if (vx * vx + vy * vy < restThreshold * restThreshold) break;
  }
  return segments;
}

function shrapnelPositionAtAge(
  s: Shrapnel,
  ageMs: number,
): { x: number; y: number } {
  // Segments are sorted by tStartMs; pick the latest one whose
  // start is <= ageMs. Linear scan is fine — chunks have at most
  // SHRAPNEL_MAX_BOUNCES + 1 segments.
  let seg = s.segments[0];
  for (let i = 1; i < s.segments.length; i++) {
    if (s.segments[i].tStartMs > ageMs) break;
    seg = s.segments[i];
  }
  const dt = ageMs - seg.tStartMs;
  return {
    x: seg.xStartCells + seg.vxCellsPerMs * dt,
    y:
      seg.yStartCells +
      seg.vyCellsPerMs * dt -
      0.5 * s.gravityCellsPerMs2 * dt * dt,
  };
}

// Irregular convex-ish polygon, ~3–5 vertices, with each vertex
// jittered around a unit circle. Coordinates are in shrapnel-local
// units (multiplied by sizePx at draw time).
function randomPolygon(): readonly { x: number; y: number }[] {
  const n = 3 + Math.floor(Math.random() * 3);
  const points: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    const angle = (i / n) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
    const r = 0.6 + Math.random() * 0.4;
    points.push({ x: Math.cos(angle) * r, y: Math.sin(angle) * r });
  }
  return points;
}

function drawShrapnel(
  ctx: CanvasRenderingContext2D,
  chunks: readonly Shrapnel[],
  blastElapsedMs: number,
  cellSize: number,
  canvasHeight: number,
): void {
  // Default composite (not 'lighter') so chunks read as solid
  // colored matter against the fireball glow, not as more flame.
  ctx.save();
  for (const chunk of chunks) {
    const ageMs = blastElapsedMs - chunk.birthMs;
    if (ageMs < 0 || ageMs >= chunk.lifetimeMs) continue;
    const pos = shrapnelPositionAtAge(chunk, ageMs);
    const screenX = pos.x * cellSize;
    const screenY = canvasHeight - pos.y * cellSize;
    // Quadratic alpha decay weighted toward the second half so
    // chunks linger as physical pieces, then vaporize at the end.
    const t = ageMs / chunk.lifetimeMs;
    const fadeT = t < 0.6 ? 0 : (t - 0.6) / 0.4;
    const alpha = 1 - fadeT * fadeT;
    if (alpha <= 0) continue;
    const rotation =
      chunk.rotationStartRad + ageMs * chunk.rotationSpeedRadPerMs;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(screenX, screenY);
    ctx.rotate(rotation);
    ctx.beginPath();
    const p0 = chunk.polygon[0];
    ctx.moveTo(p0.x * chunk.sizePx, p0.y * chunk.sizePx);
    for (let i = 1; i < chunk.polygon.length; i++) {
      const p = chunk.polygon[i];
      ctx.lineTo(p.x * chunk.sizePx, p.y * chunk.sizePx);
    }
    ctx.closePath();
    ctx.fillStyle = chunk.color;
    ctx.fill();
    // Thin dark stroke gives the chunk a defined silhouette
    // against the bright fireball behind it.
    ctx.strokeStyle = "rgba(35, 22, 12, 0.65)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

function drawDetEmbers(
  ctx: CanvasRenderingContext2D,
  embers: readonly DetEmber[],
  blastElapsedMs: number,
  cellSize: number,
  canvasHeight: number,
): void {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const ember of embers) {
    const ageMs = blastElapsedMs - ember.birthMs;
    if (ageMs < 0 || ageMs >= ember.lifetimeMs) continue;
    const t = ageMs / ember.lifetimeMs;
    // Outward motion eases out: shoots fast at birth, slows as it
    // fades. Gravity adds a parabolic downward sag.
    const u = 1 - (1 - t) * (1 - t);
    const dist = ember.speedCells * cellSize * u;
    const sag = ember.gravityCells * t * t * cellSize;
    const baseX = ember.originColumnCells * cellSize;
    const baseY = canvasHeight - ember.originRowCells * cellSize;
    const x = baseX + Math.cos(ember.angleRad) * dist;
    const y = baseY - Math.sin(ember.angleRad) * dist + sag;
    const radius = ember.baseRadiusPx * (1 - EMBER_SHRINK_FACTOR * t);
    const alpha = (1 - t) * (1 - t);
    drawEmber(ctx, x, y, radius, alpha, ember.hue);
  }
  ctx.restore();
}

function drawDetSmoke(
  ctx: CanvasRenderingContext2D,
  wisps: readonly DetSmokeWisp[],
  blastElapsedMs: number,
  cellSize: number,
  canvasHeight: number,
): void {
  // Default composite (not 'lighter') so smoke darkens against the
  // sky behind the playfield, like real smoke.
  ctx.save();
  for (const wisp of wisps) {
    const ageMs = blastElapsedMs - wisp.birthMs;
    if (ageMs < 0 || ageMs >= DET_SMOKE_LIFETIME_MS) continue;
    const t = ageMs / DET_SMOKE_LIFETIME_MS;
    const cx = wisp.originColumnCells * cellSize;
    const baseY = canvasHeight - wisp.originRowCells * cellSize;
    const cy = baseY - DET_SMOKE_DRIFT_CELLS * t * cellSize;
    const radius = cellSize * DET_SMOKE_RADIUS_FACTOR * (0.6 + 0.7 * t);
    // Quick fade-in so wisps don't pop, quadratic fade-out so they
    // dissipate cleanly.
    const fadeIn = clamp01(t * 4);
    const fadeOut = 1 - t;
    const alpha = 0.45 * fadeIn * fadeOut * fadeOut;
    if (alpha <= 0) continue;
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    grad.addColorStop(0, `rgba(110, 95, 85, ${alpha})`);
    grad.addColorStop(0.6, `rgba(90, 78, 70, ${alpha * 0.6})`);
    grad.addColorStop(1, "rgba(60, 50, 45, 0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawShockwave(
  ctx: CanvasRenderingContext2D,
  detonators: readonly Pos[],
  sinceDetonationMs: number,
  cellSize: number,
  canvasHeight: number,
): void {
  // The ring keeps a steady alpha until it has cleared the corners
  // (Euclidean distance √2 from a detonator), then fades out over
  // SHOCKWAVE_TRAIL_MS so it dissolves rather than popping out.
  const cornerArrivalMs = Math.SQRT2 * DETONATOR_SHOCKWAVE_MS_PER_CELL;
  const ringTotalMs = cornerArrivalMs + SHOCKWAVE_TRAIL_MS;
  if (sinceDetonationMs >= ringTotalMs) return;
  const radiusPx =
    (sinceDetonationMs / DETONATOR_SHOCKWAVE_MS_PER_CELL) * cellSize;
  if (radiusPx <= 0) return;
  let alpha;
  if (sinceDetonationMs < cornerArrivalMs) {
    alpha = 1;
  } else {
    const trailT = (sinceDetonationMs - cornerArrivalMs) / SHOCKWAVE_TRAIL_MS;
    alpha = (1 - trailT) * (1 - trailT);
  }
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const det of detonators) {
    const cx = (det.column + 0.5) * cellSize;
    const cy = canvasHeight - (det.row + 0.5) * cellSize;
    drawShockwaveRing(ctx, cx, cy, radiusPx, alpha, cellSize);
  }
  ctx.restore();
}

function drawShockwaveRing(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radiusPx: number,
  alpha: number,
  cellSize: number,
): void {
  const halfThickness = cellSize * SHOCKWAVE_HALF_THICKNESS_CELLS;
  const outerR = radiusPx + halfThickness;
  if (outerR <= 0) return;
  const innerR = Math.max(0, radiusPx - halfThickness);
  // Radial gradient between innerR and outerR: t=0 inner edge
  // (transparent), peak hot color in the middle, pale-blue tint at
  // the leading edge fading to fully transparent at outerR.
  const grad = ctx.createRadialGradient(cx, cy, innerR, cx, cy, outerR);
  grad.addColorStop(0, "rgba(255, 250, 220, 0)");
  grad.addColorStop(0.4, `rgba(255, 250, 220, ${alpha * 0.85})`);
  grad.addColorStop(0.7, `rgba(220, 240, 255, ${alpha * 0.65})`);
  grad.addColorStop(1, "rgba(180, 220, 255, 0)");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, outerR, 0, Math.PI * 2);
  ctx.fill();
}

// Gravity --------------------------------------------------------

function createGravityEffect(
  movements: readonly Movement[],
  startNow: number,
): Effect {
  const skipCells = new Set<string>();
  let maxDistance = 0;
  for (const m of movements) {
    skipCells.add(cellKey(m.from.row, m.from.column));
    const distance = m.from.row - m.to.row;
    if (distance > maxDistance) maxDistance = distance;
  }
  // The driver pads the gravity step by INTER_CASCADE_PAUSE_MS so the
  // tween can finish before the next step. Compute fall length here
  // and clamp the per-movement tween to it.
  const fallMs = GRAVITY_MS_PER_CELL * maxDistance;
  return {
    skipCells,
    getSpriteItems(now, prev, sprites) {
      const elapsedMs = now - startNow;
      const tween = fallMs === 0 ? 1 : clamp01(elapsedMs / fallMs);
      const cellsFallen = easeIn(tween) * maxDistance;
      const items: RenderItem[] = [];
      for (const m of movements) {
        const cell = prev.board[m.from.row]?.[m.from.column];
        if (!cell || cell.kind === "empty") continue;
        const sprite =
          cell.kind === "detonator"
            ? sprites.detonator
            : sprites.byTier[cell.tier];
        const ownDistance = m.from.row - m.to.row;
        const ownProgress =
          ownDistance > 0 ? Math.min(1, cellsFallen / ownDistance) : 1;
        const row = lerp(m.from.row, m.to.row, ownProgress);
        items.push({ sprite, col: m.from.column, row });
      }
      return items;
    },
    draw() {},
  };
}

// Helpers --------------------------------------------------------

function clamp01(t: number): number {
  if (t < 0) return 0;
  if (t > 1) return 1;
  return t;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function easeIn(t: number): number {
  return t * t;
}

// Maps t∈[0,1] to u∈[0,1] with fast-slow-fast velocity: bubbles pop
// out energetically, slow as they reach the apex of their arc, then
// accelerate back into landing. Blended with a linear term so the
// midpoint velocity isn't quite zero (which read as a freeze frame).
function easeOutIn(t: number): number {
  let biphasic;
  if (t < 0.5) {
    const k = t * 2;
    biphasic = 0.5 * (1 - (1 - k) * (1 - k));
  } else {
    const k = (t - 0.5) * 2;
    biphasic = 0.5 + 0.5 * k * k;
  }
  return biphasic * 0.7 + t * 0.3;
}

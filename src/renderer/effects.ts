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
  FALL_MS_PER_CELL,
  FIREBALL_TIME_SCALE,
  FUSE_DURATION_MS,
  GRAVITY_MS_PER_CELL,
  dynamiteDescentDurationMs,
} from '../animation/driver';
import type { SpriteAtlas } from '../assets/sprite-loader';
import type { SpriteAsset } from '../assets/sprite-renderer';
import {
  SPAWN_ROW,
  type Movement,
  type ReactingGroup,
  type State,
  type Step,
} from '../core/state';

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
};

export function createEffect(step: Step, startNow: number): Effect | null {
  switch (step.event.kind) {
    case 'merge':
      return createMergeEffect(step.event.groups, startNow);
    case 'gravity':
      return createGravityEffect(step.event.movements, startNow);
    case 'dynamite-blast':
      return createDynamiteBlastEffect(
        step.event.column,
        step.event.landingRow,
        startNow,
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
  readonly hue: 'white' | 'pale-yellow';
};

type Droplet = {
  readonly angleRad: number;
  readonly scatterDistanceCells: number;
  readonly baseRadiusPx: number;
  readonly hue: 'white' | 'pale-yellow';
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
          hue: Math.random() < 0.55 ? 'white' : 'pale-yellow',
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
        hue: Math.random() < 0.55 ? 'white' : 'pale-yellow',
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
  ctx.globalCompositeOperation = 'lighter';
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  grad.addColorStop(0, `rgba(255, 255, 255, ${intensity * 0.6})`);
  grad.addColorStop(0.5, `rgba(255, 240, 180, ${intensity * 0.3})`);
  grad.addColorStop(1, 'rgba(255, 240, 180, 0)');
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
  ctx.globalCompositeOperation = 'lighter';
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
      Math.cos(bubble.scatterAngleRad) *
        bubble.scatterDistanceCells *
        cellSize;
    const ctrlY =
      cellCy -
      Math.sin(bubble.scatterAngleRad) *
        bubble.scatterDistanceCells *
        cellSize;
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
  hue: 'white' | 'pale-yellow',
): void {
  const haloR = coreRadiusPx * BUBBLE_HALO_RADIUS_FACTOR;
  const haloEdge = hue === 'white' ? '255, 255, 255' : '255, 247, 200';
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
  core.addColorStop(1, 'rgba(255, 255, 255, 0)');
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
  ctx.globalCompositeOperation = 'lighter';
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
  halo.addColorStop(1, 'rgba(255, 240, 180, 0)');
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(cx, cy, haloR, 0, Math.PI * 2);
  ctx.fill();
  const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, radiusPx);
  core.addColorStop(0, `rgba(255, 255, 255, ${alpha})`);
  core.addColorStop(0.7, `rgba(255, 250, 200, ${alpha * 0.7})`);
  core.addColorStop(1, 'rgba(255, 250, 200, 0)');
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
  ctx.globalCompositeOperation = 'lighter';
  for (const droplet of droplets) {
    const dist =
      orbPopRadiusPx + u * droplet.scatterDistanceCells * cellSize;
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
// 0..FUSE_DURATION_MS                  — fuse spark travels along the
//                                        stick; dynamite sprite is
//                                        visible at landingRow.
// FUSE_DURATION_MS..+ descentDurationMs
//                                      — a fireball larger than one
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

const FUSE_SPARK_RADIUS_PX = 3;
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
  readonly hue: 'yellow' | 'orange' | 'red';
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
        angleRad: lerp(
          EMBER_ANGLE_MIN_RAD,
          EMBER_ANGLE_MAX_RAD,
          Math.random(),
        ),
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
      fallDurationMs:
        initialAltitudeCells / fireballTerminalSpeedCellsPerMs,
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
      if (elapsedMs < FUSE_DURATION_MS) {
        items.push({
          sprite: sprites.dynamite,
          col: column,
          row: landingRow,
        });
      }
      // A cell is alive while the fireball's body has not yet
      // overlapped it. Once currentY drops to the cell's top edge
      // (= row + 1), the cell stops rendering — the fireball
      // visually replaces it.
      let lastAlive = landingRow - 1;
      if (elapsedMs >= FUSE_DURATION_MS) {
        const blastElapsedMs = elapsedMs - FUSE_DURATION_MS;
        const currentY = fireballRowAt(blastElapsedMs);
        lastAlive = Math.min(landingRow - 1, Math.floor(currentY) - 1);
      }
      for (let r = 0; r <= lastAlive; r++) {
        const cell = prev.board[r]?.[column];
        if (!cell || cell.kind === 'empty') continue;
        const sprite =
          cell.kind === 'detonator'
            ? sprites.detonator
            : sprites.byTier[cell.tier];
        items.push({ sprite, col: column, row: r });
      }
      return items;
    },
    draw(ctx, now, _prev, _sprites, cellSize, canvasHeight) {
      const elapsedMs = now - startNow;
      if (elapsedMs < FUSE_DURATION_MS) {
        drawFuseSpark(
          ctx,
          column,
          landingRow,
          elapsedMs,
          cellSize,
          canvasHeight,
        );
        return;
      }
      const blastElapsedMs = elapsedMs - FUSE_DURATION_MS;
      // Smoke trail (drawn first, behind the flame).
      drawSmokeTrail(
        ctx,
        column,
        smokeWisps,
        blastElapsedMs,
        cellSize,
        canvasHeight,
      );
      // Active fireball: riding the dynamite's drop curve down from
      // landingRow to the floor. After descent ends the floor
      // impact takes over.
      if (blastElapsedMs < descentDurationMs) {
        drawFireball(
          ctx,
          column,
          fireballRowAt(blastElapsedMs),
          elapsedMs,
          cellSize,
          canvasHeight,
        );
      }
      const sinceImpactMs = blastElapsedMs - descentDurationMs;
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
      drawEmbers(ctx, column, embers, blastElapsedMs, cellSize, canvasHeight);
    },
  };
}

function pickEmberHue(): 'yellow' | 'orange' | 'red' {
  const r = Math.random();
  if (r < 0.35) return 'yellow';
  if (r < 0.85) return 'orange';
  return 'red';
}

function drawFuseSpark(
  ctx: CanvasRenderingContext2D,
  column: number,
  row: number,
  elapsedMs: number,
  cellSize: number,
  canvasHeight: number,
): void {
  // Spark travels along the fuse — start at the curling tip (slightly
  // above and to the right of the cell), end at the body. The travel
  // is small but it sells "fuse burning down".
  const t = clamp01(elapsedMs / FUSE_DURATION_MS);
  const startX = (column + 0.7) * cellSize;
  const startY = canvasHeight - (row + 1.05) * cellSize;
  const endX = (column + 0.5) * cellSize;
  const endY = canvasHeight - (row + 0.7) * cellSize;
  const cx = lerp(startX, endX, t);
  const cy = lerp(startY, endY, t);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const grad = ctx.createRadialGradient(
    cx,
    cy,
    0,
    cx,
    cy,
    FUSE_SPARK_RADIUS_PX * 4,
  );
  grad.addColorStop(0, 'rgba(255, 255, 220, 1)');
  grad.addColorStop(0.45, 'rgba(255, 200, 80, 0.7)');
  grad.addColorStop(1, 'rgba(255, 140, 0, 0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, FUSE_SPARK_RADIUS_PX * 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
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
  ctx.globalCompositeOperation = 'lighter';
  // Wake (drawn first, behind the body): dim red-orange smear
  // trailing above the fireball.
  drawFireblob(
    ctx,
    cx,
    centerCy - FIREBALL_WAKE_OFFSET * cellSize,
    cellSize * FIREBALL_WAKE_RADIUS * (1 + jitterAt(0, 0.5)),
    'wake',
  );
  // Body: orange-yellow flame at the fireball's center.
  drawFireblob(
    ctx,
    cx,
    centerCy,
    cellSize * FIREBALL_BODY_RADIUS * (1 + jitterAt(1, 1.7)),
    'body',
  );
  // Leading core: bright white-yellow at the active edge, slightly
  // ahead of center so the teardrop reads as moving downward.
  drawFireblob(
    ctx,
    cx,
    centerCy + FIREBALL_LEADING_OFFSET * cellSize,
    cellSize * FIREBALL_LEADING_RADIUS * (1 + jitterAt(2, 3.4)),
    'leading',
  );
  ctx.restore();
}

function drawFireblob(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  kind: 'leading' | 'body' | 'wake',
): void {
  if (r <= 0) return;
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  if (kind === 'leading') {
    grad.addColorStop(0, 'rgba(255, 255, 245, 0.95)');
    grad.addColorStop(0.3, 'rgba(255, 240, 150, 0.85)');
    grad.addColorStop(0.7, 'rgba(255, 180, 50, 0.55)');
    grad.addColorStop(1, 'rgba(255, 110, 20, 0)');
  } else if (kind === 'body') {
    grad.addColorStop(0, 'rgba(255, 230, 130, 0.85)');
    grad.addColorStop(0.4, 'rgba(255, 180, 60, 0.65)');
    grad.addColorStop(0.8, 'rgba(240, 110, 30, 0.4)');
    grad.addColorStop(1, 'rgba(200, 70, 20, 0)');
  } else {
    grad.addColorStop(0, 'rgba(255, 150, 50, 0.55)');
    grad.addColorStop(0.5, 'rgba(220, 90, 30, 0.4)');
    grad.addColorStop(1, 'rgba(120, 50, 20, 0)');
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
    grad.addColorStop(1, 'rgba(60, 50, 45, 0)');
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
  ctx.globalCompositeOperation = 'lighter';
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
  hue: 'yellow' | 'orange' | 'red',
): void {
  const haloR = coreRadiusPx * 2.6;
  const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, haloR);
  // Hue determines the outer flame color; the core is always near-white
  // so embers read as hot points wrapped in colored fire.
  let outer: string;
  let mid: string;
  if (hue === 'yellow') {
    outer = '255, 200, 60';
    mid = '255, 230, 130';
  } else if (hue === 'orange') {
    outer = '255, 140, 30';
    mid = '255, 180, 70';
  } else {
    outer = '230, 70, 20';
    mid = '255, 120, 40';
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
  ctx.globalCompositeOperation = 'lighter';
  // Two stacked blobs with a small jitter: the same trick the running
  // flame uses, scaled up.
  for (let i = 0; i < 2; i++) {
    const jitter =
      Math.sin(
        (elapsedMs / 1000) * Math.PI * 2 * FLAME_JITTER_FREQS_HZ[i] +
          i * 1.7,
      ) * FLAME_JITTER_AMPLITUDE;
    const blobR = r * (1 + jitter) * (i === 0 ? 1 : 0.7);
    const dx = i === 0 ? 0 : (i % 2 === 0 ? -0.12 : 0.12) * cellSize;
    const grad = ctx.createRadialGradient(
      cx + dx,
      cy,
      0,
      cx + dx,
      cy,
      blobR,
    );
    if (i === 0) {
      grad.addColorStop(0, `rgba(255, 255, 255, ${0.9 * fade})`);
      grad.addColorStop(0.3, `rgba(255, 230, 130, ${0.85 * fade})`);
    } else {
      grad.addColorStop(0, `rgba(255, 220, 100, ${0.7 * fade})`);
      grad.addColorStop(0.4, `rgba(255, 170, 50, ${0.6 * fade})`);
    }
    grad.addColorStop(0.8, `rgba(255, 120, 30, ${0.4 * fade})`);
    grad.addColorStop(1, 'rgba(255, 80, 0, 0)');
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
      const fallProgress = puff.fallDurationMs > 0 ? ageMs / puff.fallDurationMs : 1;
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
    grad.addColorStop(1, 'rgba(60, 50, 45, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
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
        if (!cell || cell.kind === 'empty') continue;
        const sprite =
          cell.kind === 'detonator'
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


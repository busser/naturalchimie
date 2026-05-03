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

import { GRAVITY_MS_PER_CELL } from '../animation/driver';
import type { SpriteAtlas } from '../assets/sprite-loader';
import type { SpriteAsset } from '../assets/sprite-renderer';
import type { Movement, ReactingGroup, State, Step } from '../core/state';

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


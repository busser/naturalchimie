// Canvas 2D renderer for the playfield. Each frame, draws the
// committed snapshot's board cells plus the active piece. When the
// driver is mid-tween, the active piece is drawn at interpolated
// positions instead. Sky and chrome live in CSS; this canvas is
// transparent.

import {
  SPAWN_DURATION_MS,
  SPAWN_PHASE_DOWN_MS,
  SPAWN_PHASE_OUT_MS,
  type InFlight,
} from '../animation/driver';
import {
  SPAWN_ROW,
  type ActivePiece,
  type Board,
  type State,
  type Step,
  type Tier,
} from '../core/state';
import type { SpriteAtlas } from '../assets/sprite-loader';
import {
  drawSpriteAtCell,
  type SpriteAsset,
} from '../assets/sprite-renderer';
import {
  cellKey,
  createEffect,
  type Effect,
  type RenderItem,
} from './effects';
import { createFuseParticles, type FuseParticles } from './fuse';

const BOARD_WIDTH = 7;
const VISIBLE_ROWS = 12;

// Spec calls for a soft separator between code row 6 (top of
// playfield) and code row 7 (start of overflow zone) to mark the
// lose threshold. See 04-visual-style.md.
const LOSE_THRESHOLD_ROW = 7;

// During the spawn step's slide-down phase, the new active piece
// enters the playfield from above. 3 cells puts the piece at
// row SPAWN_ROW + 3 = 12 at the start — just above the topmost
// rendered row (11) — and arrives at the spawn row at phase end.
const SPAWN_ENTRY_OFFSET_CELLS = 3;
const SPAWN_PHASE_OUT_END_T = SPAWN_PHASE_OUT_MS / SPAWN_DURATION_MS;
const SPAWN_PHASE_DOWN_END_T =
  (SPAWN_PHASE_OUT_MS + SPAWN_PHASE_DOWN_MS) / SPAWN_DURATION_MS;

export type Renderer = {
  draw(now: number): void;
};

export type RendererDeps = {
  readonly canvas: HTMLCanvasElement;
  readonly sprites: SpriteAtlas;
  readonly cellSize: number;
  readonly getSnapshot: () => State;
  readonly getInFlight: (now: number) => InFlight | null;
};

export function createRenderer(deps: RendererDeps): Renderer {
  const { canvas, sprites, cellSize, getSnapshot, getInFlight } = deps;
  const cssWidth = BOARD_WIDTH * cellSize;
  const cssHeight = VISIBLE_ROWS * cellSize;
  const ctx = setupCanvas(canvas, cssWidth, cssHeight);

  // Effects (merge bloom, gravity tween) are step-scoped: built when
  // a new merge/gravity step enters flight, dropped when it commits.
  // The driver creates one Step instance per step, so reference
  // identity is enough to detect transitions.
  let effect: Effect | null = null;
  let effectStep: Step | null = null;
  // Fuse particles span the dynamite's whole life as the active piece
  // — spawn-slide, shifts, drop — so it's owned across frames rather
  // than rebuilt per step. Live particles fade out naturally between
  // dynamites; the emitter starts/stops based on the active-piece
  // kind each frame.
  const fuse: FuseParticles = createFuseParticles();

  return {
    draw(now: number) {
      const state = getSnapshot();
      const inflight = getInFlight(now);
      if (inflight === null) {
        effect = null;
        effectStep = null;
      } else if (inflight.step !== effectStep) {
        effect = createEffect(inflight.step, now);
        effectStep = inflight.step;
      }
      ctx.clearRect(0, 0, cssWidth, cssHeight);
      // Apply the effect's canvas-wide shake (e.g., detonator kick)
      // around everything that gets drawn this frame: lose-threshold
      // line, sprites, effect overlays, fuse. clearRect runs before
      // the translate so the cleared region tracks the canvas, not
      // the shifted scene.
      const shake = effect?.getCanvasShake?.(now) ?? null;
      ctx.save();
      if (shake !== null) ctx.translate(shake.x, shake.y);
      drawLoseThreshold(ctx, cellSize, cssWidth, cssHeight);
      // Collect board cells, active halves, and effect-owned sprites
      // (falling cells, shining originals, post-pop new tier) into
      // one list and sort by row descending so lower rows render on
      // top, per 04-visual-style.md ("Element sprites"). Sprite art
      // extrudes outside cell bounds (potion necks, apple stems), so
      // mid-fall and post-pop sprites need to participate in this
      // sort or they cover extrusions of the cells below them.
      const render = activeRenderHalves(state, inflight);
      const items = collectBoardItems(state.board, sprites, effect?.skipCells);
      if (render !== null) {
        const halfSprites = spritesForHalves(render.active, sprites);
        for (let i = 0; i < render.positions.length; i++) {
          items.push({
            sprite: halfSprites[i],
            col: render.positions[i].col,
            row: render.positions[i].row,
          });
        }
      }
      if (effect !== null && inflight !== null) {
        items.push(
          ...effect.getSpriteItems(now, inflight.prevSnapshot, sprites),
        );
      }
      items.sort((a, b) => b.row - a.row);
      for (const item of items) {
        drawAt(ctx, item.sprite, item.col, item.row, cellSize, cssHeight);
      }
      if (effect !== null && inflight !== null) {
        effect.draw(
          ctx,
          now,
          inflight.prevSnapshot,
          sprites,
          cellSize,
          cssHeight,
        );
      }
      // Fuse runs after sprites + effects so glow, sparks, and smoke
      // layer on top. Dynamite-blast and detonator detonations clear
      // the active piece before they begin, so passing null here is
      // what naturally stops emission at the start of the blast.
      const fuseCell =
        render !== null && render.active.kind === 'dynamite'
          ? render.positions[0]
          : null;
      fuse.update(now, fuseCell, sprites, ctx, cellSize, cssHeight);
      ctx.restore();
    },
  };
}

function setupCanvas(
  canvas: HTMLCanvasElement,
  cssWidth: number,
  cssHeight: number,
): CanvasRenderingContext2D {
  const dpr = window.devicePixelRatio ?? 1;
  canvas.width = Math.round(cssWidth * dpr);
  canvas.height = Math.round(cssHeight * dpr);
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('createRenderer: 2D context unavailable');
  ctx.scale(dpr, dpr);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return ctx;
}

function drawLoseThreshold(
  ctx: CanvasRenderingContext2D,
  cellSize: number,
  width: number,
  height: number,
): void {
  const y = height - LOSE_THRESHOLD_ROW * cellSize;
  ctx.save();
  ctx.strokeStyle = 'rgba(240, 232, 208, 0.5)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, y);
  ctx.lineTo(width, y);
  ctx.stroke();
  ctx.restore();
}

function collectBoardItems(
  board: Board,
  sprites: SpriteAtlas,
  skipCells: ReadonlySet<string> | undefined,
): RenderItem[] {
  const items: RenderItem[] = [];
  for (let r = 0; r < board.length; r++) {
    for (let c = 0; c < board[r].length; c++) {
      const cell = board[r][c];
      if (cell.kind === 'empty') continue;
      if (skipCells !== undefined && skipCells.has(cellKey(r, c))) continue;
      items.push({ sprite: assetForCell(cell, sprites), col: c, row: r });
    }
  }
  return items;
}

function drawAt(
  ctx: CanvasRenderingContext2D,
  asset: SpriteAsset,
  col: number,
  row: number,
  cellSize: number,
  height: number,
): void {
  const x = col * cellSize;
  const y = height - (row + 1) * cellSize;
  drawSpriteAtCell(ctx, asset, x, y, cellSize);
}

function assetForCell(
  cell: { kind: 'element'; tier: Tier } | { kind: 'detonator' },
  sprites: SpriteAtlas,
): SpriteAsset {
  return cell.kind === 'detonator'
    ? sprites.detonator
    : sprites.byTier[cell.tier];
}

// Visual cell positions of the active piece's halves at the current
// frame, paired with the active piece whose sprites should be drawn.
// Position math is shared with the fuse particle subsystem so its
// emitter pins to the same point the sprite pipeline draws.
export type ActiveRenderHalves = {
  readonly active: ActivePiece;
  readonly positions: readonly HalfPosition[];
};

type HalfPosition = { readonly col: number; readonly row: number };

// During the spawn step the committed snapshot still has `active:
// null` (post-land) — the new piece only commits at step end. Read it
// from the in-flight step's snapshot and slide it down from above the
// canvas. Outside spawn, fall through to the existing rules, which
// expect a non-null committed active.
export function activeRenderHalves(
  state: State,
  inflight: InFlight | null,
): ActiveRenderHalves | null {
  if (inflight !== null && inflight.step.event.kind === 'spawn') {
    const next = inflight.step.snapshot.active;
    if (next === null) return null;
    const positions = spawnSlidePositions(next, inflight.t);
    if (positions.length === 0) return null;
    return { active: next, positions };
  }
  if (state.active === null) return null;
  return activeRenderHalvesAtMoment(state.active, inflight);
}

function activeRenderHalvesAtMoment(
  committedActive: ActivePiece,
  inflight: InFlight | null,
): ActiveRenderHalves {
  if (inflight === null) {
    return { active: committedActive, positions: staticPositions(committedActive) };
  }
  const prev = inflight.prevSnapshot.active;
  if (prev === null) {
    return { active: committedActive, positions: staticPositions(committedActive) };
  }
  const next = inflight.step.snapshot.active;
  switch (inflight.step.event.kind) {
    case 'pair-shift':
      if (next === null) {
        return { active: committedActive, positions: staticPositions(committedActive) };
      }
      return { active: prev, positions: shiftPositions(prev, next, easeOut(inflight.t)) };
    case 'pair-rotate':
      if (next === null) {
        return { active: committedActive, positions: staticPositions(committedActive) };
      }
      return { active: prev, positions: rotatePositions(prev, next, easeOut(inflight.t)) };
    case 'pair-land':
      // pair-land's next snapshot has `active: null` by design — the
      // piece is in the air during the fall and the board picks it up
      // at commit. Render from the prev pair plus the step's payload.
      return { active: prev, positions: landPositions(prev, inflight.step, inflight.t) };
    case 'solo-land':
      return {
        active: prev,
        positions: soloLandPositions(prev, inflight.step.event.landingRow, inflight.t),
      };
    default:
      return { active: committedActive, positions: staticPositions(committedActive) };
  }
}

function spritesForHalves(
  active: ActivePiece,
  sprites: SpriteAtlas,
): SpriteAsset[] {
  switch (active.kind) {
    case 'pair':
      return [sprites.byTier[active.first], sprites.byTier[active.second]];
    case 'dynamite':
      return [sprites.dynamite];
    case 'detonator':
      return [sprites.detonator];
  }
}

function staticPositions(active: ActivePiece): HalfPosition[] {
  switch (active.kind) {
    case 'pair':
      if (active.orientation === 'horizontal') {
        return [
          { col: active.column, row: SPAWN_ROW },
          { col: active.column + 1, row: SPAWN_ROW },
        ];
      }
      // Vertical pair in the spawn area: half-row offsets so the
      // rotation center stays put. By convention first = bottom,
      // second = top (see state.ts). Bottom is the lower row index.
      return [
        { col: active.column, row: SPAWN_ROW - 0.5 },
        { col: active.column, row: SPAWN_ROW + 0.5 },
      ];
    case 'dynamite':
    case 'detonator':
      return [{ col: active.column, row: SPAWN_ROW }];
  }
}

function spawnSlidePositions(next: ActivePiece, t: number): HalfPosition[] {
  // Phase 1: prev preview is sliding out of the recess; nothing on the
  // playfield yet so the eye sees one piece at a time.
  if (t < SPAWN_PHASE_OUT_END_T) return [];
  const positions = staticPositions(next);
  // Phase 3: piece has settled at the spawn row; new preview is
  // sliding into the recess.
  if (t >= SPAWN_PHASE_DOWN_END_T) return positions;
  // Phase 2: piece slides from above the canvas to the spawn row.
  const phaseT =
    (t - SPAWN_PHASE_OUT_END_T) / (SPAWN_PHASE_DOWN_END_T - SPAWN_PHASE_OUT_END_T);
  const eased = easeInOut(phaseT);
  const rowOffset = (1 - eased) * SPAWN_ENTRY_OFFSET_CELLS;
  return positions.map((p) => ({ col: p.col, row: p.row + rowOffset }));
}

// Linear lerp on column/row. Shift and rotate both preserve sprite
// identity at each index, so a positional lerp matches by index.
function shiftPositions(
  prev: ActivePiece,
  next: ActivePiece,
  easedT: number,
): HalfPosition[] {
  const fromPositions = staticPositions(prev);
  const toPositions = staticPositions(next);
  return fromPositions.map((from, i) => ({
    col: lerp(from.col, toPositions[i].col, easedT),
    row: lerp(from.row, toPositions[i].row, easedT),
  }));
}

// Both halves arc 90° clockwise around the pair's midpoint, with
// the midpoint itself sliding linearly from the prev midpoint to
// the next one (the two midpoints differ by half a cell whenever
// the rotation center sits on a column boundary, including the
// spawn position and after a wall-kick). The math lands halves
// exactly on their post-step positions at t=1.
function rotatePositions(
  prev: ActivePiece,
  next: ActivePiece,
  easedT: number,
): HalfPosition[] {
  if (prev.kind !== 'pair' || next.kind !== 'pair') return staticPositions(prev);
  const fromPositions = staticPositions(prev);
  const cFrom = pairMidpoint(prev);
  const cTo = pairMidpoint(next);
  const angle = (Math.PI / 2) * easedT;
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  const cCol = lerp(cFrom.col, cTo.col, easedT);
  const cRow = lerp(cFrom.row, cTo.row, easedT);
  return fromPositions.map((from) => {
    const dC = from.col - cFrom.col;
    const dR = from.row - cFrom.row;
    // 90° CW rotation in (col, row) where row points up:
    //   (Δc, Δr) → (Δc·cos + Δr·sin, -Δc·sin + Δr·cos)
    return {
      col: cCol + dC * cosA + dR * sinA,
      row: cRow - dC * sinA + dR * cosA,
    };
  });
}

function pairMidpoint(active: ActivePiece): { col: number; row: number } {
  if (active.kind !== 'pair') return { col: active.column, row: SPAWN_ROW };
  return active.orientation === 'horizontal'
    ? { col: active.column + 0.5, row: SPAWN_ROW }
    : { col: active.column, row: SPAWN_ROW };
}

// Both halves fall under the same eased curve so they travel the
// same vertical distance per unit time. The shorter-fall half hits
// its landing row partway through and sits there while the longer
// half finishes. (An earlier version scaled `t` per half, which made
// the shorter half move faster instead of just stopping earlier —
// halves looked like they obeyed different gravity.)
function landPositions(
  prev: ActivePiece,
  step: Step,
  t: number,
): HalfPosition[] {
  if (prev.kind !== 'pair' || step.event.kind !== 'pair-land') {
    return staticPositions(prev);
  }
  const fromPositions = staticPositions(prev);
  const firstColumn = prev.column;
  const secondColumn =
    prev.orientation === 'horizontal' ? prev.column + 1 : prev.column;
  const targets = [
    { col: firstColumn, row: step.event.firstLandingRow },
    { col: secondColumn, row: step.event.secondLandingRow },
  ];
  const distances = fromPositions.map((from, i) => from.row - targets[i].row);
  const maxDistance = Math.max(...distances);
  const cellsFallen = easeIn(t) * maxDistance;
  return fromPositions.map((from, i) => {
    const ownDistance = distances[i];
    const progress =
      ownDistance > 0 ? Math.min(1, cellsFallen / ownDistance) : 1;
    return {
      col: lerp(from.col, targets[i].col, progress),
      row: lerp(from.row, targets[i].row, progress),
    };
  });
}

function soloLandPositions(
  prev: ActivePiece,
  landingRow: number,
  t: number,
): HalfPosition[] {
  if (prev.kind === 'pair') return staticPositions(prev);
  const fromPositions = staticPositions(prev);
  const eased = easeIn(t);
  return fromPositions.map((from) => ({
    col: from.col,
    row: lerp(from.row, landingRow, eased),
  }));
}

function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

function easeIn(t: number): number {
  return t * t;
}

function easeInOut(t: number): number {
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

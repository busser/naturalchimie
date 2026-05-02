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
import { cellKey, createEffect, type Effect } from './effects';

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

type RenderHalf = {
  readonly sprite: SpriteAsset;
  readonly col: number;
  readonly row: number;
};

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
      drawLoseThreshold(ctx, cellSize, cssWidth, cssHeight);
      // Collect board cells and active halves into one list and sort
      // by row descending so lower rows render on top, per
      // 04-visual-style.md ("Element sprites"). Drawing the active
      // pile separately put a falling pair in front of board cells
      // below it on the way down, then snapped behind them on commit.
      const items = collectBoardItems(state.board, sprites, effect?.skipCells);
      items.push(...activeHalves(state, inflight, sprites));
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
): RenderHalf[] {
  const items: RenderHalf[] = [];
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

// During the spawn step the committed snapshot still has `active:
// null` (post-land) — the new piece only commits at step end. Read it
// from the in-flight step's snapshot and slide it down from above the
// canvas. Outside spawn, fall through to the existing rules, which
// expect a non-null committed active.
function activeHalves(
  state: State,
  inflight: InFlight | null,
  sprites: SpriteAtlas,
): RenderHalf[] {
  if (inflight !== null && inflight.step.event.kind === 'spawn') {
    const next = inflight.step.snapshot.active;
    if (next === null) return [];
    return spawnSlideHalves(next, inflight.t, sprites);
  }
  if (state.active === null) return [];
  return activeHalvesAtMoment(state.active, inflight, sprites);
}

function spawnSlideHalves(
  next: ActivePiece,
  t: number,
  sprites: SpriteAtlas,
): RenderHalf[] {
  // Phase 1: prev preview is sliding out of the recess; nothing on the
  // playfield yet so the eye sees one piece at a time.
  if (t < SPAWN_PHASE_OUT_END_T) return [];
  const halves = staticHalves(next, sprites);
  // Phase 3: piece has settled at the spawn row; new preview is
  // sliding into the recess.
  if (t >= SPAWN_PHASE_DOWN_END_T) return halves;
  // Phase 2: piece slides from above the canvas to the spawn row.
  const phaseT =
    (t - SPAWN_PHASE_OUT_END_T) / (SPAWN_PHASE_DOWN_END_T - SPAWN_PHASE_OUT_END_T);
  const eased = easeInOut(phaseT);
  const rowOffset = (1 - eased) * SPAWN_ENTRY_OFFSET_CELLS;
  return halves.map((h) => ({ ...h, row: h.row + rowOffset }));
}

function activeHalvesAtMoment(
  committedActive: ActivePiece,
  inflight: InFlight | null,
  sprites: SpriteAtlas,
): RenderHalf[] {
  if (inflight === null) return staticHalves(committedActive, sprites);
  const prev = inflight.prevSnapshot.active;
  if (prev === null) return staticHalves(committedActive, sprites);
  const next = inflight.step.snapshot.active;
  switch (inflight.step.event.kind) {
    case 'pair-shift':
      if (next === null) return staticHalves(committedActive, sprites);
      return shiftHalves(prev, next, easeOut(inflight.t), sprites);
    case 'pair-rotate':
      if (next === null) return staticHalves(committedActive, sprites);
      return rotateHalves(prev, next, easeOut(inflight.t), sprites);
    case 'pair-land':
      // pair-land's next snapshot has `active: null` by design — the
      // piece is in the air during the fall and the board picks it up
      // at commit. Render from the prev pair plus the step's payload.
      return landHalves(prev, inflight.step, inflight.t, sprites);
    case 'solo-land':
      return soloLandHalves(
        prev,
        inflight.step.event.landingRow,
        inflight.t,
        sprites,
      );
    default:
      return staticHalves(committedActive, sprites);
  }
}

function staticHalves(active: ActivePiece, sprites: SpriteAtlas): RenderHalf[] {
  switch (active.kind) {
    case 'pair':
      if (active.orientation === 'horizontal') {
        return [
          {
            sprite: sprites.byTier[active.first],
            col: active.column,
            row: SPAWN_ROW,
          },
          {
            sprite: sprites.byTier[active.second],
            col: active.column + 1,
            row: SPAWN_ROW,
          },
        ];
      }
      // Vertical pair in the spawn area: half-row offsets so the
      // rotation center stays put. By convention first = bottom,
      // second = top (see state.ts). Bottom is the lower row index.
      return [
        {
          sprite: sprites.byTier[active.first],
          col: active.column,
          row: SPAWN_ROW - 0.5,
        },
        {
          sprite: sprites.byTier[active.second],
          col: active.column,
          row: SPAWN_ROW + 0.5,
        },
      ];
    case 'dynamite':
      return [{ sprite: sprites.dynamite, col: active.column, row: SPAWN_ROW }];
    case 'detonator':
      return [
        { sprite: sprites.detonator, col: active.column, row: SPAWN_ROW },
      ];
  }
}

// Linear lerp on column/row. Shift and rotate both preserve sprite
// identity at each index, so a positional lerp matches by index.
function shiftHalves(
  prev: ActivePiece,
  next: ActivePiece,
  easedT: number,
  sprites: SpriteAtlas,
): RenderHalf[] {
  const fromHalves = staticHalves(prev, sprites);
  const toHalves = staticHalves(next, sprites);
  return fromHalves.map((from, i) => ({
    sprite: from.sprite,
    col: lerp(from.col, toHalves[i].col, easedT),
    row: lerp(from.row, toHalves[i].row, easedT),
  }));
}

// Both halves arc 90° clockwise around the pair's midpoint, with
// the midpoint itself sliding linearly from the prev midpoint to
// the next one (the two midpoints differ by half a cell whenever
// the rotation center sits on a column boundary, including the
// spawn position and after a wall-kick). The math lands halves
// exactly on their post-step positions at t=1.
function rotateHalves(
  prev: ActivePiece,
  next: ActivePiece,
  easedT: number,
  sprites: SpriteAtlas,
): RenderHalf[] {
  if (prev.kind !== 'pair' || next.kind !== 'pair') {
    return staticHalves(prev, sprites);
  }
  const fromHalves = staticHalves(prev, sprites);
  const cFrom = pairMidpoint(prev);
  const cTo = pairMidpoint(next);
  const angle = (Math.PI / 2) * easedT;
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  const cCol = lerp(cFrom.col, cTo.col, easedT);
  const cRow = lerp(cFrom.row, cTo.row, easedT);
  return fromHalves.map((from) => {
    const dC = from.col - cFrom.col;
    const dR = from.row - cFrom.row;
    // 90° CW rotation in (col, row) where row points up:
    //   (Δc, Δr) → (Δc·cos + Δr·sin, -Δc·sin + Δr·cos)
    return {
      sprite: from.sprite,
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
function landHalves(
  prev: ActivePiece,
  step: Step,
  t: number,
  sprites: SpriteAtlas,
): RenderHalf[] {
  if (prev.kind !== 'pair' || step.event.kind !== 'pair-land') {
    return staticHalves(prev, sprites);
  }
  const fromHalves = staticHalves(prev, sprites);
  const firstColumn = prev.column;
  const secondColumn =
    prev.orientation === 'horizontal' ? prev.column + 1 : prev.column;
  const targets = [
    { col: firstColumn, row: step.event.firstLandingRow },
    { col: secondColumn, row: step.event.secondLandingRow },
  ];
  const distances = fromHalves.map((from, i) => from.row - targets[i].row);
  const maxDistance = Math.max(...distances);
  const cellsFallen = easeIn(t) * maxDistance;
  return fromHalves.map((from, i) => {
    const ownDistance = distances[i];
    const progress =
      ownDistance > 0 ? Math.min(1, cellsFallen / ownDistance) : 1;
    return {
      sprite: from.sprite,
      col: lerp(from.col, targets[i].col, progress),
      row: lerp(from.row, targets[i].row, progress),
    };
  });
}

function soloLandHalves(
  prev: ActivePiece,
  landingRow: number,
  t: number,
  sprites: SpriteAtlas,
): RenderHalf[] {
  if (prev.kind === 'pair') return staticHalves(prev, sprites);
  const fromHalves = staticHalves(prev, sprites);
  const eased = easeIn(t);
  return fromHalves.map((from) => ({
    sprite: from.sprite,
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

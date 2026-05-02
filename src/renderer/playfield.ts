// Canvas 2D renderer for the playfield. Each frame, draws the
// committed snapshot's board cells plus the active piece. When the
// driver is mid-tween, the active piece is drawn at interpolated
// positions instead. Sky and chrome live in CSS; this canvas is
// transparent.

import type { InFlight } from '../animation/driver';
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

const BOARD_WIDTH = 7;
const VISIBLE_ROWS = 12;

// Spec calls for a soft separator between code row 6 (top of
// playfield) and code row 7 (start of overflow zone) to mark the
// lose threshold. See 04-visual-style.md.
const LOSE_THRESHOLD_ROW = 7;

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

  return {
    draw(now: number) {
      const state = getSnapshot();
      const inflight = getInFlight(now);
      ctx.clearRect(0, 0, cssWidth, cssHeight);
      drawLoseThreshold(ctx, cellSize, cssWidth, cssHeight);
      drawBoard(ctx, state.board, sprites, cellSize, cssHeight);
      if (state.active !== null) {
        const halves = activeHalvesAtMoment(state.active, inflight, sprites);
        // Higher rows draw first so lower rows render on top, per
        // 04-visual-style.md ("Element sprites"). Mid-rotation the
        // halves swap row positions and the order updates each frame.
        const ordered = [...halves].sort((a, b) => b.row - a.row);
        for (const half of ordered) {
          drawAt(ctx, half.sprite, half.col, half.row, cellSize, cssHeight);
        }
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

function drawBoard(
  ctx: CanvasRenderingContext2D,
  board: Board,
  sprites: SpriteAtlas,
  cellSize: number,
  height: number,
): void {
  // Iterate from highest row down so lower rows render last (= on
  // top), letting upward-extruding sprite tops sit behind the row
  // above's body, per 04-visual-style.md ("Element sprites").
  for (let r = board.length - 1; r >= 0; r--) {
    for (let c = 0; c < board[r].length; c++) {
      const cell = board[r][c];
      if (cell.kind === 'empty') continue;
      const asset = assetForCell(cell, sprites);
      drawAt(ctx, asset, c, r, cellSize, height);
    }
  }
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

// Each half falls in place at 50 ms/cell (driver-enforced via the
// step's total duration). When the two halves' fall distances differ
// the shorter half finishes first and then sits at its landing cell;
// the per-half progress below scales raw `t` accordingly so both
// halves move at the same on-screen speed regardless of distance.
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
  return fromHalves.map((from, i) => {
    const ownDistance = distances[i];
    const ownT =
      ownDistance > 0 ? Math.min(1, (t * maxDistance) / ownDistance) : 1;
    const eased = easeIn(ownT);
    return {
      sprite: from.sprite,
      col: lerp(from.col, targets[i].col, eased),
      row: lerp(from.row, targets[i].row, eased),
    };
  });
}

function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

function easeIn(t: number): number {
  return t * t;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

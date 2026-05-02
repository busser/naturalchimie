// Canvas 2D renderer for the playfield. Reads a State each frame and
// draws board cells plus the active piece. The sky background and
// chrome live in CSS; this canvas is transparent.

import type { ActivePiece, Board, State, Tier } from '../core/state';
import type { SpriteAtlas } from '../assets/sprite-loader';
import {
  drawSpriteAtCell,
  type SpriteAsset,
} from '../assets/sprite-renderer';

const BOARD_WIDTH = 7;
const VISIBLE_ROWS = 12;

// Code row 9 = spec row 10 = where the active piece sits in the
// spawn area. The row is fixed for the piece's whole lifetime, per
// 08-software-design.md ("State shape").
const SPAWN_ROW = 9;

// Spec calls for a soft separator between code row 6 (top of
// playfield) and code row 7 (start of overflow zone) to mark the
// lose threshold. See 04-visual-style.md.
const LOSE_THRESHOLD_ROW = 7;

export type Renderer = {
  draw(): void;
};

export type RendererDeps = {
  readonly canvas: HTMLCanvasElement;
  readonly sprites: SpriteAtlas;
  readonly cellSize: number;
  readonly getSnapshot: () => State;
};

export function createRenderer(deps: RendererDeps): Renderer {
  const { canvas, sprites, cellSize, getSnapshot } = deps;
  const cssWidth = BOARD_WIDTH * cellSize;
  const cssHeight = VISIBLE_ROWS * cellSize;
  const ctx = setupCanvas(canvas, cssWidth, cssHeight);

  return {
    draw() {
      drawFrame(ctx, getSnapshot(), sprites, cellSize, cssWidth, cssHeight);
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
  return ctx;
}

function drawFrame(
  ctx: CanvasRenderingContext2D,
  state: State,
  sprites: SpriteAtlas,
  cellSize: number,
  width: number,
  height: number,
): void {
  ctx.clearRect(0, 0, width, height);
  drawLoseThreshold(ctx, cellSize, width, height);
  drawBoard(ctx, state.board, sprites, cellSize, height);
  if (state.active) drawActive(ctx, state.active, sprites, cellSize, height);
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
  for (let r = 0; r < board.length; r++) {
    for (let c = 0; c < board[r].length; c++) {
      const cell = board[r][c];
      if (cell.kind === 'empty') continue;
      const asset = assetForCell(cell, sprites);
      drawAt(ctx, asset, c, r, cellSize, height);
    }
  }
}

function drawActive(
  ctx: CanvasRenderingContext2D,
  active: ActivePiece,
  sprites: SpriteAtlas,
  cellSize: number,
  height: number,
): void {
  switch (active.kind) {
    case 'pair':
      if (active.orientation === 'horizontal') {
        drawAt(ctx, sprites.byTier[active.first], active.column, SPAWN_ROW, cellSize, height);
        drawAt(ctx, sprites.byTier[active.second], active.column + 1, SPAWN_ROW, cellSize, height);
      } else {
        // Vertical pair in the spawn area: half-row offsets so the
        // rotation center stays put. By convention first = bottom,
        // second = top (see state.ts).
        drawAt(ctx, sprites.byTier[active.first], active.column, SPAWN_ROW - 0.5, cellSize, height);
        drawAt(ctx, sprites.byTier[active.second], active.column, SPAWN_ROW + 0.5, cellSize, height);
      }
      return;
    case 'dynamite':
      drawAt(ctx, sprites.dynamite, active.column, SPAWN_ROW, cellSize, height);
      return;
    case 'detonator':
      drawAt(ctx, sprites.detonator, active.column, SPAWN_ROW, cellSize, height);
      return;
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

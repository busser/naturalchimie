// Renders the next-piece preview into a small canvas in the sidebar.
// Pairs are always shown in horizontal orientation (the orientation a
// freshly spawned pair takes); solo items are centered in the frame.

import type { Piece } from '../core/state';
import type { SpriteAtlas } from '../assets/sprite-loader';
import {
  drawSpriteAtCell,
  type SpriteAsset,
} from '../assets/sprite-renderer';

// Sprites extrude beyond their cell footprint: potion corks and apple
// stems reach up to ~0.5 cells above; tilted shapes lean past the cell
// width to the right. The canvas allocates half a cell of headroom on
// top and on each side so extrusions render inside instead of being
// clipped at the edge.
const PIECE_COLS = 2;
const SIDE_HEADROOM = 0.5;
const TOP_HEADROOM = 0.5;
const PIECE_LEFT_COL = SIDE_HEADROOM;
const PIECE_ROW = TOP_HEADROOM;

export type PreviewRenderer = {
  draw(piece: Piece): void;
};

export type PreviewRendererDeps = {
  readonly canvas: HTMLCanvasElement;
  readonly sprites: SpriteAtlas;
  readonly cellSize: number;
};

export function createPreviewRenderer(
  deps: PreviewRendererDeps,
): PreviewRenderer {
  const { canvas, sprites, cellSize } = deps;
  const cssWidth = (PIECE_COLS + 2 * SIDE_HEADROOM) * cellSize;
  const cssHeight = (1 + TOP_HEADROOM) * cellSize;
  const ctx = setupCanvas(canvas, cssWidth, cssHeight);

  let lastPiece: Piece | null = null;

  return {
    draw(piece) {
      if (piece === lastPiece) return;
      lastPiece = piece;
      ctx.clearRect(0, 0, cssWidth, cssHeight);
      drawPiece(ctx, piece, sprites, cellSize);
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
  if (!ctx) throw new Error('createPreviewRenderer: 2D context unavailable');
  ctx.scale(dpr, dpr);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return ctx;
}

function drawPiece(
  ctx: CanvasRenderingContext2D,
  piece: Piece,
  sprites: SpriteAtlas,
  cellSize: number,
): void {
  const center = PIECE_LEFT_COL + 0.5;
  switch (piece.kind) {
    case 'pair':
      drawAt(ctx, sprites.byTier[piece.first], PIECE_LEFT_COL, PIECE_ROW, cellSize);
      drawAt(ctx, sprites.byTier[piece.second], PIECE_LEFT_COL + 1, PIECE_ROW, cellSize);
      return;
    case 'dynamite':
      drawAt(ctx, sprites.dynamite, center, PIECE_ROW, cellSize);
      return;
    case 'detonator':
      drawAt(ctx, sprites.detonator, center, PIECE_ROW, cellSize);
      return;
  }
}

function drawAt(
  ctx: CanvasRenderingContext2D,
  asset: SpriteAsset,
  col: number,
  row: number,
  cellSize: number,
): void {
  drawSpriteAtCell(ctx, asset, col * cellSize, row * cellSize, cellSize);
}

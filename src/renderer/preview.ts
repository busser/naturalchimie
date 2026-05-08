// Renders the next-piece preview into a small canvas in the sidebar.
// Pairs are always shown in horizontal orientation (the orientation a
// freshly spawned pair takes); solo items are centered in the frame.
// During the spawn step, the prev preview piece slides up out of the
// frame, the frame is briefly empty, and the next preview piece slides
// down into the frame from above (see 05-animations.md).

import {
  SPAWN_DURATION_MS,
  SPAWN_PHASE_IN_MS,
  SPAWN_PHASE_OUT_MS,
  type InFlight,
} from '../animation/driver';
import type { Piece, State } from '../core/state';
import type { SpriteAtlas } from '../assets/sprite-loader';
import {
  drawSpriteAtCell,
  type SpriteAsset,
} from '../assets/sprite-renderer';
import { applyCanvasSize } from './canvas';

// Canvas height matches the preview recess (2 cells = 96 px at the
// playfield's 48 px cell size, which is what `.preview` is set to in
// CSS). With the canvas filling the recess, a piece sliding off the
// top vanishes at the recess's top edge instead of partway through
// the parchment around it. Top headroom of 0.75 cells preserves the
// piece's prior visual rest position (36 px from the recess top, with
// room above for cork extrusions); the remaining 0.25 cells of bottom
// headroom is what's left of the recess height.
const PIECE_COLS = 2;
const SIDE_HEADROOM = 0.5;
const TOP_HEADROOM = 0.75;
const BOTTOM_HEADROOM = 0.25;
const PIECE_LEFT_COL = SIDE_HEADROOM;
const PIECE_ROW = TOP_HEADROOM;

// Cells of slide motion during spawn phases 1 and 3. PIECE_ROW + 1
// puts the piece's bottom exactly at the canvas top at the end of
// the slide-out, so the canvas's clip swallows the piece cleanly;
// phase 3 starts from this same offset and descends to rest.
const SLIDE_DISTANCE = 1 + TOP_HEADROOM;

const PHASE_OUT_END = SPAWN_PHASE_OUT_MS / SPAWN_DURATION_MS;
const PHASE_IN_START =
  (SPAWN_DURATION_MS - SPAWN_PHASE_IN_MS) / SPAWN_DURATION_MS;

export type PreviewRenderer = {
  draw(now: number): void;
  resize(cellSize: number): void;
};

export type PreviewRendererDeps = {
  readonly canvas: HTMLCanvasElement;
  readonly sprites: SpriteAtlas;
  readonly cellSize: number;
  readonly getSnapshot: () => State;
  readonly getInFlight: (now: number) => InFlight | null;
};

export function createPreviewRenderer(
  deps: PreviewRendererDeps,
): PreviewRenderer {
  const { canvas, sprites, getSnapshot, getInFlight } = deps;
  let cellSize = deps.cellSize;
  let cssWidth = (PIECE_COLS + 2 * SIDE_HEADROOM) * cellSize;
  let cssHeight = (1 + TOP_HEADROOM + BOTTOM_HEADROOM) * cellSize;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('createPreviewRenderer: 2D context unavailable');
  applyCanvasSize(canvas, ctx, cssWidth, cssHeight);

  return {
    resize(nextCellSize: number) {
      if (nextCellSize === cellSize) return;
      cellSize = nextCellSize;
      cssWidth = (PIECE_COLS + 2 * SIDE_HEADROOM) * cellSize;
      cssHeight = (1 + TOP_HEADROOM + BOTTOM_HEADROOM) * cellSize;
      applyCanvasSize(canvas, ctx, cssWidth, cssHeight);
    },
    draw(now: number) {
      const state = getSnapshot();
      const inflight = getInFlight(now);
      const drawing = computeDrawing(state, inflight);
      ctx.clearRect(0, 0, cssWidth, cssHeight);
      if (drawing === null) return;
      drawPiece(ctx, drawing.piece, drawing.rowOffset, sprites, cellSize);
    },
  };
}

type Drawing = { readonly piece: Piece; readonly rowOffset: number };

function computeDrawing(
  state: State,
  inflight: InFlight | null,
): Drawing | null {
  if (inflight === null || inflight.step.event.kind !== 'spawn') {
    return { piece: state.preview, rowOffset: 0 };
  }
  const t = inflight.t;
  if (t < PHASE_OUT_END) {
    const phaseT = t / PHASE_OUT_END;
    return {
      piece: inflight.prevSnapshot.preview,
      rowOffset: -SLIDE_DISTANCE * easeInOut(phaseT),
    };
  }
  if (t < PHASE_IN_START) return null;
  const phaseT = (t - PHASE_IN_START) / (1 - PHASE_IN_START);
  return {
    piece: inflight.step.snapshot.preview,
    rowOffset: -SLIDE_DISTANCE * (1 - easeInOut(phaseT)),
  };
}

function easeInOut(t: number): number {
  return t * t * (3 - 2 * t);
}

function drawPiece(
  ctx: CanvasRenderingContext2D,
  piece: Piece,
  rowOffset: number,
  sprites: SpriteAtlas,
  cellSize: number,
): void {
  const center = PIECE_LEFT_COL + 0.5;
  const row = PIECE_ROW + rowOffset;
  switch (piece.kind) {
    case 'pair':
      drawAt(ctx, sprites.byTier[piece.first], PIECE_LEFT_COL, row, cellSize);
      drawAt(ctx, sprites.byTier[piece.second], PIECE_LEFT_COL + 1, row, cellSize);
      return;
    case 'dynamite':
      drawAt(ctx, sprites.dynamite, center, row, cellSize);
      return;
    case 'detonator':
      drawAt(ctx, sprites.detonator, center, row, cellSize);
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

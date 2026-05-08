// Renders the highest tier produced this run as a favicon. Climbs
// monotonically: a tier can only be replaced by a strictly higher
// one, so consuming a high-tier element in a merge doesn't regress
// the icon. reset() drops the watermark when a new run starts.
//
// Also paints the apple-touch-icon once at startup so iOS home-screen
// bookmarks pick up the tier-1 sprite. iOS captures the icon when the
// user adds the page to the home screen and doesn't refresh it after,
// so this one isn't tied to the climbing favicon.

import type { SpriteAtlas } from './assets/sprite-loader';
import { drawSpriteAtCell } from './assets/sprite-renderer';
import type { State, Tier } from './core/state';

const FAVICON_SIZE = 64;
// 2x Apple's recommended 180x180 (iPhone @3x). The sprite source PNG
// is large (1024+ px wide), and downscaling it directly to 180 leaves
// visible aliasing on the bottle outline. Rendering at 360 gives the
// canvas a less aggressive downscale; iOS resamples to display size
// with its own (high-quality) scaler. iOS captures the icon once when
// the user adds the page to the home screen and doesn't refresh after,
// so this is painted a single time at startup with tier 1.
const APPLE_TOUCH_ICON_SIZE = 360;
// Headroom above the cell footprint for sprite parts that extrude
// upward (potion necks, apple stems). Bottom-anchored sprites need no
// equivalent below, so the cell sits at the bottom of the canvas.
const TOP_HEADROOM_CELLS = 0.25;
// Sky gradient endpoints, mirroring --sky-top / --sky-bottom in
// style.css. Used as the apple-touch-icon background: iOS composites
// transparent pixels over black, so the icon needs an opaque fill.
const SKY_TOP = '#a8d8f0';
const SKY_BOTTOM = '#80b8e0';
// Fraction of the apple-touch-icon canvas occupied by the sprite cell.
// The remaining space is split as padding so the sprite (including any
// upward extrusion like the potion's cork) sits comfortably inside
// iOS's rounded-corner mask.
const APPLE_TOUCH_ICON_CELL_FRACTION = 0.6;

export type Favicon = {
  update(state: State): void;
  reset(): void;
};

export function createFavicon(sprites: SpriteAtlas): Favicon {
  paintAppleTouchIcon(sprites);
  const link = ensureLink('icon');
  const canvas = document.createElement('canvas');
  canvas.width = FAVICON_SIZE;
  canvas.height = FAVICON_SIZE;
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('createFavicon: 2D context unavailable');

  const cellSize = FAVICON_SIZE / (1 + TOP_HEADROOM_CELLS);
  const cellX = (FAVICON_SIZE - cellSize) / 2;
  const cellY = TOP_HEADROOM_CELLS * cellSize;

  let highestTier = 0;

  function render(tier: Tier): void {
    ctx!.clearRect(0, 0, FAVICON_SIZE, FAVICON_SIZE);
    drawSpriteAtCell(ctx!, sprites.byTier[tier], cellX, cellY, cellSize);
    link.href = canvas.toDataURL('image/png');
  }

  // Paint tier 1 immediately so the tab has an icon from page load,
  // not only after the first element lands.
  render(1);
  highestTier = 1;

  return {
    update(state) {
      let tier = 1;
      for (const row of state.board) {
        for (const cell of row) {
          if (cell.kind === 'element' && cell.tier > tier) tier = cell.tier;
        }
      }
      if (tier <= highestTier) return;
      highestTier = tier;
      render(tier as Tier);
    },
    reset() {
      highestTier = 1;
      render(1);
    },
  };
}

function ensureLink(rel: string): HTMLLinkElement {
  const existing = document.querySelector<HTMLLinkElement>(
    `link[rel="${rel}"]`,
  );
  if (existing) return existing;
  const link = document.createElement('link');
  link.rel = rel;
  document.head.appendChild(link);
  return link;
}

function paintAppleTouchIcon(sprites: SpriteAtlas): void {
  const link = ensureLink('apple-touch-icon');
  const canvas = document.createElement('canvas');
  canvas.width = APPLE_TOUCH_ICON_SIZE;
  canvas.height = APPLE_TOUCH_ICON_SIZE;
  const ctx = canvas.getContext('2d');
  if (ctx === null) {
    throw new Error('paintAppleTouchIcon: 2D context unavailable');
  }
  // Default is 'low' (bilinear). 'high' picks a better filter for the
  // significant downscale from the 1024+ px source sprite.
  ctx.imageSmoothingQuality = 'high';

  const gradient = ctx.createLinearGradient(0, 0, 0, APPLE_TOUCH_ICON_SIZE);
  gradient.addColorStop(0, SKY_TOP);
  gradient.addColorStop(1, SKY_BOTTOM);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, APPLE_TOUCH_ICON_SIZE, APPLE_TOUCH_ICON_SIZE);

  // Vertically, the sprite extends above its cell by up to
  // TOP_HEADROOM_CELLS (potion cork, apple stem). Shift the cell down
  // so the headroom-plus-cell column is centered in the canvas, which
  // keeps equal padding above the cork and below the cell.
  const cellSize = APPLE_TOUCH_ICON_SIZE * APPLE_TOUCH_ICON_CELL_FRACTION;
  const cellX = (APPLE_TOUCH_ICON_SIZE - cellSize) / 2;
  const verticalPadding =
    (APPLE_TOUCH_ICON_SIZE - cellSize * (1 + TOP_HEADROOM_CELLS)) / 2;
  const cellY = verticalPadding + TOP_HEADROOM_CELLS * cellSize;
  drawSpriteAtCell(ctx, sprites.byTier[1], cellX, cellY, cellSize);
  link.href = canvas.toDataURL('image/png');
}

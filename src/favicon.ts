// Renders the highest tier produced this run as a favicon. Climbs
// monotonically: a tier can only be replaced by a strictly higher
// one, so consuming a high-tier element in a merge doesn't regress
// the icon. reset() drops the watermark when a new run starts.

import type { SpriteAtlas } from './assets/sprite-loader';
import { drawSpriteAtCell } from './assets/sprite-renderer';
import type { State, Tier } from './core/state';

const FAVICON_SIZE = 64;
// Headroom above the cell footprint for sprite parts that extrude
// upward (potion necks, apple stems). Bottom-anchored sprites need no
// equivalent below, so the cell sits at the bottom of the canvas.
const TOP_HEADROOM_CELLS = 0.25;

export type Favicon = {
  update(state: State): void;
  reset(): void;
};

export function createFavicon(sprites: SpriteAtlas): Favicon {
  const link = ensureLink();
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

function ensureLink(): HTMLLinkElement {
  const existing = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (existing) return existing;
  const link = document.createElement('link');
  link.rel = 'icon';
  document.head.appendChild(link);
  return link;
}

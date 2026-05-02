// Loads sprite metadata + PNGs into a SpriteAtlas keyed by tier
// (1–12) plus the two special items. Single fetch of sprites.json
// followed by parallel image loads.

import type { Tier } from '../core/state';
import type { SpriteAsset } from './sprite-renderer';

export type SpriteAtlas = {
  readonly byTier: Readonly<Record<Tier, SpriteAsset>>;
  readonly dynamite: SpriteAsset;
  readonly detonator: SpriteAsset;
};

type RawEntry = {
  file: string;
  anchor: [number, number];
  cell_width_px: number;
  cell_height_px: number;
};

const SPRITES_DIR = '/sprites';

export async function loadSprites(): Promise<SpriteAtlas> {
  const res = await fetch(`${SPRITES_DIR}/sprites.json`);
  if (!res.ok) {
    throw new Error(`loadSprites: sprites.json HTTP ${res.status}`);
  }
  const metadata = (await res.json()) as Record<string, RawEntry>;

  const entries = await Promise.all(
    Object.entries(metadata).map(async ([key, entry]) => {
      const image = await loadImage(`${SPRITES_DIR}/${entry.file}`);
      const asset: SpriteAsset = {
        anchor: entry.anchor,
        cell_width_px: entry.cell_width_px,
        cell_height_px: entry.cell_height_px,
        image,
      };
      return [key, asset] as const;
    }),
  );

  const byTier: Partial<Record<Tier, SpriteAsset>> = {};
  let dynamite: SpriteAsset | undefined;
  let detonator: SpriteAsset | undefined;
  for (const [key, asset] of entries) {
    const tier = parseTierKey(key);
    if (tier !== null) {
      byTier[tier] = asset;
    } else if (key === 'special-dynamite') {
      dynamite = asset;
    } else if (key === 'special-detonator') {
      detonator = asset;
    } else {
      throw new Error(`loadSprites: unrecognised sprite key "${key}"`);
    }
  }

  for (let t = 1; t <= 12; t++) {
    if (!(t in byTier)) {
      throw new Error(`loadSprites: missing sprite for tier ${t}`);
    }
  }
  if (!dynamite) throw new Error('loadSprites: missing special-dynamite');
  if (!detonator) throw new Error('loadSprites: missing special-detonator');

  return {
    byTier: byTier as Record<Tier, SpriteAsset>,
    dynamite,
    detonator,
  };
}

function parseTierKey(key: string): Tier | null {
  const m = key.match(/^tier-(\d{2})-/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (n >= 1 && n <= 12) return n as Tier;
  return null;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`loadImage: failed to load ${src}`));
    img.src = src;
  });
}

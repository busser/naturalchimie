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
  fuse_tip?: [number, number];
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
        fuse_tip: entry.fuse_tip,
        image,
        palette: extractPalette(image, 3),
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

// Sampled at load time so visual effects (shrapnel, etc.) can tint
// themselves to each element's body colors without per-element
// metadata. Pixels are bucketed at 4 bits/channel — coarse enough
// that anti-aliased gradients collapse onto their parent color, fine
// enough that distinct sprite tones survive. Per-bucket r/g/b sums
// are averaged on output so we get accurate hues rather than
// bucket-center colors.
const PALETTE_SAMPLE_SIZE = 64;
const PALETTE_FALLBACK = 'rgb(180, 130, 80)';

function extractPalette(img: HTMLImageElement, n: number): readonly string[] {
  const w = Math.min(PALETTE_SAMPLE_SIZE, img.width);
  const h = Math.min(PALETTE_SAMPLE_SIZE, img.height);
  if (w <= 0 || h <= 0) return Array(n).fill(PALETTE_FALLBACK);
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d');
  if (!ctx) return Array(n).fill(PALETTE_FALLBACK);
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  const buckets = new Map<
    number,
    { count: number; r: number; g: number; b: number }
  >();
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a < 200) continue;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    // Skip outline-grade darks and highlight-grade brights so the
    // palette captures the body colors a player perceives, not the
    // structural inkwork around them.
    if (r + g + b < 60) continue;
    if (r > 240 && g > 240 && b > 240) continue;
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const entry = buckets.get(key);
    if (entry) {
      entry.count++;
      entry.r += r;
      entry.g += g;
      entry.b += b;
    } else {
      buckets.set(key, { count: 1, r, g, b });
    }
  }
  const sorted = [...buckets.values()].sort((a, b) => b.count - a.count);
  if (sorted.length === 0) return Array(n).fill(PALETTE_FALLBACK);
  const palette: string[] = [];
  for (let i = 0; i < n && i < sorted.length; i++) {
    const { r, g, b, count } = sorted[i];
    palette.push(
      `rgb(${Math.round(r / count)}, ${Math.round(g / count)}, ${Math.round(b / count)})`,
    );
  }
  while (palette.length < n) palette.push(palette[0]);
  return palette;
}

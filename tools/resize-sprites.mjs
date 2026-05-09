// Resizes the sprite PNGs in a directory, transcodes them to WebP, and
// rewrites sprites.json with scaled coordinates and the new filenames so
// the runtime keeps anchoring correctly.
//
// The renderer (src/assets/sprite-renderer.ts) reads anchor / cell_width_px /
// cell_height_px / fuse_tip as source-pixel coordinates on the loaded image.
// Halving the PNG without halving these values would scale every sprite to
// twice its intended cell footprint, so the metadata moves with the pixels.
// The runtime loads images via `new Image()` and reads them with
// `drawImage` / `getImageData`, which all decode WebP transparently in
// modern browsers.
//
// Usage as a CLI:
//   node tools/resize-sprites.mjs <dir> [scale] [quality]
// Defaults: scale 0.5 (1024x1536 -> 512x768), quality 85.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

export async function resizeSprites({ dir, scale = 0.5, quality = 85 }) {
  const metaPath = path.join(dir, 'sprites.json');
  const meta = JSON.parse(await fs.readFile(metaPath, 'utf8'));

  const scalePoint = ([x, y]) => [Math.round(x * scale), Math.round(y * scale)];
  const scaleLength = (n) => Math.round(n * scale);

  for (const entry of Object.values(meta)) {
    const oldFile = entry.file;
    const oldPath = path.join(dir, oldFile);
    const newFile = oldFile.replace(/\.png$/i, '.webp');
    const newPath = path.join(dir, newFile);

    const source = sharp(oldPath);
    const { width, height } = await source.metadata();
    const buffer = await source
      .resize(Math.round(width * scale), Math.round(height * scale))
      .webp({ quality })
      .toBuffer();
    await fs.writeFile(newPath, buffer);
    if (newPath !== oldPath) await fs.rm(oldPath);

    entry.file = newFile;
    entry.anchor = scalePoint(entry.anchor);
    entry.cell_width_px = scaleLength(entry.cell_width_px);
    entry.cell_height_px = scaleLength(entry.cell_height_px);
    if (entry.fuse_tip) entry.fuse_tip = scalePoint(entry.fuse_tip);
  }

  await fs.writeFile(metaPath, JSON.stringify(meta, null, 2) + '\n');

  // The authoring backups under abandoned-designs/ are copied along with the
  // live sprites by Vite's public/ pipeline. They aren't used at runtime, so
  // strip them from the production bundle.
  await fs.rm(path.join(dir, 'abandoned-designs'), {
    recursive: true,
    force: true,
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = process.argv[2];
  const scale = process.argv[3] ? parseFloat(process.argv[3]) : 0.5;
  const quality = process.argv[4] ? parseInt(process.argv[4], 10) : 85;
  if (!dir) {
    console.error('usage: node tools/resize-sprites.mjs <dir> [scale] [quality]');
    process.exit(1);
  }
  await resizeSprites({ dir, scale, quality });
}

// Single source of truth for sprite rendering.
// Imported by both the runtime game and the sprite authoring tool.
// See docs/07-sprite-metadata-and-tooling.md for the full contract.

export interface SpriteAsset {
  /** [x, y] in source pixels: bottom-center of cell-footprint */
  anchor: [number, number];
  /** width in source pixels of the cell-footprint rectangle */
  cell_width_px: number;
  /** height in source pixels of the cell-footprint rectangle */
  cell_height_px: number;
  /** optional [x, y] in source pixels for particle emission (dynamite fuse) */
  fuse_tip?: [number, number];
  image: HTMLImageElement;
  /**
   * Up to 3 dominant body colors sampled from the image at load time,
   * used to tint visual effects driven by the sprite (e.g. shrapnel
   * thrown by the detonator's blast). Near-transparent, near-white,
   * and near-black pixels are filtered so outlines and highlights
   * don't dominate. Sorted by frequency, most common first.
   */
  palette: readonly string[];
}

/**
 * Draw a sprite into a cell.
 *
 * The source image is drawn whole (not cropped to the cell-footprint).
 * The cell-footprint rectangle defines the scale and the anchor only,
 * so extruding parts (potion necks, apple stems) render outside the cell
 * naturally, scaled consistently with the main body.
 */
export function drawSpriteAtCell(
  ctx: CanvasRenderingContext2D,
  sprite: SpriteAsset,
  cell_screen_x: number,
  cell_screen_y: number,
  cell_size_px: number,
): void {
  const scale_x = cell_size_px / sprite.cell_width_px;
  const scale_y = cell_size_px / sprite.cell_height_px;

  const anchor_screen_x = cell_screen_x + cell_size_px / 2;
  const anchor_screen_y = cell_screen_y + cell_size_px;

  const draw_x = anchor_screen_x - sprite.anchor[0] * scale_x;
  const draw_y = anchor_screen_y - sprite.anchor[1] * scale_y;

  ctx.drawImage(
    sprite.image,
    draw_x,
    draw_y,
    sprite.image.width * scale_x,
    sprite.image.height * scale_y,
  );
}

/**
 * Map a source-pixel point on the sprite to its on-screen position when
 * drawn at a given cell. Uses the same scale + anchor offset as
 * drawSpriteAtCell, so attachment points (e.g. dynamite fuse tip) stay
 * pinned to the sprite as it moves.
 */
export function spriteSourcePointToScreen(
  sprite: SpriteAsset,
  source: readonly [number, number],
  cell_screen_x: number,
  cell_screen_y: number,
  cell_size_px: number,
): { x: number; y: number } {
  const scale_x = cell_size_px / sprite.cell_width_px;
  const scale_y = cell_size_px / sprite.cell_height_px;
  const anchor_screen_x = cell_screen_x + cell_size_px / 2;
  const anchor_screen_y = cell_screen_y + cell_size_px;
  return {
    x: anchor_screen_x + (source[0] - sprite.anchor[0]) * scale_x,
    y: anchor_screen_y + (source[1] - sprite.anchor[1]) * scale_y,
  };
}

// Single source of truth for sprite rendering.
// Imported by both the runtime game and the sprite authoring tool.
// See docs/07-sprite-metadata-and-tooling.md for the full contract.

/**
 * @typedef {Object} SpriteAsset
 * @property {[number, number]} anchor  - [x, y] in source pixels: bottom-center of cell-footprint
 * @property {number} cell_width_px     - width in source pixels of the cell-footprint rectangle
 * @property {number} cell_height_px    - height in source pixels of the cell-footprint rectangle
 * @property {CanvasImageSource} image  - the loaded source image
 */

/**
 * Draw a sprite into a cell.
 *
 * The source image is drawn whole (not cropped to the cell-footprint).
 * The cell-footprint rectangle defines the scale and the anchor only,
 * so extruding parts (potion necks, apple stems) render outside the cell
 * naturally, scaled consistently with the main body.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {SpriteAsset} sprite
 * @param {number} cell_screen_x  - left edge of cell on screen
 * @param {number} cell_screen_y  - top edge of cell on screen
 * @param {number} cell_size_px   - on-screen size of one cell
 */
export function drawSpriteAtCell(ctx, sprite, cell_screen_x, cell_screen_y, cell_size_px) {
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

// Timing and sizing constants for the merge animation. Lives in its
// own module so the game-over plan (which reuses the merge primitives
// at the board scale) can import them without creating a cycle through
// effects.ts <-> driver.ts.

// Reference cell size the original pixel-tuned values were authored
// against. Pixel constants below were divided by this once so they
// read as cell-units; the renderer multiplies by the live cellSize.
const REFERENCE_CELL_PX = 48;

export const SHINE_DURATION_MS = 140;

export const BUBBLES_PER_CELL = 4;
export const BUBBLE_TRAVEL_MIN_MS = 280;
export const BUBBLE_TRAVEL_MAX_MS = 480;
// The Bezier control point sits at cell + scatterDir * scatterDistance.
// The visible apex of the curve is roughly halfway between cell and
// the control point, so this number is the "how far does P1 push out"
// rather than "how far the bubble travels outward".
export const BUBBLE_SCATTER_DISTANCE_MIN_CELLS = 1.1;
export const BUBBLE_SCATTER_DISTANCE_MAX_CELLS = 2.0;
export const BUBBLE_BASE_RADIUS_MIN_CELLS = 4.0 / REFERENCE_CELL_PX;
export const BUBBLE_BASE_RADIUS_MAX_CELLS = 6.0 / REFERENCE_CELL_PX;

export const POP_DURATION_MS = 100;

// Droplets sell the "soap bubble pop" feel: when the orb snaps off,
// a ring of small bright points scatters outward, sags slightly under
// gravity, and fades. Count is fixed (not scaled with merge size) -
// the orb's own radius already grows with cell count, so droplet
// parity isn't perceivable, and a fixed budget keeps overdraw bounded.
export const DROPLET_COUNT_PER_GROUP = 10;
export const DROPLET_LIFETIME_MS = 250;
// Travel distance is measured outward *from the orb's perimeter*, not
// from its center - droplets fly off the membrane.
export const DROPLET_SCATTER_DISTANCE_MIN_CELLS = 0.7;
export const DROPLET_SCATTER_DISTANCE_MAX_CELLS = 1.2;
// Smaller than bubbles (4-6 px) so they read as "tiny droplets",
// not "more bubbles".
export const DROPLET_BASE_RADIUS_MIN_CELLS = 2.5 / REFERENCE_CELL_PX;
export const DROPLET_BASE_RADIUS_MAX_CELLS = 4.0 / REFERENCE_CELL_PX;

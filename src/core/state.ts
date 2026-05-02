// Concrete shape of the core game state, the inputs that drive it,
// and the steps it produces. See docs/08-software-design.md for the
// design rationale.

// Tier of an element in the transmutation chain. Tier 1 is the green
// potion; tier 12 is the gold nugget.
export type Tier = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;

// The row at which the active piece sits for its whole life. Modelled
// as a constant rather than a state field so shift/rotate transitions
// don't carry it around (see ActivePiece doc). Both rendering and the
// drop-fall animation read it from here.
export const SPAWN_ROW = 9;

// Anchor column for a freshly spawned piece. Spec column 4 (1-indexed)
// is code column 3. A horizontal pair anchored here spans the spawn
// position columns 4–5; solo items sit at column 4.
export const SPAWN_COLUMN = 3;

// 0-indexed grid position. Row 0 is the floor; column 0 is the left wall.
export type Pos = { readonly row: number; readonly column: number };

// What occupies a single board cell.
export type Cell =
  | { readonly kind: "empty" }
  | { readonly kind: "element"; readonly tier: Tier }
  | { readonly kind: "detonator" };

// Indexed [row][column]. Width 7. Height 9: rows 0–6 are the playfield,
// rows 7–8 are the overflow zone.
export type Board = readonly (readonly Cell[])[];

export type Orientation = "horizontal" | "vertical";

// What the player controls.
//
// Only the column varies during an active piece's life: shift moves it
// left/right, rotate flips orientation, drop consumes the piece into
// the board. The row is fixed at the spawn row throughout — modelled
// as a rendering-layer constant rather than threaded through every
// transition. For a pair, `column` is the lower-column anchor (the
// left cell when horizontal, the only column when vertical). `first`
// is the element at that anchor; `second` is the other one.
//
// 90° clockwise rotation maps spatial positions left→top, right→
// bottom, top→right, bottom→left. With first = anchor end, the
// labels swap on H→V (the old left becomes the new top) and stay
// put on V→H (the old bottom is still the new left). Four rotations
// restore the original configuration; two rotations swap first and
// second.
//
// Solo items occupy a single cell and have no orientation.
export type ActivePiece =
  | {
      readonly kind: "pair";
      readonly column: number;
      readonly orientation: Orientation;
      readonly first: Tier;
      readonly second: Tier;
    }
  | { readonly kind: "dynamite"; readonly column: number }
  | { readonly kind: "detonator"; readonly column: number };

// What spawn produces. No position — position is added when a piece
// becomes active.
export type Piece =
  | { readonly kind: "pair"; readonly first: Tier; readonly second: Tier }
  | { readonly kind: "dynamite" }
  | { readonly kind: "detonator" };

// The full game position.
//
// `active` is null between cascades and after game over.
// `score` carries forward through cascade snapshots and re-syncs to
// `sum(3^(tier-1))` over the playfield only when the board is stable.
export type State = {
  readonly board: Board;
  readonly active: ActivePiece | null;
  readonly preview: Piece;
  readonly score: number;
};

// One player action. The core's signature is `(state, input, rng) →
// (state', steps, rng')` for each of these.
export type Input =
  | { readonly kind: "shift"; readonly direction: "left" | "right" }
  | { readonly kind: "rotate" }
  | { readonly kind: "drop" };

// A unit of state transition with a self-contained animation. The
// `event` discriminator and its (forthcoming) payload tell the
// animation layer what to play; `snapshot` tells the store and
// renderer what is true after the step completes.
export type Step = {
  readonly event: StepEvent;
  readonly snapshot: State;
};

// One reacting connected component, captured for the merge step's
// animation. The animation collapses every cell in `cells` into
// `landing` and replaces it with a tier-`tierAfter` element. A merge
// step carries one entry per concurrent group on the same cascade
// tick; the design doc's "concurrent effects belong inside a single
// step" rule.
export type ReactingGroup = {
  readonly cells: readonly Pos[];
  readonly landing: Pos;
  readonly tierBefore: Tier;
  readonly tierAfter: Tier;
};

// One cell falling under gravity. Same column on both ends; only the
// row changes. The animation derives per-column drop distances from
// the list, so cells stay grouped to whichever column they belong to.
export type Movement = { readonly from: Pos; readonly to: Pos };

export type StepEvent =
  | { readonly kind: "pair-shift" }
  | { readonly kind: "pair-rotate" }
  | {
      readonly kind: "pair-land";
      readonly firstLandingRow: number;
      readonly secondLandingRow: number;
    }
  | { readonly kind: "solo-land"; readonly landingRow: number }
  | { readonly kind: "merge"; readonly groups: readonly ReactingGroup[] }
  | { readonly kind: "gravity"; readonly movements: readonly Movement[] }
  | { readonly kind: "detonate" }
  | { readonly kind: "dynamite-blast" }
  | { readonly kind: "spawn" }
  | { readonly kind: "game-over" };

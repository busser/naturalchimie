// Concrete shape of the core game state, the inputs that drive it,
// and the steps it produces. See docs/08-software-design.md for the
// design rationale.

// Tier of an element in the transmutation chain. Tier 1 is the green
// potion; tier 12 is the gold nugget.
export type Tier = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;

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
// For a pair, `anchor` is the lower-coordinate cell — the left cell when
// horizontal, the bottom cell when vertical. `first` is the element at
// the anchor; `second` is the other one. Rotation flips `orientation`
// but preserves the first/second labels:
//   horizontal left  ↔ vertical bottom  (= first)
//   horizontal right ↔ vertical top     (= second)
//
// Solo items occupy a single cell and have no orientation.
export type ActivePiece =
  | {
      readonly kind: "pair";
      readonly anchor: Pos;
      readonly orientation: Orientation;
      readonly first: Tier;
      readonly second: Tier;
    }
  | { readonly kind: "dynamite"; readonly pos: Pos }
  | { readonly kind: "detonator"; readonly pos: Pos };

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

// Per-event payloads are added when each step kind is implemented.
export type StepEvent =
  | { readonly kind: "pair-shift" }
  | { readonly kind: "pair-rotate" }
  | { readonly kind: "pair-land" }
  | { readonly kind: "merge" }
  | { readonly kind: "gravity" }
  | { readonly kind: "detonate" }
  | { readonly kind: "dynamite-blast" }
  | { readonly kind: "spawn" };

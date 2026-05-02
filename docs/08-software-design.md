# Software Design

This file captures the high-level software design of the game:
how the code is organised, what runs where, and how the pieces
fit together. It is a working document — sections will be added
as decisions are made.

## Tech stack

The game runs in the browser. The implementation language is
**TypeScript** with `strict: true`. The build tool is **Vite**
and the test runner is **Vitest**.

Discriminated unions are the preferred shape for sum types
(active piece kind, animation step kind, and so on) so that the
compiler enforces exhaustive case handling.

## Code organisation

The codebase is split into layers, listed here in dependency
order from purest to most side-effecting:

- **Core** — pure data types and pure functions. Includes the
  board and pair representations, the spawn pool, and the
  cascade simulator (drop, react, gravity, score, pool growth).
  Imports nothing from the renderer, the DOM, browser APIs, or
  the store. Exhaustively unit-tested via the scenarios in
  `06-acceptance-tests.md`.
- **Store** — holds the current core state plus
  presentation-only state (pending animation timeline, RNG
  instance, game-over flag). The active pair is part of core
  state, not the store. Receives input actions, calls into
  core, exposes a subscribe interface for the renderer.
- **Input** — keyboard handler that translates key events into
  store actions. Buffering and held-key behavior are described
  in "Input handling" below.
- **Animation** — consumes the timeline produced by the core's
  cascade simulator and schedules its visual playback. See
  "Logic and animation sequencing" below.
- **Renderer** — subscribes to the store and draws the current
  frame on `requestAnimationFrame`.
- **Assets** — sprite drawing and loading. See "Sprites" below.
- **Main** — wires the layers together and starts the loop.

## Project structure

The on-disk layout mirrors the layers above. Each layer is a
directory under `src/`, created when that layer is first
implemented rather than as an empty stub.

```
naturalchimie/
├── index.html               # Vite entry → src/main.ts
├── package.json
├── tsconfig.json
├── vite.config.ts           # Multi-page input: index + tools/sprite-tool
├── public/
│   └── sprites/             # Served at /sprites/* (Vite convention)
│       ├── sprites.json
│       └── tier-NN-*.png
├── src/
│   ├── main.ts              # Wires layers together, starts the loop
│   ├── core/                # Pure: imports nothing outward
│   ├── store/
│   ├── input/
│   ├── animation/
│   ├── renderer/
│   └── assets/              # Sprite loading + drawSpriteAtCell
├── tools/
│   └── sprite-tool.html     # Imports src/assets/sprite-renderer.ts
└── docs/
```

Tests are co-located as `*.test.ts` next to the code they
cover, run via Vitest. The acceptance scenarios in
`06-acceptance-tests.md` map to tests under `src/core/`.

The "core imports nothing outward" rule (see "Code
organisation") is enforced with an ESLint
`no-restricted-imports` rule scoped to `src/core/**`, configured
in `eslint.config.js`. It bans imports from any sibling layer
(`store`, `input`, `animation`, `renderer`, `assets`). Run
`npm run lint` to check.

## Logic and animation sequencing

Every player input goes through the core. The core is a pure
function `(state, input, rng) → (state', steps, rng')`: given
the current state, an input, and the RNG, it returns the new
state, an ordered list of steps describing how to get there,
and the advanced RNG. This holds for all inputs, not just the
down-arrow drop — left/right shifts and rotations also produce
step lists. Cosmetic inputs yield a single-step list; a drop
that triggers a long cascade yields many. The core stays
completely time-free, and acceptance tests assert against the
returned state and step list directly.

State here is the full game position: the 7×7 board plus the
active pair (or its absence — between cascades and after game
over there is no pair). Shift and rotate inputs operate on
`state.activePair`; drop converts it into committed board cells
and the ensuing cascade operates on the board alone. The store
mirrors this state but does not own any part of it.

### Step shape

A "step" is one unit of state transition with a self-contained
animation. Each step carries:

- a **kind** discriminator (`"pair-shift"`, `"pair-rotate"`,
  `"pair-land"`, `"merge"`, `"gravity"`, `"detonate"`, etc.),
- a **payload** describing the event (which cells merged into
  which target cell, how far each column fell, where the
  dynamite landed, …),
- the **post-step snapshot** of the game position (board and
  active pair).

The kind and payload tell the animation layer what visual to
play. The snapshot tells the store and renderer what is
currently true on the board. The redundancy is deliberate: it
lets the animation layer stay pure visuals (`"play a merge of
cells A, B, C into D"`) and the renderer stay trivial (`"draw
the current board"`), with no diffing or state inference on
either side.

State itself only ever describes a valid game position — there
are no "reaction-pending" markers or other animation concepts
in the state shape. Anything in flight lives in the step, not
the state.

Granularity is whatever the animation layer finds easiest to
render. The dynamite blast is one step even though its visual
plays out cell by cell as it travels downward, because the
post-blast state is fully determined and the cell-level timing
belongs to the animation. Concurrent effects also belong
inside a single step: when one drop produces two disjoint
matches in different parts of the board, both merges play
simultaneously as one step rather than serialised into two.

### Playback

The store holds a `currentSnapshot` (the latest committed
game position) and a queue of pending steps. Playback proceeds:

1. The animation layer reads the next step's kind and payload
   and plays the visual transition from `currentSnapshot` to
   the step's post-step snapshot.
2. The renderer draws `currentSnapshot` each frame; the
   animation layer overdraws the transition on top of the
   affected cells.
3. When the animation completes, the store sets
   `currentSnapshot` to the step's snapshot and advances to
   the next step.
4. When the queue empties, the board is stable and input
   unlocks.

The store therefore advances one step at a time, on each
animation's *completion* — not on its start. This avoids the
renderer ever showing post-step results (e.g. the merged
tier-N+1 element) before the visual transition has played.
The animation layer holds animation state only: no logical
board, no fork from the core's truth.

### Game over

When a cascade settles into a board that satisfies the spec's
lose condition (an element above the playfield on a stable
board), the core appends a terminal `"game-over"` step to the
timeline. The step's snapshot carries the prior board forward
and sets `active: null`. The animation layer plays the
fade-and-overlay visual described under "Game over" in
`05-animations.md`; once it completes the queue is empty, and
input is locked simply because there is no active pair to act
on.

The terminal step is the only signal — there is no separate
flag on the snapshot. A flag would duplicate `active: null`
plus an empty queue, and using a step keeps the renderer's
"draw the current snapshot" path uniform.

Restart is triggered by the input layer on `Space` after the
fade completes. It discards the current state and reseeds the
RNG, so each restart is a different run.

## Input handling

Inputs are buffered, but only while an active pair is on the
board. Inputs that arrive before a pair has spawned, or after
its drop has been committed, are ignored.

### Buffering

Each fresh `keydown` (with `event.repeat === false`) enqueues
one action. The buffer drains one action per pair-animation
cycle: when the current rotate, shift, or landing animation
completes, the next buffered action plays. Rapid double-taps
of rotate therefore produce two rotations even if the second
press lands during the first rotation's animation.

There is no cap on buffer length. Animations are short and a
real player cannot queue more than a handful of presses ahead.
Implementers should not add a "safety" cap.

### Drop closes the buffer

Once `drop` is pressed, any further input for this pair —
including during the drop's fall animation — is discarded. The
cascade that follows has no active pair to act on, so a
draining buffer would have nothing to apply.

### Held keys

OS-level auto-repeat (`keydown` events with `event.repeat ===
true`) is ignored. The input layer rolls its own:

- Track which recognised keys are currently held (via
  `keydown` / `keyup` transitions).
- When the active pair is idle and the buffer is empty, if a
  movement key is still held, fire one input for that key.

The repeat rate is therefore one action per animation cycle:
the player rotates or shifts continuously while holding, and
when they release, the in-flight animation completes and
motion stops.

Held-key state tracks hardware, not the pair. A held `down`
arrow at the moment a new pair spawns therefore drops that
pair immediately. This is intentional and falls out of the
rule consistently.

## Rendering surface

The playfield and its particles render to a single **Canvas 2D**
context. The chrome (parchment sidebar, vine borders, painted
mountain backdrop) is HTML/CSS, since it doesn't need pixel-level
control and reflows naturally with the layout.

### Resizing

The playfield aspect ratio is fixed (7×7 grid plus a sidebar).
On window resize:

1. Measure the available viewport.
2. Compute the largest `cell_size_px` that fits, capped at the
   PNG-native sprite resolution so we never upscale and blur.
3. Set the canvas bitmap to `cssSize × devicePixelRatio` and the
   CSS size to the layout size, then `ctx.scale(dpr, dpr)` so
   draw calls stay in CSS pixels. This keeps rendering crisp on
   HiDPI screens.
4. Redraw. The redraw is cheap — 49 cells plus particles — so we
   don't need incremental updates.

`drawSpriteAtCell` already takes `cell_size_px` as a parameter,
so the resize path reduces to "recompute the cell size and
redraw."

## Sprites

The twelve element sprites and the two special items are
**PNGs** with transparent backgrounds, authored in the
hand-drawn cartoon style described in `04-visual-style.md`.
They live in `sprites/` alongside a `sprites.json` metadata
file that maps each PNG into a grid cell (cell-footprint size,
anchor, sub-cell offset). See `07-sprite-metadata-and-tooling.md`
for the schema and the authoring tool. The shared rendering
function lives in `src/sprite-renderer.js` and draws into a
Canvas 2D context.

Particles (the sparkles in the merge animation, the smoke puff
after the dynamite blast) are drawn programmatically.

## RNG

The single seedable RNG required by `03-spawning.md` lives in
`src/core/rng.ts` as a hand-rolled **Mulberry32** generator
(~5 lines, no dependency, period 2³², statistically fine for a
puzzle game). The state is an opaque `Rng` value and `nextFloat`
returns `[value, nextRng]` rather than mutating in place, so the
core stays purely functional: `(state, input, rng) → (state',
steps, rng')`.

## Coordinate convention

In code, the playfield is indexed with **row 0 at the floor**,
increasing upward, and **column 0 on the left**. So `board[0][0]`
is the bottom-left cell, `board[6][6]` is the top-right of the
7×7 playfield, and rows 7–8 are the overflow zone above it.

This makes gravity and "lowest empty cell" read naturally:
"lowest empty cell in column `c`" is the smallest `r` such that
`board[r][c]` is empty; gravity moves elements toward smaller
row indices; overflow on a stable board is "any element with
`row >= 7`."

The spec text in `01-gameplay-rules.md` uses 1-indexed coordinates
(row 1 = floor) for human readability. Code is 0-indexed; if any
coordinate ever surfaces in the UI, the +1 offset is applied at
the rendering boundary.

## State shape

The concrete TypeScript types live in `src/core/state.ts`. The
top-level shape is:

```ts
type State = {
  board: Board;            // [row][column], 7 wide × 9 tall (rows 0–6 playfield, 7–8 overflow)
  active: ActivePiece | null;
  preview: Piece;
  score: number;
};
```

A few choices are worth calling out, since they propagate through
the rest of the codebase:

- **`Cell` is a discriminated union** with `"empty"` as a member
  rather than `null`-as-empty. Matches the project preference for
  exhaustive case handling (see "Tech stack") and lets cell
  handlers be uniform `switch`es.
- **`active: ActivePiece | null` is plain nullable**, not a
  union member. Absence of a piece is a guard at the top of input
  handling and step generation; it has no fields of its own and
  doesn't benefit from being grouped under the discriminator.
- **Preview lives in the state.** The next piece is determined as
  soon as the previous one is committed, so it's part of game
  truth — not presentation. Snapshots therefore fully describe
  what the player can see.
- **Score lives in the state**, even though it is computable from
  the board. The spec rule "the score updates only on a stable
  board" makes it genuinely stateful: during a cascade, the
  displayed score holds at the previous stable value while the
  board changes underneath. Carrying the score forward through
  cascade snapshots and re-syncing on stable-board steps is the
  natural way to honour that rule. It also keeps the `3^(tier−1)`
  formula inside the core, so the renderer reads a number rather
  than knowing about powers of three.
- **`Pair` carries first/second labels**, not just two cells. The
  spec rotation rules ("the element that was on the right ends
  up on the top") preserve identity through rotation, which an
  unlabelled "two cells" representation would lose.
- **`ActivePiece` stores only a column**, not a 2D position. The
  active piece spawns at a fixed row and only ever shifts
  horizontally or rotates in place; drop consumes it into the
  board the same frame the player presses down. Spec
  (`01-gameplay-rules.md`) rules out soft drop, gravity timer,
  and any other mechanism that would move the piece vertically
  while it is active. Threading a row through every shift and
  rotate transition would be carrying a constant in disguise.
  The spawn row lives in the rendering layer instead, alongside
  the rest of the layout.

Step events under `StepEvent` are stubbed with their `kind`
discriminator only. Each event's payload is filled in alongside
the implementation of the step that produces it, so we don't
speculate about what an animation needs before writing it.

## Animation layer

A single `requestAnimationFrame` driver owns playback. The
store exposes `currentSnapshot` and a queue of pending steps;
the driver pulls the queue head, plays it for the step's
duration, and on completion calls back into the store to
commit `currentSnapshot = step.snapshot` and advance the
queue. The renderer subscribes to the store and asks the
driver, each frame, for any in-flight visual override —
returned as an interpolation between `currentSnapshot` (still
the *prior* committed state during playback) and the head
step's snapshot.

Tweens are hand-rolled. Each step kind owns a small
`playback(prev, next, progress)` function that returns the
visual override for that frame; the driver supplies
`progress = elapsed / duration` clamped to `[0, 1]` and an
ease curve. No tween dependency: the entire surface is shift,
rotate, fall, fade, scale — a few lines of `lerp` per kind.

Advancing on completion (not start) is what guarantees the
renderer never shows post-step results before the visual
plays. The store's commit is therefore driver-triggered, not
core-triggered.

## Layer wiring in `main.ts`

The startup sequence:

1. Create the store with an initial `State` and a seeded RNG.
2. Create the animation driver, bound to the store.
3. Create the renderer, bound to the store and driver.
4. Create the input layer, which dispatches `Input` actions to
   the store on `keydown`.
5. Start the driver's `requestAnimationFrame` loop.

The dispatch flow on a key press:

`input → store.dispatch(input) → applyInput(currentSnapshot,
input, rng) → store appends steps to its queue (no commit
yet) → driver picks up the head step on the next frame →
driver plays it → on completion, driver tells the store to
commit the snapshot and pop the queue.`

The store therefore never advances `currentSnapshot` itself;
that's the driver's job. This keeps the "commit on
completion" rule in one place.

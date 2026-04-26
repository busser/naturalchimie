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
  presentation-only state (active-pair position, pending
  animation timeline, RNG instance, game-over flag). Receives
  input actions, calls into core, exposes a subscribe interface
  for the renderer.
- **Input** — keyboard handler that translates key events into
  store actions. Locks input while a cascade animation is
  playing.
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

When the player presses the down arrow, the entire consequence
of that input — the drop, every reaction, every gravity step,
any detonations, the resulting score and pool changes — is
fully determined by the current state and the seeded RNG. The
player has no further input until the sequence completes.

We exploit this: the core's cascade simulator computes the
**entire** sequence eagerly and returns it as an ordered list
of steps. The animation layer then plays the steps back as a
timeline, one after another. This keeps the core completely
time-free (a pure function of `(state, input) → step[]`) and
makes the test suite trivial — acceptance tests assert against
the final state and the step list, both of which fall out of
the core directly.

A "step" is a unit of state transition with a single
self-contained animation. Granularity is whatever the animation
layer finds easiest to render: the dynamite blast is one step,
even though its visual plays out cell by cell as it travels
downward, because the post-blast state is fully determined and
the cell-by-cell timing belongs to the animation, not the
state. The exact step shape is deferred until the animation
layer is built.

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

## Open questions

- **Step shape and granularity for the animation timeline.** To
  be designed when the animation layer is built.
- **How the store applies steps during animation playback.** The
  core returns the entire step list eagerly, but it is not
  decided whether the store advances its logical state one step
  at a time as the animation plays each one, or whether it
  jumps straight to the post-cascade state and the animation
  layer holds its own visual state until playback finishes.
  This affects what the renderer reads from the store and how
  mid-cascade frames are produced.
- **Input handling while a cascade is playing.** Input is locked
  during cascade animation, but it is not specified whether key
  presses during the lock are dropped or buffered for the next
  stable board. The choice affects feel, especially for fast
  players chaining drops.

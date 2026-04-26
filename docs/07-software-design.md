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

## Sprites

For the initial implementation, sprites are drawn
**programmatically** — either as inline SVG or as canvas draw
calls, depending on the rendering surface — so that logic and
animations can land without waiting on illustration work. The
result will not fully match the spec's "hand-drawn cartoon"
target; it is a placeholder that we can iterate on.

Particles (the sparkles in the merge animation, the smoke puff
after the dynamite blast) are drawn programmatically regardless
of what we do for the element sprites.

## Open questions

- **Sprite production for the final art.** Programmatic drawing
  is the placeholder. The two realistic candidates for finals
  are AI-generated raster sprites and refined programmatic
  vector art. We'll experiment with both before committing.
- **Rendering surface.** Canvas 2D, SVG, or DOM elements per
  cell. The choice interacts with the sprite question (vector
  sprites compose naturally with SVG; raster with canvas) and
  with particle work (canvas is the easier path for many small
  drifting points). Defer until we've prototyped.
- **Step shape and granularity for the animation timeline.** To
  be designed when the animation layer is built.
- **RNG and determinism.** The spec mandates a single seedable
  RNG instance for all gameplay-affecting rolls, exposed for
  tests (see `03-spawning.md`). The concrete library or
  implementation is not yet chosen.
- **On-disk project structure.** A concrete directory layout
  (e.g. `src/core/`, `src/store/`, `src/input/`, …) mirroring
  the layers in "Code organisation". To be decided alongside
  the first scaffolding commit.
- **Module dependency rule.** Core imports nothing from any
  other layer; the dependency graph points outward from core.
  Whether this is enforced by lint configuration or only by
  convention is not yet decided.

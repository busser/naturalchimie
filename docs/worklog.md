# Worklog

A running log of work done on the Naturalchimie clone. Newest entries
at the top.

## 2026-05-02 — Landed solo items on drop

With spawn able to put a dynamite or detonator into the active slot,
dropping one used to throw "solo items not yet implemented" and
freeze the loop. Added a `solo-land` step kind with a `landingRow`
payload and split `drop` over the active's kind. Detonator lands as
a `detonator` board cell at the lowest empty row in its column;
the spec's "piece lands on a detonator" trigger handles a *future*
piece falling onto it, not the detonator's own landing. Dynamite
plays the fall and vanishes — its blast belongs to the cascade
simulator, marked with a `TODO(busser)`. The driver sizes
`solo-land` at 50 ms/cell and the renderer animates the fall by
lerping from the spawn row to the landing row. The spawn step still
follows either kind of landing.

## 2026-05-02 — Unified renderer z-order across board and active

The playfield drew the board first, then drew the active piece on
top of everything. While a pair was at the spawn row that read
correctly — row 9 sits above any board cell — but during the fall a
descending half could be visually higher up the screen than a board
cell in a lower row, which by spec ("lower rows render in front")
should appear in front of it. Instead the falling pair was always on
top, then snapped behind on commit when its halves became board
cells.

Fix: collect board cells and active halves into one list, sort by
row descending, draw in that order. The transition through landing
is now continuous, and the per-active sub-sort is gone — the unified
sort handles it.

## 2026-05-02 — Wired up spawn

Added `src/core/spawn.ts` with `computePool(board)` and
`samplePiece(board, rng)` matching `03-spawning.md`: the pool is
`{1..min(11, max(2, highest_tier))}` derived from the board with no
stored state, the special-item kind roll only happens at ≥20 occupied
playfield cells, and weighted tier sampling uses `weight(t) =
max_tier - t + 1`. Tier 12 is excluded from the pool by the upper
clamp; the threshold counts the playfield only, not the overflow
rows.

`drop` in `apply.ts` now emits two steps: the existing `pair-land`,
then a new `spawn` step that promotes the preview to active (at
`SPAWN_COLUMN = 3`, horizontal for pairs) and draws a fresh preview
against the post-land board. The spec sequencing draws against the
post-cascade board; until cascades land that's the post-land board,
which composes correctly when the cascade simulator slots in between.
`pieceToActive` lives in `spawn.ts` and is shared with
`createInitialState`, which now draws both the initial active and
preview from the same code path.

`createStore` builds the initial state itself from the seeded RNG
rather than receiving it pre-built — the alternative would have been
two ways to fill the active/preview slots, and the spawn-flow code
path is the one source of truth. `main.ts` follows.

The `spawn` step's duration in the driver is still 0, so visually the
new pair pops in after the fall completes. The slide-from-preview
animation belongs to a later pass on the preview slot UI.

## 2026-05-02 — Animated the drop fall on ArrowDown

Wired `ArrowDown` to the core's `drop` input and gave the `pair-land`
step a real duration, so each half is visibly seen falling instead of
teleporting onto the board. The step now carries `firstLandingRow`
and `secondLandingRow`; the driver multiplies the larger of the two
fall distances by 50 ms/cell per `05-animations.md`. Per-half progress
in the renderer scales raw `t` by `maxDistance / ownDistance`, so when
one column is more occupied than the other the shorter half lands
early and waits at its target while the slower half finishes. Vertical
pairs need no orientation special-case: the spawn-area ±0.5 offsets
cancel against the row-apart landings, so both halves cover the same
total distance.

`SPAWN_ROW` moved out of the renderer into `core/state.ts`. The design
doc's "spawn row is rendering" framing was about not making it a state
field; as a shared constant alongside the `ActivePiece` type it lets
the driver size the fall without animation back-importing from
rendering.

Settle (squash and stretch on landing) and the cascade that should
follow a drop are still TODO. With no spawn yet, the playfield goes
idle after a single drop.

## 2026-05-02 — Landed the pair on drop

Replaced the `drop` stub in `applyInput` with the landing portion of
the drop sequence: each half of the active pair falls independently
to the lowest empty cell in its column, the active piece clears, and
a single `pair-land` step is emitted. For a vertical pair both
halves share a column, so placing `first` (bottom) before `second`
(top) lets the second call's "lowest empty" naturally resolve to the
row above the first — no special-case for orientation in the inner
loop. The board copy is shallow-per-row to keep the prior snapshot
intact, since the store and renderer still read it during the
animation.

The cascade that should follow a drop (reactions, between-step
gravity, scoring, lose check, preview→active spawn) is still
unimplemented and lives behind the cascade simulator. Solo items
(dynamite, detonator) still throw on drop because their post-land
behavior is reactions territory. The driver's `pair-land` duration
remains 0, so dropping snaps visually until the fall and settle
tweens land.

Tests cover empty-board horizontal and vertical drops, partially
filled columns (acceptance 1.3), asymmetric column heights
(acceptance 1.4), active clearing, prior-board immutability, and
RNG passthrough.

## 2026-05-02 — Sharpened sprite downscaling

Sprites looked pixelated on the playfield. The source PNGs are
1024×1536 with cell footprints around 400 px, scaled to a 48 px
cell (≈96 px on a HiDPI display) — roughly an 8× downscale. Canvas
2D `drawImage` defaults to low-quality bilinear smoothing, which
aliases badly at that ratio. Set `imageSmoothingQuality = 'high'`
in `setupCanvas` and the result is good enough by eye. Pre-baking
each sprite at load time via `createImageBitmap` with
`resizeQuality: 'high'` is held in reserve if a future asset or
cell size pushes the ratio further.

## 2026-05-02 — Implemented playable shift/rotate UI

Built the four runtime layers behind the active pair: bootstrap
(initial `State` factory), renderer (Canvas 2D playfield), store
(committed snapshot + RNG + step queue), animation driver
(`requestAnimationFrame`-driven, ticks the queue, commits on
completion), and input (keyboard → store dispatch with held-key
repeat). A single RAF loop in `main.ts` orders the per-frame work
as `driver.tick → keyboard.tick → renderer.draw`. Sky and chrome
are CSS; the playfield itself is a transparent canvas overlay.

For the shift tween, halves linearly lerp between from/to positions
in board coordinates. For rotation, both halves arc 90° CW around
the pair's midpoint, with the midpoint itself sliding linearly
between the prev and next geometric centers. The two centers
differ by half a cell whenever the rotation center sits on a column
boundary (the spawn position, and after every wall-kick), and the
sliding center is what lets halves land exactly on grid at t=1.

Z-order matches `04-visual-style.md`: lower rows render in front.
Active-piece halves are sorted by row descending each frame so the
order updates continuously as a rotation crosses, and `drawBoard`
iterates from highest row to lowest for the same reason. The first
draft had it backwards and produced a pop at the end of every
rotation, when the post-rotation V state's draw order swapped which
half was on top.

Held-key repeat works like the spec describes: a pressed key fires
once on `keydown`, and subsequent fires happen one per animation
cycle while the buffer and step queue are empty. The check is a
single `store.peekNextStep() === null`, which is true exactly when
both queues are drained — drainInputs runs lazily inside peek, so
a no-op input (e.g. shifting into a wall) doesn't sit in the buffer
and falsely signal "busy".

Animation timings landed at 150 ms shift / 200 ms rotate after
playtesting. Spec values (60 / 100) felt twitchy, the 200 / 350
values used while wiring repeat behavior felt sluggish; the spec
explicitly invites this kind of by-feel tuning.

## 2026-05-02 — Fixed rotation 2-cycle bug

Spotted while playing with the wired-up shift/rotate UI: rotating
twice returned the pair to its original state, instead of swapping
the two halves the way a real 90° rotation should. Tracking the
math down, the spec was internally inconsistent — H→V described
`right→top, left→bottom` (geometrically a 90° counter-clockwise
rotation) while V→H described `top→right, bottom→left` (90°
clockwise). The two halves cancelled each other into a 2-cycle
instead of the expected 4-cycle, and `apply.ts` was faithfully
following the spec text.

Fixed the H→V description in `01-gameplay-rules.md` to
`left→top, right→bottom`, so both halves now describe the same
90° CW rotation. In `apply.ts`, rotation swaps `first`/`second` on
H→V and preserves them on V→H. Identity returns at four rotations,
labels swap at two. Two tests updated to assert the swap; the
"sticky wall-kick" test gained a label-swap assertion as a
side-effect, since the kick path now also sees the swap.

## 2026-05-02 — Closed animation API and main-wiring open questions

Animation layer settled as a single `requestAnimationFrame` driver,
with hand-rolled tweens. No tween library: the surface is shift,
rotate, fall, fade, scale — a few `lerp` calls per kind. Per-step
Promises were the alternative and were rejected because they
scatter the "commit on completion, not start" rule across step
kinds, while a central driver concentrates it in one place.

Wiring follows the same shape: input dispatches to the store, the
store calls `applyInput` and queues steps without committing, the
driver pulls one step at a time and triggers the commit on
completion. The store therefore never advances `currentSnapshot`
itself — that is exclusively the driver's job, which keeps the
"commit on completion" guarantee load-bearing in a single place.

## 2026-04-27 — Implemented shift and rotate

Landed `src/core/apply.ts` with the unified entry point
`applyInput(state, input, rng) → [state', steps, rng']`. Shift
moves the anchor column by ±1 and rejects when any half would
leave columns 0–6 (= spec columns 1–7); rejection returns the
input state and zero steps so the input layer just drains the
buffer with no animation. Rotate flips orientation in place;
H→V always succeeds (the spec guarantees it fits), V→H wall-kicks
one column left when the right half would land past column 6.

Tests cover each rule from `01-gameplay-rules.md` plus two
non-obvious properties: rotation preserves first/second labels
(so identity survives 4× rotation), and the V→H wall-kick is
**sticky** — V at column 6 → H at column 5, rotating back gives
V at column 5, not 6. The kick is a real displacement, not a
transient nudge during the animation.

Drop is stubbed with a throw inside the dispatch — it'll land
alongside the cascade simulator. RNG passes through unchanged
for both shift and rotate (neither draws random numbers).

## 2026-04-27 — Stripped the row off the active piece

`ActivePiece` was carrying a 2D `Pos` for its anchor, but the row
never varied during the piece's lifetime: the spec pins spawn at a
fixed row, rules out soft drop and gravity timers
(`01-gameplay-rules.md:124-127`), and drop consumes the piece into
the board the same frame the player presses down. Shift only moves
horizontally; rotate flips orientation in place. The row was a
constant in disguise being threaded through every transition.

Replaced `anchor: Pos` with `column: number` on the pair, and the
two solo variants likewise. `Pos` stays for board-cell references
in step payloads. The spawn row becomes a rendering-layer constant
alongside the rest of the layout. Captured the rationale in a new
bullet under "State shape" in `08-software-design.md` so the choice
isn't re-derived later.

## 2026-04-27 — Built a board text DSL for tests

The scenarios in `06-acceptance-tests.md` are written as 7- or
9-row diagrams. Made that notation executable: added
`parseBoard` and `formatBoard` in `src/core/board-text.ts`,
matching the spec exactly so fixtures read like the spec. The
parser flips top-down diagrams to bottom-indexed `Board`; the
formatter is the inverse, emitting 7 rows by default and
bumping to 9 only when the overflow zone holds anything. `D`
(dynamite) is rejected — `Cell` doesn't model it, since
dynamite is only ever an active piece.

Followed with a Vitest custom matcher
`expect(board).toMatchBoard("…")`, registered in
`vitest.setup.ts` via `test.setupFiles`. On failure Vitest
renders a line-level diff in spec notation with the source
location pointing at the assertion. Originally parked as a
follow-up on the theory that the helper form
(`expect(formatBoard(a)).toBe(formatBoard(b))`) would suffice;
closed it immediately once the diff was confirmed clean enough
to skip the extra hop.

## 2026-04-27 — Closed the game-over open questions

Picked the terminal-step shape for the game-over signal: when a
cascade settles into a losing position the core appends a
`"game-over"` step whose snapshot carries the prior board forward
with `active: null`. The animation layer plays the
fade-and-overlay visual; once it completes the queue is empty,
and input is locked because there is no active pair to act on.
No flag on the snapshot — it would duplicate `active: null` plus
an empty queue, and the terminal step keeps the renderer's "draw
the current snapshot" path uniform.

Also closed the game-over UX gap. Most of the behavior was
already in `05-animations.md` (dim overlay, "Game Over" text,
"Press space to play again"); added the player's final score to
the screen and made the fresh-seed restart explicit. Considered
"any key" for the restart prompt but chose space specifically:
when game-over hits the player likely has a movement key held or
is mid-press, and any-key would restart instantly before they
read their score. Two open questions remain in
`08-software-design.md`: animation layer API and layer wiring in
`main.ts`.

## 2026-04-27 — Pinned down the concrete state shape

Closed the concrete-state-shape open question and landed
`src/core/state.ts`. `State` carries `board`, `active`,
`preview`, and `score`. `Cell` is a discriminated union with
`"empty"` as a member; `active` is plain `ActivePiece | null`
since absence has no fields and is mostly a guard. `Pair`
carries `first`/`second` labels alongside `anchor` and
`orientation` so rotation can preserve identity per the spec.
Step events are defined with their `kind` discriminators only;
payloads will land with the steps that produce them.

The score-in-state decision flipped during discussion: I'd
called it derivable from the board, but the spec rule "score
updates only on a stable board" makes it genuinely stateful —
mid-cascade snapshots carry the prior stable score forward
while the board changes underneath, so deriving from the
current board would produce a fluctuating number. Putting it
in core state also keeps the `3^(tier−1)` formula behind the
core boundary, so the renderer just reads a number. Documented
the rationale under a new "State shape" section in
`08-software-design.md`.

## 2026-04-26 — Placed the active pair in core state

Closed the active-pair open question in `08-software-design.md`:
the pair lives in core state alongside the board, not as
store-side presentation state. The unified core signature
`(state, input, rng) → (state', steps, rng')` was already
doing real work (every input produces a timeline covering its
full consequences), and option B — threading the pair in as
input — would have forked the signature per action just to
keep the core "purely about the board." With option A, shift
and rotate operate on `state.activePair`; drop consumes it
into board cells; cascades run on the board alone; "no pair
right now" (mid-cascade, post-game-over) is an honest core
state rather than implicit store coordination. Updated the
Store bullet, added a clarifying paragraph under "Logic and
animation sequencing," and changed the snapshot wording from
"of the board" to "of the game position." Also captured four
more open questions surfaced during the discussion: animation
layer API, concrete state shape, layer wiring in `main.ts`,
and game-over UX.

## 2026-04-26 — Settled coordinates and the spawn-pool model

Closed two more open questions in `08-software-design.md`.

Coordinate convention: in code, row 0 sits at the floor and
column 0 on the left, so `board[0][0]` is the bottom-left cell.
Gravity, "lowest empty cell," and overflow all read naturally
under this convention. The spec text's 1-indexed prose stays as
is for human readability; the +1 offset is a rendering-boundary
concern.

Spawn pool: the pool is now a pure function of the board,
`{1..min(11, max(2, highest_tier_on_board))}`, with no stored
mutable pool and no per-cascade update step. As a consequence
the pool can **shrink** if dynamite or a detonator destroys the
last instance of the current highest tier — intentional, and
thematically nice (the alchemist forgot the recipe). Updated
`03-spawning.md` to drop the monotonic-growth language, replace
`on_cascade_complete` with a `compute_pool(board)` helper, and
reframe the cascade-sequence note around the new model.

Two open questions remain: active pair in core state vs.
store-only, and the game-over signal shape.

## 2026-04-26 — Pinned down input buffering

Closed the input-handling open question. Inputs are buffered, but
only while an active pair exists — presses during cascades have no
pair to act on, so they're ignored. Within active-pair control,
each fresh `keydown` enqueues one action and the buffer drains one
per animation cycle, so rapid double-taps of rotate produce two
rotations even if the second press lands mid-animation. Drop
closes the buffer for that pair. Held keys are handled by ignoring
OS auto-repeat and rolling our own: when the pair is idle and the
buffer is empty, a held key fires one action per animation cycle.
Held-key state tracks hardware, not the pair, so a held `down` at
spawn time drops the new pair immediately.

## 2026-04-26 — Designed the step/playback model

Closed two of the three open questions in
`08-software-design.md`. The core's signature is now
`(state, input, rng) → (state', steps, rng')` for *every*
input — drop, shift, rotate alike — so the timeline always
covers the full consequence of an input rather than just the
post-drop cascade. Each step carries a kind discriminator, a
payload, and the post-step board snapshot: kind+payload feed
the animation layer, snapshot feeds the store and renderer.
State stays a pure board position with no animation concepts
leaking in. Concurrent effects (e.g. two disjoint matches from
one drop) live inside a single step. The store advances
`currentSnapshot` on each animation's *completion*, not start,
so the renderer never shows post-step results before the
visual transition has played. Input buffering during cascades
is still open.

## 2026-04-26 — Wired up ESLint and fixed the Vitest config types

Now that the first core module exists, added the ESLint
`no-restricted-imports` rule promised in `08-software-design.md`:
`src/core/**` is forbidden from importing any sibling layer
(`store`, `input`, `animation`, `renderer`, `assets`). Verified
the rule fires by inserting a forbidden import and watching it
fail. Also fixed a pre-existing typecheck error in
`vite.config.ts` by importing `defineConfig` from `vitest/config`
instead of `vite` + a triple-slash reference; the merged types
now recognise the `test` block and `npm run typecheck` is clean.

## 2026-04-26 — Picked an RNG and landed the first core module

Closed the RNG open question by going with a hand-rolled immutable
**Mulberry32** in `src/core/rng.ts`. The API is `createRng(seed)` →
`Rng`, `nextFloat(rng)` → `[value, nextRng]` — no mutation, so the
core can stay a pure function of `(state, input, rng)`. Considered
`pure-rand` and `seedrandom`; rejected the latter because its
mutable surface fights the pure-core design, and skipped the former
to avoid a dependency for ~10 lines of code. Tests cover seed
determinism, range, and immutability. Also added two new open
questions (step application during animation, input buffering
during cascades) that surfaced while reviewing the design.

## 2026-04-26 — Scaffolded the project

Set up Vite + TypeScript (strict) + Vitest, with a multi-page Vite
config so `tools/sprite-tool.html` is served alongside the runtime
entry at `index.html`. Moved sprites from the top-level `sprites/`
under `public/sprites/` so Vite serves them as-is at `/sprites/*`.
Migrated `src/sprite-renderer.js` to TypeScript at
`src/assets/sprite-renderer.ts`; the sprite tool's import path
follows. Documented the directory layout in `08-software-design.md`
and closed two of the four open questions (project structure
decided; module dependency rule will be enforced by ESLint when the
first core module lands). RNG library and animation step shape
remain open.

## 2026-04-26 — Chose the rendering surface

Settled on Canvas 2D for the playfield and particles, with HTML/CSS
for the chrome around it. Documented the decision in
`08-software-design.md` along with the resize strategy: recompute
`cell_size_px` on viewport changes, scale the bitmap by
`devicePixelRatio` for HiDPI sharpness, and cap the cell size at
the PNG-native resolution to avoid upscaling blur. Also recorded
that the final element art is PNG raster (not programmatic
placeholders), which closed two of the open questions.

## 2026-04-26 — Tuned sprite metadata

Used the live preview tool to author and tune the metadata files that
position each element sprite within its cell.

## 2026-04-26 — Built sprite metadata tool

Wrote a tool for editing sprite metadata with a live preview, so that
sprite framing (size, offset, anchor) can be adjusted by feel rather
than by guessing numbers.

## 2026-04-25 — Drew element sprites

Produced the initial set of sprites for the twelve elements of the
transmutation chain, in the hand-drawn cartoon style described in
`04-visual-style.md`. Some early designs were set aside; they live in
the abandoned-sprites directory for reference.

## 2026-04-25 — Wrote the spec

Drafted the full specification for a single round of the game, split
across `00-overview.md` through `08-software-design.md`. The spec
covers gameplay rules, elements, spawning, visual style, animations,
acceptance tests, sprite tooling, and software design.

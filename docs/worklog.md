# Worklog

A running log of work done on the Naturalchimie clone. Newest entries
at the top.

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

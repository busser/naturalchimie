# Worklog

A running log of work done on the Naturalchimie clone. Newest entries
at the top.

## 2026-05-03 — Animated cascade reactions and gravity

Cascades had been resolving instantly: merge and gravity steps both
committed in 0 ms, so a drop snapped through reactions without any
visual continuity. Added `src/renderer/effects.ts`, a module that
owns the cascade-stage visuals, and gave both step kinds real
durations in the driver. The playfield asks the module for an
`Effect` whenever a new merge or gravity step enters flight,
excludes the effect's `skipCells` from its normal board pass, and
calls `effect.draw` on top.

Gravity is the simple half. Each `Movement` lerps from `from` to
`to` with ease-in over `50 ms × maxFallDistance`, plus an 80 ms
inter-cascade pause padded onto the end of the step so the eye gets
a beat before the next reaction fires. The renderer reads the
source cell out of `prevSnapshot.board` and draws it at the
interpolated row; the `skipCells` set keeps the playfield's static
pass from also drawing it at its `from` position.

The merge took several iterations to land. The straight
white-bloom-then-orbs-converge approach from the spec played flat:
synchronized convergence read more like teleportation than
transformation. A second pass had each cell explode into a swarm of
sub-orbs that scattered with overshoot and snapped inward — kinetic
but visually busy.

The version that stuck is shaped around a clearer narrative. Each
cell shines (original sprite plus a growing white halo, like
filling with energy), then pops, releasing four bubbles of light.
Each bubble travels to the group's landing cell along a quadratic
Bezier curve with the control point pushed out in the bubble's
scatter direction, so the path bulges outward and curves back
inward. Per-bubble travel times are randomized in a 200–340 ms
window, so arrivals at landing stagger; a central orb at landing
grows in discrete bumps as each absorbed bubble registers, with a
brief pulse on each arrival. When the last bubble lands, the orb
swells over 70 ms and snaps off, revealing the new tier sprite at
full size.

Two implementation notes worth keeping. The bubble timing function
is a biphasic ease-out-in blended 70/30 with linear: the pure
biphasic curve (fast-out, slow-at-apex, fast-pull-in) has zero
velocity at the midpoint and reads as a freeze frame when the
bubble pauses at the arc apex, so the linear term keeps the apex
visibly slow without stopping. And the central orb's radius scales
with `sqrt(arrivedCount)` rather than linearly: a 3-cell merge has
12 bubbles, a 5-cell has 20, and linear growth blew the orb past
the size of a full cell before the pop.

## 2026-05-03 — Implemented reactions, gravity, and cascades

Until now elements just stacked. Dropping a piece landed it and
that was that — no merges, no chain reactions, no way to ever
reach tier 12. Added `src/core/cascade.ts` with a pure
`runCascade(board, priorState) → { board, steps }` that loops
react → gravity until the board is stable. Connected components
of size ≥ 3 of any tier 1–11 react simultaneously into a single
merge step (concurrent groups bundled, per the design doc rule);
gravity follows and is skipped entirely when nothing moves. Tier
12 is inert and never groups.

Wired it into `apply.ts`: drop now runs land → cascade → lose
check → score recompute → spawn. Two consequences fell out. The
lose check moved from the post-land board to the post-cascade
board, since a cascade can clear elements out of the overflow
zone — a fresh row-7 cell is no longer a guaranteed loss. And
score stitching had to learn about the cascade: every step
before the board settles carries the prior score, and only the
snapshot that lands on the stable board (last cascade step, or
pair-land if the cascade was a no-op) gets the recomputed value.
A small `stitchScore` helper does that placement.

Filled in payloads for the previously stubbed `merge` and
`gravity` step events. Merge carries an array of reacting
groups (cells, landing, tierBefore, tierAfter); gravity carries
per-cell movements. The animation driver already mapped both to
0 ms, and the renderer's active-piece switch falls through to
the committed snapshot, so cascades snap visually. Authoring
the merge and gravity visuals is the next layer of work.

Tests cover the five reaction acceptance scenarios (2.1–2.5)
plus targeted unit tests for `findReactingGroups` (L-shape,
plus-sign, disjoint groups, diagonal non-bridging, tier-12
inertness) and `applyGravity` (no-op detection, order
preservation, detonators falling like elements). The
existing lose-condition tests in `apply.test.ts` had been
written against a column of seven tier-5s, which the new
cascade detects as a reacting group and clears; switched them
to alternating tier-1 / tier-5 stacks that fill the column
without forming a reactive component.

## 2026-05-02 — Computed and displayed the score

The sidebar score has been pinned at 0 since the initial scaffolding.
Added `src/core/score.ts` with `computeScore(board)`: sum of
`3^(tier - 1)` over playfield cells (rows 0–6), excluding the
overflow zone, the active piece, and detonator cells (no tier).

`apply.ts`'s drop branch now sets `score: computeScore(board)` on the
pair-land snapshot in the non-lost path, and carries that value
through to the spawn snapshot. The pair-land snapshot is the first
commit on a stable board, so the score updates the instant the player
sees the piece come to rest. Game-over keeps the prior score per spec
("if the round did not end, the score is recomputed"). When the
cascade simulator lands, the same hook moves to the post-cascade
snapshot — same role, later trigger — but the score's only consumer
is the snapshot, so no other layers care.

Tests cover the formula directly (empty board, single tier-1, the
1.1 and 1.3 acceptance scenarios, the full 1–11 sum of 88573, gold
nugget at 3^11, detonator excluded) plus three drop-level cases:
`[1/2]` on empty scores 4, dropping into the two-tier-5 column scores
166, and a detonator drop leaves the score at zero.

## 2026-05-02 — Stopped buffered drops from leaking across pairs

Pressing down three times in quick succession — once with a pair on
the board, twice during the fall animation — auto-dropped the next
two pairs. The store was unconditionally enqueuing every fresh
keydown. While the first drop's steps drained from the step queue,
the trailing two drops sat in the input queue, then applied to the
next pairs as soon as their spawn steps committed.

Spec is explicit on this: `08-software-design.md` says drop closes the
buffer for the current pair, and inputs that arrive before the next
pair has spawned are ignored. Added an `acceptingInput` flag in the
store. It closes the moment a `drop` is dispatched (not when it
applies — the pair is committed from the player's perspective the
instant they press down) and reopens when a `spawn` step commits a
fresh active piece. Game-over runs end without a spawn step, so the
flag correctly stays closed; `restart` resets it from the new initial
state.

I considered gating dispatch on `committed.active !== null` instead.
It doesn't work: when the second drop is pressed during the fall
animation, the pair-land step hasn't committed yet, so `committed`
still shows the old pair active. Same problem if dispatch checked the
last queued step's snapshot — the spawn step is already queued, so
the future state shows the next pair active. The flag tracks the
intent (a drop has been issued) directly, which is what the spec
describes.

## 2026-05-02 — Animated the preview-to-active handoff

The `spawn` step had duration 0, so after a drop the preview piece
silently teleported into the spawn row. Gave the step a real duration
covering three strictly sequential phases (200 ms each, 600 ms total):
prev preview slides out of the recess, then the new active slides into
the spawn row, then the new preview slides into the recess. Per-phase
constants live in the driver so both renderers split `t` against the
same boundaries.

The first cut had the slide-out and slide-down running concurrently
(reflecting the spec's single 200 ms "piece travels from preview to
spawn" motion). It broke the illusion the spec calls for: with the
sidebar to the left of the playfield rather than below it, two copies
of the piece were on screen at once instead of one piece moving
between regions. Sequential phases — paired with the ease-in-out
boundary velocities providing a natural pause — read as one piece at
a time without an explicit gap.

Playfield: `state.active` is null on the post-land snapshot the spawn
step starts from, so the existing `state.active !== null` guard
skipped rendering during the slide-down. Pulled the active-piece
dispatch into its own helper that, on a spawn step, reads
`inflight.step.snapshot.active` and during phase 2 slides it from
row SPAWN_ROW + 3 (just above the topmost rendered row) down to the
spawn row. Phase 1 returns no halves; phase 3 returns the static halves.

Preview: now takes `getSnapshot` and `getInFlight` like the playfield
does. The canvas grew from 1.5 cells to a full 2 cells tall to match
the recess's 96 px height — at the prior size it was centered with
12 px of parchment above it, so a sliding piece vanished partway up
the recess instead of at its top edge. With the canvas filling the
recess the piece's slide ends exactly at the top edge. Top headroom
moved from 0.5 to 0.75 cells to keep the piece's visual rest position
unchanged (piece y = 36–84 px in either layout); the remaining 0.25
cells of bottom headroom is what's left.

## 2026-05-02 — Added the next-piece preview

The sidebar's preview recess was empty. Added `src/renderer/preview.ts`,
a tiny canvas-2D renderer that mirrors the playfield's setup
(`devicePixelRatio` scaling, `imageSmoothingQuality: 'high'`) and draws
`state.preview` via the shared `drawSpriteAtCell`. Pairs render in
horizontal orientation (matching how a fresh pair spawns); solo items
center in the slot. The renderer skips redraw when the `Piece` is the
same reference as last frame — `apply.ts` carries `state.preview`
through shifts and rotates by spread, and only swaps it on drop+spawn,
so reference equality is enough.

Sizing took two passes. First cut was a 1-cell-tall canvas at the
playfield's 48 px cell size; the cork tops clipped at the canvas
ceiling because sprites extrude upward beyond their cell footprint.
Adding a full row of headroom (2 cells tall) fixed the top but the
right side of each cork still clipped — the 30° tilt makes the cork
lean past the cell width to the right. Settled on 0.5 cells of
headroom on top and on each side: canvas is `(2 + 1) × 1.5` cells =
144 × 72 px at the same 48 px cell size as the playfield, so sprites
render at full scale. The recess stays at its original 96 px height,
giving 12 px of equal padding all around the canvas.

The slide-up-out / slide-down-in preview animation in
`05-animations.md` is still TODO. This pass is the static display
only.

## 2026-05-02 — Added the game-over UI

The core was emitting `game-over` steps but nothing in the UI
acknowledged it. Added a DOM overlay over the playfield: a dim
half-transparent layer plus a parchment-colored panel carrying
"Game Over", the final score, and "Press space to play again."
The panel matches the sidebar's parchment palette so the deep-brown
text reads cleanly. An earlier pass put the text directly on the
darkened sky and the contrast was poor.

`main.ts` derives the lose state from the snapshot (no flag on
`State`, per `08-software-design.md`): `active === null` plus a
non-empty cell in the overflow rows. When the frame loop sees the
state flip, it reveals the overlay and updates the score readout.
Space, listened for at the window, calls `store.restart(Date.now())`
and `driver.reset()` to clear in-flight tween state. The store's
new `restart(seed)` rebuilds initial state through
`createInitialState` and drops queued inputs and steps.

The overlay uses CSS opacity transition for the 600 ms fade-in.
Two details to make it not flash on first paint: the markup
ships with the `hidden` attribute so the UA stylesheet hides it
before Vite injects the CSS module, and `.game-over[hidden]`
overrides the `display: flex` rule so the attribute keeps winning.
On entering game-over, JS removes `hidden` and adds `is-visible`
on the next animation frame so the opacity transition still plays.

## 2026-05-02 — Implemented the lose condition in the core

Added the lose check to `applyInput`'s drop branch. After a piece
lands, the core scans the overflow zone (rows 7–8, the two rows
above the playfield); if any cell there is non-empty, it emits a
terminal `game-over` step in place of the usual `spawn`. The
game-over snapshot mirrors the post-land state — `active: null`,
preview unchanged, score unchanged — and the RNG is not advanced
because no fresh preview is drawn. Subsequent inputs are no-ops
because `applyInput` already short-circuits when `active === null`.

The check sits at the post-land board, which is the current
"stable" point. Once the cascade simulator lands, the same hook
moves to the end of the cascade — that's where the spec wants it
("on the stable board after a cascade"). For now there are no
reactions, so post-land is post-stable. Acceptance test 5.3
(reaction prevents loss) is therefore unreachable until cascades
exist; tests cover the post-land variants the current code can
produce: asymmetric overflow from a horizontal pair, top-half
overflow from a vertical pair, the just-fits non-loss boundary,
preview/RNG preservation on game-over, post-game-over input
lockout, and detonator overflow.

The `game-over` step has duration 0 in the driver. The fade
overlay described in `05-animations.md` belongs to a later pass.

## 2026-05-02 — Fixed asymmetric pair-fall speed

When a horizontal pair landed on columns of different heights, the
two halves visually obeyed different gravity: the shorter-fall half
was moving faster, not just finishing earlier. Tracked it down to
`landHalves` scaling raw `t` by `maxDistance / ownDistance` per
half, which stretched the shorter half's `easeIn` curve and made
its peak velocity higher.

Fix: share one eased progress across both halves and convert it to
cells-fallen, then derive each half's progress from
`cellsFallen / ownDistance` clamped to 1. Same gravity for both;
the shorter one just clamps to its target sooner. Vertical pairs
were unaffected because both halves cover the same total distance
(the ±0.5 spawn offsets cancel against the row-apart landings).

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

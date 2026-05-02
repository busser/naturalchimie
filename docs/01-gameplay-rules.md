# Gameplay Rules

This file describes the rules of a single round, independent of how
elements are drawn from the spawn pool (see `03-spawning.md`) and
independent of presentation (see `04-visual-style.md` and
`05-animations.md`).

## Grid

The playfield is **7 columns wide and 7 rows tall**. Columns are
indexed 1 to 7 from left to right. Rows are indexed 1 to 7 from
bottom to top — that is, **row 1 is the floor**, row 7 is the top
visible row.

Above row 7 is an **overflow zone** of two extra rows, indexed 8
and 9. Elements may briefly occupy rows 8 and 9 during play; the
lose condition (defined below) is checked only when the board is
stable.

Above the overflow zone is the **spawn area**, occupying rows 10
and 11. The spawn area is where the active pair appears before the
player begins maneuvering it. Elements in the spawn area never
interact with the playfield: they are not subject to gravity, they
do not cause reactions, and they cannot cause a loss.

A **cell** is a position `(column, row)`. A cell either contains
exactly one element or is empty.

## The active pair

At any point during play, the player controls one **active pair**
or one **active solo item** (dynamite or detonator; see
`02-elements.md`). For brevity, this section uses "pair" to mean
"active piece," whether it is a pair of elements or a solo item.

A pair has two elements, each occupying its own cell. A pair has
one of two **orientations**:

- **Horizontal** — the two cells are in the same row, in adjacent
  columns. The pair has a "left element" and a "right element."
- **Vertical** — the two cells are in the same column, in adjacent
  rows. The pair has a "bottom element" and a "top element."

When a new pair appears, it spawns in the spawn area in a fixed
position: **horizontal**, occupying row 10, columns 4 and 5. This
is the same position the pair occupied in the preview window in
the sidebar, so the pair appears to slide upward out of the
preview and into the spawn area without changing orientation.

The pair has a **rotation center**, which is the geometric
midpoint between the two element cells:

- For a horizontal pair, the rotation center is on the row of the
  pair, at the column boundary between its two cells (e.g., for
  the spawn position, the center is at column 4.5, row 10).
- For a vertical pair, the rotation center is on the column of
  the pair, at the row boundary between its two cells.

After a clockwise rotation from horizontal to vertical, the pair
sits at **half-row offsets** so that the rotation center stays at
the same point during the rotation: one element renders at row
9.5 and the other at row 10.5, both in the same column. The
half-row positioning is a property of the visual rendering during
the spawn-area phase only; for the purposes of dropping, each
element is logically associated with its integer column, and on
drop each half falls to the lowest empty cell (an integer row) in
that column.

A solo item (dynamite or detonator; see `02-elements.md`) spawns
at column 4, row 10. Solo items have no orientation and no
rotation center.

Pairs always spawn horizontal regardless of the orientation in
which the previous pair was dropped. Rotation state does not
carry between pairs.

## Controls

The game is keyboard-only. Four keys:

| Key | Action |
|---|---|
| ← (Left arrow) | Move the active pair one column to the left. |
| → (Right arrow) | Move the active pair one column to the right. |
| ↑ (Up arrow) | Rotate the active pair 90° clockwise. |
| ↓ (Down arrow) | Drop the active pair. |

Movement is grid-snapped: each key press shifts by exactly one
column. A move is rejected (no-op) if it would push any part of the
pair outside the grid horizontally — that is, columns 0 or 8.

Rotation is **clockwise around the pair's rotation center**, the
geometric midpoint between the two elements. Both elements move
during a rotation; neither serves as a fixed pivot.

After one rotation step:

- A horizontal pair becomes vertical. The element that was on the
  **left** ends up on the **top** (at row offset +0.5 above the
  center). The element that was on the **right** ends up on the
  **bottom** (at row offset −0.5 below the center). Both end up
  in the same column — the column of the rotation center, which
  for the spawn position is column 4 (rounded down from the
  horizontal pair's center column of 4.5; this rounding is the
  rule used whenever the rotation center sits on a column
  boundary).
- A vertical pair becomes horizontal. The element that was on the
  **top** ends up on the **right** (at column offset +0.5 right
  of the center). The element that was on the **bottom** ends up
  on the **left** (at column offset −0.5 left of the center).

Four consecutive rotations restore the pair's original
configuration. Two consecutive rotations swap which element is
the "first" of the pair: a horizontal pair `[A][B]` rotates
through `V[bottom=B, top=A]`, then back to `H[B][A]`, then
`V[bottom=A, top=B]`, then back to `H[A][B]`.

If a vertical-to-horizontal rotation would push the right element
past column 7, the pair is **wall-kicked** one column to the
left. (No other wall-kick situation exists, because horizontal
pairs always fit when rotated to vertical, and the spawn area
extends well above any vertical clamp.)

Rotation has no effect on a solo item.

The down arrow drops the pair. Each of the pair's two cells
falls straight down (independently, in its own column) to the
lowest empty cell in that column. The fall is animated; see
`05-animations.md` for the specific timing. The "drop" action
commits the pair from a single key press — there is no soft drop,
no held-down acceleration, and no continuous gravity timer
between drops. The player has no input over the trajectory once
the drop is initiated.

After a drop, reactions are checked, the cascade resolves (see
below), and the next pair is brought from the preview into play.

## No time pressure

There is no fall timer. The pair stays in the spawn area until the
player drops it. The player may take as long as they like between
moves, including walking away from the keyboard. A round only
progresses when the player presses keys.

## Reactions

A **reaction** consumes three or more orthogonally-connected
same-tier elements and produces one element of the next tier in
their place.

### Connectivity

Two cells are **orthogonally adjacent** when they share an edge:
up, down, left, or right. Diagonal cells are not adjacent.

A **connected component** is a maximal set of cells where every
cell holds an element of the same tier and every cell is reachable
from every other cell through a chain of orthogonally-adjacent
same-tier cells. Connected components include any shape: lines,
L-shapes, T-shapes, plus signs, blobs.

### Trigger

A reaction occurs when, after the active pair is dropped (or after
a previous reaction resolves and gravity has compacted the
columns), there is at least one connected component of size 3 or
greater consisting of elements of any single tier from 1 through
**11**. The gold nugget (tier 12) is **inert**: it does not react.
A connected component of three or more gold nuggets is a stable
configuration that does nothing.

### Resolution

When the cascade reaches a step where reactions exist, **all**
reactions at that step resolve simultaneously. The procedure is:

1. Find every connected component of same-tier elements with size
   ≥ 3 (excluding tier 12). Call these the **reacting groups**.
2. For each reacting group, determine its **landing cell**: the
   cell within the group with the **lowest row index** (i.e.,
   closest to the floor); among ties, the cell with the **lowest
   column index** (i.e., closest to the left wall).
3. Clear every cell of every reacting group simultaneously.
4. In each landing cell, place a single element of tier `n + 1`,
   where `n` is the tier of the elements that reacted.

After step 4, gravity acts (next subsection), and the cascade then
loops: another search for reacting groups, another simultaneous
resolution, and so on.

If two reacting groups happen to share a landing cell after
displacement (this cannot occur since groups are disjoint by
construction, but stated for completeness), it is a programming
error.

## Gravity

After every reaction step, **per-column gravity** is applied. For
each column independently:

1. Read the column from row 1 (floor) upward, collecting all
   non-empty cells in order.
2. Place the collected elements into the same column starting from
   row 1, contiguously, then leave the remaining rows empty.

Gravity preserves the relative vertical order of elements within a
column.

Gravity also acts immediately after the active pair is dropped (in
case the two halves of a pair land in different columns and one
half is suspended above an empty cell). Concretely, the drop
procedure is: move both cells of the pair to their respective
column-low positions independently, then check for reactions.
Because each cell is placed at its column's lowest empty cell at
drop time, no further gravity is needed *between* the drop and the
first reaction check; gravity only matters between reaction steps.

## Cascade

A **cascade** is the full chain of `react → gravity → react → ...`
that follows a drop. The cascade ends when no reacting groups
exist. Once the cascade ends, the board is **stable**, and the
following happens, in this order:

1. The lose condition is checked (next subsection).
2. If the round did not end, the score is recomputed (see
   "Scoring" below).
3. The piece that has been visible in the preview window
   throughout the cascade slides upward out of the preview window
   and into the spawn area, becoming the new active piece.
4. After a brief gap, a freshly generated piece slides downward
   into the now-empty preview window from above.

During the cascade itself, the preview window continues to show
the next piece (the one that was generated when the previous
active pair was committed). The preview window is **not** empty
during the cascade; it is empty only briefly, between the moment
the next piece slides out of it (after the cascade ends) and the
moment a freshly generated piece slides in.

## Lose condition

The round ends in a loss if, **on the stable board after a
cascade**, any cell in row 8 or row 9 holds an element. While the
cascade is in progress, elements may freely occupy rows 8 and 9 —
this is normal and expected, since the player may drop a pair into
a column that is already nearly full. Only the final stable
configuration matters.

There is no win condition. The player plays until they lose.

## Scoring

The score is a non-negative integer. The score is recomputed
**only on a stable board**, using this formula:

```
score = sum over all elements currently on the playfield of 3^(tier − 1)
```

That is:

| Tier | Element | Value |
|---|---|---|
| 1 | green potion | 1 |
| 2 | yellow potion | 3 |
| 3 | orange potion | 9 |
| 4 | purple potion | 27 |
| 5 | wheat | 81 |
| 6 | chocapic | 243 |
| 7 | apple | 729 |
| 8 | eyeball | 2,187 |
| 9 | bone | 6,561 |
| 10 | crystal | 19,683 |
| 11 | ore | 59,049 |
| 12 | gold nugget | 177,147 |

Notes on this formula:

- A reaction of exactly 3 same-tier elements is **score-neutral**:
  3 × 3^(n−1) = 3^n = the value of the resulting tier-(n+1) element.
- A reaction of 4 or more elements **decreases** the score: the
  consumed total exceeds the produced single element.
- Elements destroyed by dynamite or detonator are simply gone, so
  the recomputed score is lower by the value those elements
  contributed.
- Score is computed only on the playfield (rows 1–7). Anything in
  the overflow zone or spawn area is excluded — though by the time
  scoring runs, the board is stable and rows 8 and 9 are
  guaranteed empty.

The score is displayed in the sidebar (see `04-visual-style.md`).
The displayed score updates only when the board becomes stable. It
does not animate or fluctuate during cascades.

## Preview

A **preview window** in the sidebar always shows the next piece
the player will receive *after* the current active piece is
consumed. The next piece is generated at the moment the previous
active piece is committed (i.e., right after the previous drop
resolves and slides out of the preview).

State of the preview at each phase:

- **During player input** (the active pair is in the spawn area
  and the player is moving/rotating it): preview shows the next
  piece, statically.
- **During the cascade** (from the moment the active pair is
  dropped until the board becomes stable): preview continues to
  show the next piece, statically. It is **not** empty during the
  cascade.
- **At the end of the cascade**, the next piece slides upward out
  of the preview and into the spawn area, becoming the new active
  piece. The preview is briefly empty, and then a freshly
  generated piece slides down into it from above.

The preview's visual transitions (slide-in, slide-out) are
described in `05-animations.md`.

The preview also shows solo items when one is queued: a single
dynamite stick or a single detonator occupies the preview window
the same way a pair does.

## Drop sequence summary

For a complete drop, the order of operations is:

1. Player presses the down arrow.
2. Each cell of the active pair falls (animated, per the timing
   in `05-animations.md`) to the lowest empty row in its
   respective column.
3. The merge and cascade animations begin (see `05-animations.md`).
   Reactions are detected, animated, and resolved; gravity is
   applied; the loop repeats until stable.
4. The lose condition is checked.
5. If still alive, the score is recomputed and the displayed score
   updates.
6. The active pair is replaced by the preview piece, and a new
   piece is generated and placed in the preview.
7. Player input resumes.

Steps 2–6 are atomic from the player's perspective: input is
ignored during the cascade. The player cannot skip or speed up the
cascade animation.

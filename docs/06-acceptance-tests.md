# Acceptance Tests

This file lists concrete scenarios that an implementation must
satisfy. Each scenario is a deterministic input-output pair
suitable for translating into an automated test. The scenarios are
written in a notation defined below.

These tests cover **gameplay logic only**: grid state transitions,
scoring, spawn-pool growth, and lose conditions. They do not cover
visual presentation or animation timing.

## Notation

A grid state is written as 7 rows, top to bottom (i.e., row 7
first, row 1 last), with columns 1 through 7 left to right. Each
cell contains a token:

- `.` — empty
- `1`–`9` — element of tier 1–9
- `A`, `B`, `C` — element of tier 10, 11, 12 (crystal, ore, gold)
- `D` — dynamite
- `E` — detonator (the box; the plunger has no separate token)

Example: a board with a single yellow potion at column 4, row 1:

```
. . . . . . .
. . . . . . .
. . . . . . .
. . . . . . .
. . . . . . .
. . . . . . .
. . . 2 . . .
```

The active pair is described separately as `[left/right]` for
horizontal or `[top/bottom]` for vertical, with a column. Example:
`horizontal pair [3/3] at column 4` means tier 3 in column 4, tier
3 in column 5; pair will land in those columns when dropped.

Spawn pool is written as a set: `pool = {1, 2, 3}`.

## Section 1 — Drop and gravity

### 1.1 — Empty-board drop, horizontal pair

**Initial state:** empty board.
**Action:** drop horizontal pair `[1/2]` at column 4.
**Final state:**

```
. . . . . . .
. . . . . . .
. . . . . . .
. . . . . . .
. . . . . . .
. . . . . . .
. . . 1 2 . .
```

Pool unchanged. Score = 1 + 3 = 4.

### 1.2 — Empty-board drop, vertical pair

**Initial state:** empty board.
**Action:** drop vertical pair (top=1, bottom=2) at column 4.
**Final state:**

```
. . . . . . .
. . . . . . .
. . . . . . .
. . . . . . .
. . . . . . .
. . . 1 . . .
. . . 2 . . .
```

Pool unchanged. Score = 1 + 3 = 4.

### 1.3 — Drop into partially filled column

**Initial state:**

```
. . . . . . .
. . . . . . .
. . . . . . .
. . . . . . .
. . . . . . .
. . . 5 . . .
. . . 5 . . .
```

**Action:** drop vertical pair (top=1, bottom=2) at column 4.
**Final state:**

```
. . . . . . .
. . . . . . .
. . . . . . .
. . . 1 . . .
. . . 2 . . .
. . . 5 . . .
. . . 5 . . .
```

Pool unchanged. Score = 1 + 3 + 81 + 81 = 166.

### 1.4 — Horizontal pair lands with each cell at different row

**Initial state:**

```
. . . . . . .
. . . . . . .
. . . . . . .
. . . . . . .
. . . . . . .
. . . 5 . . .
. . . 5 5 . .
```

**Action:** drop horizontal pair `[1/2]` at column 4.
**Final state:**

```
. . . . . . .
. . . . . . .
. . . . . . .
. . . . . . .
. . . 1 . . .
. . . 5 . . .
. . . 5 5 2 .
```

The two halves of the pair fall independently to their respective
columns' lowest empty cell. The tier-1 element lands in column 4
on top of the existing column 4 stack; the tier-2 element falls
all the way to row 1 of column 5.

<note>This is wrong. The tier-2 element is on column 6 in the diagram. It should
be on column 5, on top of the tier-5 element already there, so on row 2.</note>

## Section 2 — Reactions and cascades

### 2.1 — Simple 3-element line reaction

**Initial state:**

```
. . . . . . .
. . . . . . .
. . . . . . .
. . . . . . .
. . . . . . .
. . . . . . .
. 1 1 . . . .
```

**Action:** drop horizontal pair `[1/3]` at column 3 (left=1 in
column 3, right=3 in column 4).
**Intermediate state after drop, before reactions:**

```
. . . . . . .
. . . . . . .
. . . . . . .
. . . . . . .
. . . . . . .
. . . . . . .
. 1 1 1 3 . .
```

A connected component of three tier-1 elements at row 1, columns
2–4 reacts. Landing cell = bottom-most, then left-most = (col 2,
row 1).

**Final state:**

```
. . . . . . .
. . . . . . .
. . . . . . .
. . . . . . .
. . . . . . .
. . . . . . .
. 2 . . 3 . .
```

Pool gains tier 2 (already present) and tier 3 (newly produced if
not already there). Score = 3 + 9 = 12.

### 2.2 — L-shaped reaction

**Initial state:**

```
. . . . . . .
. . . . . . .
. . . . . . .
. . . . . . .
. . . . . . .
. 1 . . . . .
. 1 1 . . . .
```

**Action:** drop horizontal pair `[5/5]` at column 5.
**Intermediate state after drop:**

```
. . . . . . .
. . . . . . .
. . . . . . .
. . . . . . .
. . . . . . .
. 1 . . . . .
. 1 1 . 5 5 .
```

The three tier-1 elements form an L of size 3 (orthogonally
connected). They react. Landing cell = bottom-most, then left-most.
The bottom-most row of the group is row 1 (occupied at columns 2
and 3); the left-most of those is column 2. Result: a tier-2
element at (col 2, row 1).

**Final state:**

```
. . . . . . .
. . . . . . .
. . . . . . .
. . . . . . .
. . . . . . .
. . . . . . .
. 2 . . 5 5 .
```

Pool: tier 2 (already present) confirmed. Score = 3 + 81 + 81 =
165. (The tier-1 elements that reacted no longer contribute.)

<note>This one is strange. While the reaction is correct, the initial state is
not stable. The 3 tier-1 elements should have reacted before the player had the
opportunity to drop the active pair.</note>

### 2.3 — 4-element merge (size > 3)

**Initial state:**

```
. . . . . . .
. . . . . . .
. . . . . . .
. . . . . . .
. . . . . . .
. . . 2 . . .
1 1 . 1 . . .
```

**Action:** drop vertical pair (top=2, bottom=1) at column 3.
**After drop (before reactions):**

```
. . . . . . .
. . . . . . .
. . . . . . .
. . . . . . .
. . . . . . .
. . 2 2 . . .
1 1 1 1 . . .
```

The tier-1 group at row 1, columns 1–4 has size 4. A connected
component of size ≥ 3 reacts. Landing cell = bottom-most, then
left-most = (col 1, row 1).

**After reaction:**

```
. . . . . . .
. . . . . . .
. . . . . . .
. . . . . . .
. . . . . . .
. . 2 2 . . .
2 . . . . . .
```

Gravity runs. Column 3's tier-2 at row 2 falls to row 1; column
4's tier-2 at row 2 falls to row 1.

**After gravity:**

```
. . . . . . .
. . . . . . .
. . . . . . .
. . . . . . .
. . . . . . .
. . . . . . .
2 . 2 2 . . .
```

The tier-2 element at column 1 is isolated (column 2 is empty).
The tier-2 group at columns 3–4 has size 2 — not enough to react.
Cascade ends.

**Final state:**

```
. . . . . . .
. . . . . . .
. . . . . . .
. . . . . . .
. . . . . . .
. . . . . . .
2 . 2 2 . . .
```

Pool: tier 2 (already present). Score = 3 + 3 + 3 = 9.

### 2.4 — Genuine two-step cascade

**Initial state:**

```
. . . . . . .
. . . . . . .
. . . . . . .
. . . . . . .
. . . 2 . . .
. . . 1 . . .
. 1 . 1 . . .
```

**Action:** drop vertical pair (top=2, bottom=1) at column 3.

Column 4 already has a tier-1 at row 1, so the bottom of the pair
lands at row 2 and the top at row 3.

**After drop (before reactions):**

```
. . . . . . .
. . . . . . .
. . . . . . .
. . . . . . .
. . . 2 . . .
. . 2 1 . . .
. 1 1 1 . . .
```

**Reaction step 1.** The tier-1 group spans (col 2, row 1),
(col 3, row 1), (col 4, row 1), (col 4, row 2) — orthogonally
connected, size 4. Landing cell = bottom-most, then left-most =
(col 2, row 1). The reaction places a tier-2 there.

**After reaction step 1, before gravity:**

```
. . . . . . .
. . . . . . .
. . . . . . .
. . . . . . .
. . . 2 . . .
. . 2 . . . .
. 2 . . . . .
```

**Gravity.** Column 3's tier-2 at row 2 falls to row 1. Column 4's
tier-2 at row 3 falls to row 1.

**After gravity:**

```
. . . . . . .
. . . . . . .
. . . . . . .
. . . . . . .
. . . . . . .
. . . . . . .
. 2 2 2 . . .
```

**Reaction step 2.** Tier-2 group at row 1, columns 2–4 — size 3.
Landing cell = (col 2, row 1). Result: tier-3 at (col 2, row 1).
Gravity is a no-op. No more reactions.

**Final state:**

```
. . . . . . .
. . . . . . .
. . . . . . .
. . . . . . .
. . . . . . .
. . . . . . .
. 3 . . . . .
```

Pool: tier 2 (already present), tier 3 (newly added during this
cascade). Score = 9.

### 2.5 — Score-reducing 4-element merge

**Initial state:**

```
. . . . . . .
. . . . . . .
. . . . . . .
. . . . . . .
. . . . . . .
. . . . . . .
2 2 . 2 . . .
```

(Score before drop = 9.)

**Action:** drop horizontal pair `[2/3]` at column 3.
**After drop:**

```
. . . . . . .
. . . . . . .
. . . . . . .
. . . . . . .
. . . . . . .
. . . 3 . . .
2 2 2 2 . . .
```

Reaction: tier-2 group at columns 1–4, size 4, reacts. Landing
cell = (col 1, row 1).

**After reaction:**

```
. . . . . . .
. . . . . . .
. . . . . . .
. . . . . . .
. . . . . . .
. . . . . . .
3 . . 3 . . .
```

No more reactions (the two tier-3 cells aren't adjacent).

**Final state:**

```
. . . . . . .
. . . . . . .
. . . . . . .
. . . . . . .
. . . . . . .
. . . . . . .
3 . . 3 . . .
```

Score before drop = 9. Score after = 9 + 9 = 18.

**Score check:** the 4-merge consumed 4 × 3 = 12 points worth of
tier-2, produced 9 points of tier-3 — a net **loss of 3** within
the merge. But the drop also added a tier-2 (3 pts) and tier-3 (9
pts) to the board. Net change from the action: dropped 3 + 9 = 12
points worth of new pieces; merged away 4 × 3 = 12 points; gained
9 points from the new tier-3.

Pre-drop board: 3 × tier-2 = 9. Post-drop board: 2 × tier-3 = 18.
Net score increase: +9. The 4-merge produced *less* gain than it
would have if the merge had been a clean 3-merge with the new
tier-2 going elsewhere.

This test confirms that 4-merges reduce score relative to what a
3-merge would have given.

## Section 3 — Special items

### 3.1 — Dynamite clears its column

**Initial state:**

```
. . . . . . .
. . . . . . .
. . . . . . .
. . 5 . . . .
. . 4 . . . .
. . 3 . . . .
. . 2 . . . .
```

**Action:** drop dynamite at column 3.

The dynamite falls to the lowest empty cell in column 3 — which is
row 5 (since rows 1–4 are filled). Dynamite explodes downward,
clearing rows 5 down to 1 in column 3. The dynamite itself is
consumed.

**Final state:**

```
. . . . . . .
. . . . . . .
. . . . . . .
. . . . . . .
. . . . . . .
. . . . . . .
. . . . . . .
```

Empty column 3 means no other column was affected. No reactions.

Score before: 81 + 27 + 9 + 3 = 120. Score after: 0.

### 3.2 — Detonator triggered immediately by next drop

**Initial state:** empty board.

**Action 1:** drop detonator at column 4. Detonator lands at (col
4, row 1). Nothing else happens. Board:

```
. . . . . . .
. . . . . . .
. . . . . . .
. . . . . . .
. . . . . . .
. . . . . . .
. . . E . . .
```

**Action 2:** drop horizontal pair `[5/5]` at column 4.

The pair's left-half (tier 5) falls into column 4. Lowest empty
cell of column 4 is row 2 (row 1 is occupied by the detonator).
The pair's right-half (tier 5) falls into column 5, which is
empty, so it lands at row 1.

After drop, before detonation check:

```
. . . . . . .
. . . . . . .
. . . . . . .
. . . . . . .
. . . . . . .
. . . 5 . . .
. . . E 5 . .
```

The tier-5 element at (col 4, row 2) is directly above the
detonator. The detonator triggers. The Moore neighborhood of the
detonator at (col 4, row 1) consists of { (3,1), (5,1), (3,2),
(4,2), (5,2) } — five cells, since row 0 is out of bounds — plus
the detonator's own cell (4,1). Total: 6 cells cleared. The cells
at (col 3, row 1) and (col 3, row 2) are empty already; the rest
contain the detonator, the trigger element, and the pair's
right-half.

After detonation:

```
. . . . . . .
. . . . . . .
. . . . . . .
. . . . . . .
. . . . . . .
. . . . . . .
. . . . . . .
```

Both halves of the pair are destroyed. Score = 0.

### 3.3 — Detonator chain

**Initial state:**

```
. . . . . . .
. . . . . . .
. . . . . . .
. . . . . . .
. . . . . . .
. . . . . . .
. . E . E . .
```

**Action:** drop horizontal pair `[1/1]` at column 3.

The left-half lands at column 3, lowest empty row above the
detonator, which is row 2. The right-half lands at column 4, row 1
(empty column).

After drop:

```
. . . . . . .
. . . . . . .
. . . . . . .
. . . . . . .
. . . . . . .
. . 1 . . . .
. . E 1 E . .
```

The element at (col 3, row 2) triggers the detonator at (col 3,
row 1). Detonation clears the 3×3 around (col 3, row 1):
{ (2,1), (2,2), (3,1) [detonator], (3,2) [trigger], (4,1)
[the right-half of the pair], (4,2) }.

After this detonation:

```
. . . . . . .
. . . . . . .
. . . . . . .
. . . . . . .
. . . . . . .
. . . . . . .
. . . . E . .
```

The right-half of the pair, which was at (col 4, row 1), is now
gone. The second detonator at (col 5, row 1) was *not* in the
neighborhood of the first (its column is 5, the cleared columns
were 2–4). So it remains.

Gravity runs (no-op — nothing is suspended).

No reactions (no same-tier groups).

The cascade ends.

**Final state:**

```
. . . . . . .
. . . . . . .
. . . . . . .
. . . . . . .
. . . . . . .
. . . . . . .
. . . . E . .
```

Score = 0.

## Section 4 — Spawn pool growth

### 4.1 — Initial pool

At the start of a fresh round, the spawn pool is exactly `{1, 2}`.
The first 100 generated elements (pairs only — no special-item
substitutions while board is empty) must all be tier 1 or tier 2.

### 4.2 — Pool grows on production

Starting from a fresh round, simulate enough drops (with a fixed
RNG seed) to produce a tier-3 element. Verify that immediately
*after* the cascade in which the tier-3 was produced, the pool
contains `{1, 2, 3}`. Verify that the *next* spawned pair (i.e.
the pair drawn for the preview after the producing drop) may
contain a tier-3 element.

### 4.3 — Pool growth from a deep cascade

Construct a board state where dropping a single pair causes a
3-step cascade producing tier-3 then tier-4 then tier-5 (e.g. via
a stack of pre-arranged tier-2s). Verify that after the cascade
ends, the pool contains `{1, 2, 3, 4, 5}` — all intermediate
tiers, not just the final one.

### 4.4 — Tier 12 never enters the pool

Construct a board state where dropping a pair causes a tier-11
group to react (producing a gold nugget). Verify that after the
cascade, the pool does **not** contain tier 12.

## Section 5 — Lose condition

### 5.1 — Overflow during cascade is not a loss

**Initial state:** a board where one column has 7 elements stacked
exactly (full to row 7), and another column is empty.

**Action:** drop a vertical pair at the empty column. Verify that
mid-drop, the spawn-area position briefly contains the pair at
rows 10/11, but on the final stable board the pair has fallen to
rows 1–2 of the empty column. No loss.

### 5.2 — Stable board with element in row 8 is a loss

Construct a state where the player's drop causes a column to
overflow — for example, a column already has 7 elements and the
player drops a pair into it. Even after gravity (no-op for a full
column), one element of the pair ends up in row 8.

Verify the round ends and the game-over state is entered.

### 5.3 — Reaction prevents loss

Construct a state where the player's drop *initially* puts an
element in row 8, but the resulting reaction clears enough of the
column to bring everything below row 8 by the time the cascade
stabilizes.

Example: column 4 has 7 tier-1 elements stacked, rows 1–7. Player
drops vertical pair (bottom=1, top=2) at column 4. Bottom (tier
1) lands at row 8; top (tier 2) at row 9. The 8 connected tier-1s
(rows 1–8) react: size 8, single connected component. Landing
cell = (col 4, row 1). After reaction: row 1 has tier 2, rows 2–8
empty, row 9 has the original tier-2 from the pair top.

<note>This is a strange example, because a column of 7 tier-1 elements is not
stable. Consider making it a column of 5 inert tier-12 elements with 2 tier-1
elements on top.</note>

Gravity runs: the tier-2 at row 9 falls to row 2 (above the new
tier-2 at row 1). That gives two tier-2 elements at rows 1 and 2 of
column 4 — connected, size 2, no reaction.

Final stable board: column 4 has tier 2 at rows 1 and 2, all
other cells empty. Rows 8 and 9 are empty. **No loss.**

This test confirms the lose-condition is checked only on the
stable post-cascade board.

## Section 6 — Score recomputation

### 6.1 — Score reflects only stable board

The score should never be observable in an "intermediate" state.
Implementations that update the displayed score during a cascade
fail this test.

The test: instrument the implementation to expose the score value
on every state change. Run a drop that causes a 3-step cascade.
Verify the displayed score remains at its pre-drop value until the
cascade fully stabilizes, then snaps to the new value in a single
update.

(This is a presentation test as much as a logic test, but it
catches a common implementation bug.)

### 6.2 — Score formula

Construct a board with one of each tier 1–11 plus zero gold
nuggets (any arrangement that does not trigger reactions, e.g. all
in different columns or separated by other tiers).

Pre-computed sum: 1 + 3 + 9 + 27 + 81 + 243 + 729 + 2187 + 6561 +
19683 + 59049 = **88573**.

Verify that the displayed score equals 88573.

### 6.3 — Empty board is zero

After the very first frame of a round, with no pieces yet
dropped, the score is 0. Trivial but worth pinning.

## Section 7 — Determinism

### 7.1 — Same seed reproduces the same sequence

Set the RNG seed to a known value. Simulate 50 spawns with a
specific automated input sequence (e.g. always drop horizontal at
column 4). Record the sequence of generated pairs and special
items. Repeat with the same seed. The two recorded sequences must
be identical, value-for-value.

### 7.2 — Different seeds give different sequences

Set seed to A, simulate as above. Set seed to B (B ≠ A), simulate
the same input sequence. The two recorded sequences must differ
within the first 10 spawns. (This is a probabilistic check; with
two well-distinguished seeds and a healthy RNG it should
essentially always pass.)

## Implementation notes for tests

These tests should be implemented at the **logic layer**, not the
UI layer. The game's pure functions for state transitions (drop,
react, gravity, cascade) should accept state-in/state-out, with no
animation or rendering involved. Tests run in milliseconds and
serve as the regression net.

UI-level tests (e.g. for animation timing or input handling) are
not specified here. They are valuable but secondary; build the
logic suite first and only add UI tests for behaviors that
genuinely depend on UI state (input buffering, modal lockout
during cascade, etc.).

# Spawning

This file specifies how the game generates new pairs and special
items. The numbers given here are **starting values**: they are
playable but not necessarily perfectly balanced. Tuning is
expected. Implementers should expose these constants in a single
configuration module so they can be adjusted without hunting
through code.

## What gets spawned

At each spawn event, the game produces one of:

- A **pair of elements** (two elements drawn independently from the
  spawn pool - they may be the same tier or different tiers).
- A **dynamite** (solo).
- A **detonator** (solo).

Pairs are by far the most common.

## The element spawn pool

The spawn pool is the set of **tiers** the game may currently draw
from when generating an element. It is a **pure function of the
current board**, not stored state:

```
pool = {1, 2, ..., n}   where   n = min(11, max(3, highest_tier_on_board))
```

Equivalently: take the highest tier currently on the board, clamp
to the range [3, 11], and the pool is every tier from 1 up to that
value.

A few consequences fall out of this rule:

- At round start the board is empty, so `pool = {1, 2, 3}`.
- Once a player produces a tier-`n` element, that tier is in the
  pool from the next draw onward, and remains so as long as a
  tier-`n` (or higher) element is on the board.
- Tiers below the max are always in the pool, even if no element
  of that tier is currently on the board. The range is contiguous.
- The pool **can shrink**, but never below {1, 2, 3}. If every
  instance of the current highest tier is destroyed (e.g. by
  dynamite or a detonator) and no element of that tier remains, the
  next draw recomputes against a lower max. This is intentional -
  the pool reflects what the alchemist has currently demonstrated
  they can produce.
- The gold nugget (tier 12) is **never** in the pool: it can only
  be produced through a tier-11 reaction. The `min(11, ...)` clamp
  enforces this even when a gold nugget sits on the board.

### Distribution

When generating an element, the game samples from the pool with a
**weighted random** distribution that favors lower tiers. Weights
are looked up in a static per-tier table:

```
TIER_WEIGHTS = [18, 18, 18, 18, 12, 8, 7, 5, 4, 1, 1, 0]
                t1  t2  t3  t4  t5  t6 t7 t8 t9 t10 t11 t12
```

This is the table used by *Naturalchimie 2*, our closest reference
for the original game's tuning. The four lowest tiers are tied,
then weights taper off sharply. Tier 12 (gold) carries weight 0
and never spawns naturally; it only appears as the result of a
tier-11 reaction. The pool already excludes tier 12 via the
`min(11, ...)` clamp, but the trailing zero is kept in the table so
all twelve elements are represented.

When the pool is `{1, ..., n}`, the active weights are the first
`n` entries of `TIER_WEIGHTS`, normalized to sum to 1.

Worked example at an early pool. With pool {1, 2, 3, 4, 5}, weights
sum to 18 + 18 + 18 + 18 + 12 = 84:

| Tier | Weight | Probability |
|---|---|---|
| 1 | 18 | 21.4% |
| 2 | 18 | 21.4% |
| 3 | 18 | 21.4% |
| 4 | 18 | 21.4% |
| 5 | 12 | 14.3% |

Worked example at the maximum pool. With pool {1..11}, weights sum
to 110:

| Tier | Weight | Probability |
|---|---|---|
| 1  | 18 | 16.4% |
| 2  | 18 | 16.4% |
| 3  | 18 | 16.4% |
| 4  | 18 | 16.4% |
| 5  | 12 | 10.9% |
| 6  |  8 |  7.3% |
| 7  |  7 |  6.4% |
| 8  |  5 |  4.5% |
| 9  |  4 |  3.6% |
| 10 |  1 |  0.9% |
| 11 |  1 |  0.9% |

This shape meets the design constraints:

- The four lowest tiers are equally common at every pool size.
  Early game, when only tiers 1-3 are unlocked, the player sees a
  uniform distribution across them.
- Higher tiers (5 and up) taper off sharply. Past tier 9, draws
  become a small fraction of a percent.
- Even at the deepest pool, tier 11 still spawns occasionally
  (~1%), so a player who has unlocked it is sometimes handed
  pre-built progress toward gold.

The two elements of a pair are sampled **independently**. There
is no rule against the two being the same tier; in fact this is
common, especially early when only tiers 1, 2, and 3 exist.

### Sequencing relative to the cascade

The pool is recomputed at the moment of drawing, against whatever
board state exists then. The relevant ordering for a single drop
is:

1. Player drops the active pair.
2. If the pair (or solo item) lands on a detonator, the detonator
   triggers first, before any reaction check. The detonator's 3×3
   blast resolves, then gravity, then the cascade proceeds with
   reactions.
3. Cascade runs: reactions and gravity resolve until stable.
4. The next pair (already drawn before this drop) slides from the
   preview into the active position.
5. A freshly generated piece is drawn against the **post-cascade**
   board and placed in the preview.

Because the preview shows a piece that was drawn *one drop ago*,
there is a one-drop delay between unlocking (or losing) a tier
and seeing the change reflected in the preview window.

## Dynamite and detonator spawning

Dynamite and detonator spawns replace what would otherwise be a
pair. Every draw begins with a kind roll: with probability
**0.05** the draw is a special item, otherwise it is a normal
pair. There is no fill gate - special items can spawn at any
time, including on an empty board.

When the draw is a special item, a second weighted draw chooses
between the two specials. Both currently carry the same weight, so
the split is 50/50:

| Outcome | Combined probability |
|---|---|
| Pair      | 95.0% |
| Dynamite  |  2.5% |
| Detonator |  2.5% |

These are starting values. Special items should feel like an
occasional surprise - present, but not common enough to feel like a
guaranteed escape valve. If during playtesting they feel too rare
or too common, tune the 0.05 first and adjust the special-item
weights only if the dynamite/detonator balance itself feels off.

### Special items and the preview

Special items appear in the preview window like any other piece. A
player who sees a dynamite or detonator in the preview can plan
their *current* move with that knowledge.

## Pseudocode

The complete spawn procedure for a single piece, in pseudocode:

```
SPECIAL_ITEM_PROBABILITY = 0.05
SPECIAL_ITEM_WEIGHTS = { dynamite: 1, detonator: 1 }
TIER_WEIGHTS = [18, 18, 18, 18, 12, 8, 7, 5, 4, 1, 1, 0]

function generate_next_piece(board):
    # 1. Decide piece kind.
    if uniform_random_in_[0, 1) < SPECIAL_ITEM_PROBABILITY:
        return weighted_random_choice(SPECIAL_ITEM_WEIGHTS)

    # 2. Generate a normal pair from the current pool.
    pool = compute_pool(board)
    return Pair(
        left  = sample_tier(pool),
        right = sample_tier(pool),
    )

function compute_pool(board):
    max_tier = max(tier of each occupied cell, default = 0)
    n = min(11, max(3, max_tier))
    return {1, 2, ..., n}

function sample_tier(pool):
    weights = { t: TIER_WEIGHTS[t - 1] for t in pool }
    return weighted_random_choice(weights)
```

Because the pool depends on whatever is currently on the board, an
intermediate tier produced and then consumed within the same
cascade does not, by itself, hold that tier in the pool - only the
post-cascade contents matter. The contiguous-range rule does the
work instead. (Example: three orange potions (tier 3) react into a
purple, and three purples - including the new one - react into
wheat. After the cascade the board holds a wheat (tier 5) but no
fresh oranges or purples. The pool for the next draw is `{1..5}`,
including tiers 3 and 4 by virtue of the contiguous range.)

## Things that are *not* part of spawning

For clarity, the following things are *not* implemented and are
explicitly out of scope:

- No "look-ahead" beyond the single preview slot. There is exactly
  one preview piece at any time.
- No guarantee of fairness in the RNG (no anti-streak protection,
  no minimum spacing between same tiers, etc.).
- No difficulty curve other than the natural growth of the spawn
  pool.
- No special-item cooldown. In principle two dynamite could spawn
  back-to-back; in practice the 0.025 probability per kind makes
  this very rare.
- Special items always appear in column 4 of the spawn area, the
  same column as a horizontal pair's left cell. They cannot
  pre-rotate.

## Determinism for tests

For the purposes of automated testing (see
`06-acceptance-tests.md`), the RNG must be **seedable**. A test
that fixes a seed must reproduce identical spawn sequences across
runs. Implementations should use a single named RNG instance for
all spawn-related rolls; gameplay-affecting randomness must not
come from `Math.random()` or any other source that is not
seeded.

# Naturalchimie Clone — Overview

## What this is

This is a specification for a faithful clone of the **classic** version of
*Naturalchimie*, the Flash puzzle game originally published by Motion Twin
on the KadoKado portal (2005). The original game is no longer playable
because Flash has been removed from browsers.

This spec covers **only the core gameplay loop of a single round**. The
original game shipped with metagame layers — a per-player inventory of
elements, a cauldron for mixing recipes, and a later free-to-play sequel
with quests and tournaments. **None of that is in scope here.**

## Scope

In scope:

- The 7×7 puzzle grid and its overflow rules.
- Falling pairs of elements, controlled with the four arrow keys.
- The 12-element transmutation chain, ending in the inert gold nugget.
- Match-3+ reactions, cascades, and per-column gravity.
- Spawn pool that grows as the player produces new elements during the run.
- Two special solo-spawn items: dynamite and detonator.
- Score, computed as the sum of element values currently on the board
  whenever the board is stable.
- The visual identity of the original: cartoonish hand-drawn vials and
  alchemy ingredients, sky-blue playfield with painted mountains, brown
  parchment sidebar with decorative cream-colored vine borders.
- Merge animation (white-orb collapse + sparkle particles) and the
  animated downward dynamite explosion.

Out of scope:

- Audio (music and sound effects).
- Persistence of any kind. The game is fully stateless across sessions —
  closing the tab loses everything. There is no high-score table.
- The sidebar character's reaction animations.
- Any metagame: inventory, cauldron, recipes, gold collection, levels,
  quests, multiplayer, or progression between rounds.
- The original game's specific element names, copyrighted sprites, or
  audio assets. This is a clone of mechanics and visual *style*, not a
  reproduction of copyrighted assets.

## Non-goals

- **Pixel-perfect recreation.** Sprites and animations must capture the
  hand-drawn cartoon spirit of the original. They do not need to match
  the original assets exactly. Where this spec gives concrete colors or
  proportions, those are guides — implementers may deviate for visual
  polish.
- **Frame-perfect timing.** Animation durations in this spec are starting
  values intended to be tuned by feel during implementation.
- **Mobile support.** The game is keyboard-only. Touch controls are not
  in scope. Responsive layout for window resizes is a nice-to-have, not
  a requirement.
- **Accessibility features** beyond what falls out naturally from
  keyboard controls and reasonable color contrast.

## Audience for this spec

This spec is written to be implemented by Claude Code (or another LLM
coding agent) working alongside a human reviewer. It is intentionally
prescriptive: rules are stated as testable invariants, numbers are given
where possible, and ambiguity is called out explicitly when it remains.

The spec is split across seven files. They are meant to be read
in order the first time, then referenced individually thereafter:

1. `00-overview.md` — this file.
2. `01-gameplay-rules.md` — the rules of a single round: grid, controls,
   matches, cascades, scoring, lose condition.
3. `02-elements.md` — the twelve elements of the transmutation chain and
   the two special solo-spawn items.
4. `03-spawning.md` — how new pairs and special items are chosen.
5. `04-visual-style.md` — the look: layout, palette, sprites, sidebar.
6. `05-animations.md` — the feel: merge effect, cascade timing, dynamite
   explosion travel, particle work.
7. `07-sprite-metadata-and-tooling.md` — how sprite art is integrated:
   the metadata schema, the render math, and the live preview tool used
   to author sprite metadata.

A separate file, `06-acceptance-tests.md`, lists concrete scenarios for
implementers to turn into automated tests. It is not part of the
description of the game; it exists to verify that an implementation
conforms.

## Glossary

- **Element** — one of the twelve items in the transmutation chain.
- **Tier** — an integer 1–12 identifying an element's position in the
  chain. Tier 1 is the green potion; tier 12 is the gold nugget.
- **Cell** — a single position in the 7×7 playfield grid.
- **Pair** — two elements that fall together as a single controllable
  unit. The player can rotate a pair so the two elements are
  side-by-side or stacked.
- **Drop** — the player's commit action (down arrow). Each half of
  the active pair falls straight down to the lowest empty cell in
  its own column. The fall is animated; "drop" here means a single
  committed action (one key press), not "instantaneous" — there is
  no soft drop, no held-down acceleration, and no continuous
  gravity timer between drops.
- **Reaction** — a group of three or more orthogonally-connected
  same-tier elements merging into a single element of the next tier.
- **Cascade** — the full sequence triggered by dropping a piece:
  reactions resolve, gravity compacts each column, new reactions are
  checked, and so on until the board is stable.
- **Stable board** — a state with no pending reactions and no floating
  elements. The score is recomputed only on stable boards.
- **Spawn pool** — the set of elements the game may currently choose
  from when generating a new pair.

# Animations

This file describes the motion and visual effects of the game.
Animation timings are given as **starting values**; implementers
should adjust them by feel during playtesting. The aim is for the
game to feel responsive but readable: cascades should be
visually clear without being so slow that the player loses
patience.

This spec deliberately keeps animations simple. The original game's
hand-drawn charm did not depend on flashy effects.

## Timing reference

| Event | Duration |
|---|---|
| Pair move (left/right) | 60 ms |
| Pair rotation | 100 ms |
| Drop fall (per cell of distance) | 50 ms |
| Drop settle (squash and stretch on landing) | 120 ms |
| Merge — collapse to orb | 200 ms |
| Merge — orb fade-in to new element | 150 ms |
| Inter-cascade pause | 80 ms |
| Gravity fall (per cell of distance) | 50 ms |
| Dynamite explosion travel (per cell) | 60 ms |
| Detonator plunger press | 100 ms |
| Detonator detonation flash | 200 ms |
| Preview slide-out / slide-in | 200 ms each, with ~80 ms gap |
| Game-over fade | 600 ms |

These add up: a typical drop with a single 3-element reaction takes
roughly 120 + 200 + 150 + 80 + (a small gravity fall) ≈ 600–700 ms
of animation before the next pair becomes controllable. A long
cascade can easily take 2 seconds. Players should feel a sense of
satisfaction watching cascades, not impatience.

## Active pair maneuvering

When the player presses left or right, both halves of the pair
**tween** from their old cell to the new one over the move
duration. The tween is a simple ease-out (fast at start, slowing
toward the end). During the tween, additional input is **buffered**
but not applied until the current tween completes. (Alternative:
input is applied immediately and the tween retargets. Either is
acceptable; pick one and be consistent.)

Rotation tweens both halves simultaneously around the pair's
**rotation center** (the geometric midpoint between the two
elements). Neither half serves as a fixed pivot — both arc 90°
clockwise around the shared center on equal-radius paths. A
simple ease-out is fine; this is not a performance moment.

## The drop

When the player presses the down arrow:

1. **Frame 1:** input is locked. The pair's two halves are
   re-targeted from their current spawn-area position to their
   final resting cells (each computed independently per column).
2. **Drop fall:** both halves animate downward to their resting
   cells. Both halves fall at **the same speed**: 50 ms per cell
   of fall distance. If one half has farther to fall than the
   other (because one column is more occupied), it arrives later
   — both halves are subject to the same "gravity," so this is
   correct and natural-looking. The motion is ease-in
   (accelerating downward).
3. **Settle:** a tiny squash-and-stretch effect on each half as it
   lands — vertical compression by ~10% over 60 ms then back to
   normal over 60 ms. This sells the impact without delaying the
   cascade. The cascade does not begin until both halves have
   completed their settle.

After the drop animation finishes, the cascade begins.

The 50-ms-per-cell speed is identical to the gravity-fall speed
used between cascade steps. Drop and gravity are visually
consistent: anything falling, falls at the same rate.

## The merge animation

This is the signature visual of the game. It must feel
**delightful**.

For each reacting group, the merge animation has three phases:

### Phase 1 — White bloom (200 ms)

Every cell of the reacting group simultaneously begins glowing.
The element sprite within each cell brightens from its normal
colors toward pure white over ~120 ms. By 120 ms, the original
sprite is barely visible under the glow. Over the remaining ~80
ms, the element silhouette dissolves into a **formless white orb**
roughly the size of the cell. The orb has a soft white core and a
slightly larger semi-transparent halo.

Throughout this phase, **sparkle particles** emit from each cell:
small (~3 px) bright-white or pale-yellow points that drift upward
at moderate speed, fading as they rise. About 10–20 particles per
cell over the full phase. Particles persist a bit beyond phase 1
into phase 2.

### Phase 2 — Orbs converge (concurrent with phase 1's tail)

As the orbs form, all the orbs of a single reacting group
**converge** toward the group's landing cell (the bottom-most,
left-most cell of the group). Convergence takes the back end of
phase 1 and overlaps slightly into phase 3. Each orb tweens from
its own cell to the landing cell with an ease-in motion. Orbs
retain their white-glow appearance during convergence.

When two or more orbs are at the same position (the landing cell),
they merge visually into a single, slightly larger orb. The
combined orb sits at the landing cell as phase 3 begins.

### Phase 3 — New element fades in (150 ms)

The merged orb fades from pure white through a brief flash to
reveal the new tier-(n+1) element sprite in the landing cell. The
sprite starts slightly oversized (~110%) and shrinks to its
natural size over ~80 ms; it also fades from semi-transparent to
fully opaque. The remaining sparkle particles complete their drift
upward and fade out.

The other cells (the ones that contributed orbs) are now empty.

### Multiple simultaneous reactions

When multiple reacting groups occur in a single cascade step (e.g.
a group of orange potions and a group of yellow potions both react
at the same time), all groups animate **in parallel** with the
same timing. There is no staggering. This communicates the
"simultaneous resolution" rule clearly.

## Gravity fall

After all reactions in a cascade step finish their phase-3
fade-in, **gravity** runs. For each column, suspended elements
tween downward from their old row to their new row.

- The fall is ease-in (accelerates downward).
- The duration is **50 ms per cell of fall distance**.
- All falling elements in all columns animate **in parallel**.

After gravity finishes, the cascade pauses for the
**inter-cascade pause** (~80 ms) — a brief beat for the eye to
catch up — and then checks for new reactions.

## Dynamite explosion

When dynamite lands:

1. The dynamite's fuse animates briefly (~80 ms): a small spark
   travels from the fuse tip to the stick body. (This is the only
   "wind-up" animation in the game; it telegraphs that the
   dynamite is *about* to fire.)
2. A bright orange-yellow **explosion blast** appears at the
   dynamite's cell. The blast is a roughly cell-sized burst with
   irregular flame edges and several spark particles.
3. The blast travels **downward**, one cell at a time. Each cell
   the blast enters:
   - The blast renders for 60 ms in that cell.
   - Any element in that cell is destroyed: it briefly flashes
     white (one frame, ~16 ms) then disappears.
4. The blast continues down to row 1, then dissipates with a
   small upward smoke puff.

During the explosion, **no other animations run** in the affected
column. Adjacent columns continue to render normally (frozen if
they were idle, but reactions in adjacent columns do not happen
during the dynamite blast — the dynamite's blast is its own
cascade step).

After the blast dissipates, gravity runs (typically a no-op since
the column is empty from the dynamite's resting row downward), and
the cascade proceeds to a reaction check. Most often, the dynamite
column is now empty and adjacency for the rest of the board is
unchanged, so no reactions fire.

## Detonator detonation

When something is dropped directly onto a detonator:

1. The triggering item (a normal element from a pair, a dynamite,
   or another detonator) settles into its cell with the normal
   drop/settle animation.
2. As soon as it arrives, the detonator's plunger **presses
   down** into the box over ~100 ms (a small downward tween of
   the plunger sprite — the box and plunger become a single
   compressed shape briefly).
3. A **circular flash** appears centered on the detonator's cell,
   expanding outward to fill the 3×3 Moore neighborhood over
   ~150 ms. The flash is bright white at its center, fading to
   yellow-orange at its edges, with a few spark particles
   radiating outward.
4. Every cell in the 3×3 neighborhood (clipped by the playfield
   bounds) is cleared. The destroyed elements briefly flash white
   (~16 ms) before disappearing, the same as in the dynamite
   blast.
5. The detonator itself disappears with the rest.
6. Total detonation duration is ~200 ms.

The trigger-then-flash sequence has special cases:

- **Dynamite triggers a detonator.** The dynamite settles, the
  detonator triggers, the 3×3 blast destroys the dynamite before
  its fuse animation begins. The dynamite never explodes; only
  the detonator's circular blast occurs.
- **Detonator triggers another detonator (drop case).** The new
  detonator settles, the existing detonator triggers, the 3×3
  blast destroys the new detonator before it has a chance to
  arm. The new detonator never gets to behave as a detonator.
- **Pair lands on two detonators simultaneously.** If a
  horizontal pair is dropped such that each half lands on a
  different detonator, both detonators trigger at the same time.
  Their plunger presses and circular flashes animate in parallel
  on the same timing. Cleared cells are the union of the two
  3×3 areas.
- **A detonator destroyed by another detonator's blast** does
  not itself trigger — it is simply destroyed, treated as any
  other cleared element. There is no chain explosion via
  detonator blast radius.

After all detonations finish, gravity applies normally, and the
cascade's reaction-check step runs as usual. (Detonator
detonations, unlike dynamite, can easily produce reactions: if
two same-tier elements were at the edge of the blast and a third
falls in by gravity, that's a fresh connected component.)

## Preview window animation

The preview window in the sidebar is positioned **below** the
spawn area in screen-space terms. When a piece leaves the
preview, it travels upward into the spawn area; when a new piece
arrives, it descends downward into the preview from above.

The full sequence after a cascade fully resolves:

1. The piece in the preview window **slides upward** out of the
   preview frame, passing briefly out of view, and arrives in the
   spawn area at row 10 (in horizontal orientation, columns 4 and
   5). Duration: 200 ms, ease-in-out.
2. The preview frame is briefly **empty**. Duration: ~80 ms.
3. A freshly drawn piece **slides downward** into the preview
   frame from above. Duration: 200 ms, ease-in-out.

These phases run **strictly sequentially**. The next piece does
not begin sliding into the preview until the previous piece has
fully left the preview, with the small gap between them, so the
two slides do not visually overlap.

Important sequencing: this animation runs **after** the cascade
has fully resolved, not before. While the cascade is running, the
preview window continues to display the piece that was generated
when the previous active piece was committed; the preview is not
empty during the cascade.

## Game over

When the lose condition triggers (a stable board has at least one
element in row 8 or 9):

1. All gameplay input stops accepting keys.
2. The board **darkens**: a semi-transparent dark overlay fades in
   over the playfield over ~600 ms, reducing the playfield to
   about 50% brightness.
3. Centered over the playfield, a "Game Over" text appears (in the
   game's display typeface, large, deep-brown color, slightly
   tilted for character). Below it, the player's final score in
   the same typeface, smaller. Below that, in smaller text still:
   "Press space to play again."
4. Pressing **space** restarts the round from scratch: empty
   board, fresh RNG seed, score 0, new active pair, new preview
   piece. Each restart is a different run.

The game-over screen is the only modal state in the game.

## What does *not* animate

For clarity, listing things that explicitly do **not** animate, to
prevent over-engineering:

- The score numeral does not count up. It updates instantly on a
  stable board.
- The mountains and sky do not parallax, scroll, or breathe.
- The decorative filigree frame is static.
- There is no "Ready?" countdown when starting a round. The first
  pair appears immediately, ready for input.
- There are no idle animations on resting elements. Once an
  element has settled into its cell, it is a static sprite until
  it reacts, falls, or is destroyed.
- There is no screen shake for any event in this version.
  (Screen shake is a tempting addition but is intentionally out
  of scope to keep the visual feel calm. If a future version
  wants it, this is where it would be added.)

## Performance budget

The game must run at a steady 60 fps on a modern laptop. The
animation budget is generous: only one cascade animates at a
time, and the most extreme case (a board-spanning cascade with
many simultaneous merges) involves perhaps 30–50 cells animating
in parallel at peak. Implementers should not need any unusual
optimization. If frame drops occur, the most likely culprit is
particle overdraw — reduce particle counts before complicating
anything else.

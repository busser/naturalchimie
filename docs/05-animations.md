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
| Detonator detonation effects | 900 ms |
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

## Dynamite fuse

The dynamite's fuse is **continuously lit** for the entire time the
stick is the active piece — there is no wind-up on landing. The
fuse lights the moment the stick first becomes visible (during the
spawn-slide, even while the sprite is partially above the
playfield) and stays lit through every shift, rotate, and the drop
itself, until the explosion sequence begins.

A small **orange glow** sits pinned to the fuse tip. From that
point, two streams emit continuously:

- **Sparks**: small (~2–3 px) bright white-and-yellow points that
  fan upward off the fuse tip with random spread, briefly arc with
  a touch of gravity, and fade as they rise. Drawn additively so
  they read as hot light.
- **Smoke wisps**: small (~3–7 px) pale grey puffs that drift
  slowly upward, expanding and fading. Drawn with the default
  blend so they darken against the sky behind the playfield, like
  real smoke.

Density is modest — this is ambient idle decoration, not a focal
effect. Particles live in **screen-space** and stay where they are
born. When the stick shifts left or right, particles already
emitted stay where they were, producing a clear horizontal trail.
When the stick drops, particles emitted earlier in the descent
stay near the top of the column while the stick rushes downward,
so the trail visibly stretches the length of the fall. No
"inherit velocity" logic is needed: the trail falls out naturally
from particles having their own lives independent of the moving
sprite.

Emission stops at impact (the moment the explosion sequence
begins). In-flight particles continue drifting and fade out their
lifetimes; the explosion's own particle system overlays.

## Dynamite explosion

When dynamite lands:

1. A bright orange-yellow **explosion blast** appears at the
   dynamite's cell. The blast is a roughly cell-sized burst with
   irregular flame edges and several spark particles.
2. The blast travels **downward**, one cell at a time. Each cell
   the blast enters:
   - The blast renders for 60 ms in that cell.
   - Any element in that cell is destroyed: it briefly flashes
     white (one frame, ~16 ms) then disappears.
3. The blast continues down to row 1, then dissipates with a
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

The detonation is a real explosion: a fireball blooms over the
3×3 area, sustains long enough for the eye to take it in, then
dissipates with smoke and falling embers. The shockwave ring is
the leading concussion front announcing the bloom — it precedes
the fireball outward at high speed and dissolves before the
fireball reaches its full size. The shockwave's pale-blue tint
at its leading edge is the only cool-toned element; the fireball
itself, embers, and lingering glow all run warm (yellow → orange
→ red), the same palette as dynamite. The two effects share that
warm core deliberately — both are explosions — but the
detonator's shape (radial, stationary, with a 3×3 footprint) and
its shockwave ring (a thing dynamite doesn't have) keep them
distinct.

When something is dropped directly onto a detonator:

1. The triggering item settles into its cell with the normal
   drop/settle animation.
2. **Plunger press (~100 ms).** The detonator y-squashes into
   its cell — the whole sprite compresses vertically, pivoting
   on the cell's floor, with a small upward bounce in the final
   ~20 ms before bottoming out (cartoony anticipation). Box and
   plunger move as one shape; we don't try to compress only the
   plunger.
3. **Detonation fires** the moment the press completes.

The detonation itself plays out over ~900 ms post-detonation, in
several overlapping layers:

- **Detonation flash** — a brief, intense white-yellow bloom at
  the detonator's cell at the moment of detonation. Peaks
  ~35 ms in, decays by ~130 ms. Punctuates the bang before the
  fireball takes over the visual.
- **Shockwave ring** — a thin bright ring expanding from the
  detonator's cell at constant speed (~50 ms per cell of
  travel). Hard leading edge, soft trailing dissipation. White-
  yellow core with a pale-blue tint at the leading edge, the
  one cool note in the whole composition. Reaches the centers
  of the 4 orthogonal neighbors at ~50 ms post-detonation, and
  the 4 diagonal corners at ~70 ms. Fully dissolved by ~150 ms.
- **Fireball bloom** — a radial multi-layered fireball (white-
  yellow inner core, yellow-orange body, red-orange outer wake,
  with mismatched-frequency sine wobbles for flame flicker)
  grows from a point at the detonator's cell out to ~2 cells
  radius. The outer wake exceeds the 3×3 area's corner distance
  (~1.41 cells) so the fireball visibly spills into the cells
  beyond the destruction zone — making the explosion read as
  bigger than its 3×3 footprint. Bloom phase ~180 ms (ease-out:
  fast initial growth, decelerating).
- **Fireball dispersion** — alpha decays quadratically over
  ~400 ms while the radius keeps growing outward by ~20%
  (ease-out). No sustain phase: real explosions don't hold at
  peak, they expand and immediately disperse. The fireball is
  fully gone by ~580 ms post-detonation. Letting the radius
  keep growing during the fade is what sells "the explosion is
  thinning into the air" rather than "a glow is pulsing in
  place".
- **Per-cell engulfment + debris burst** — each cleared cell's
  element sprite stays rendered until the fireball's outer edge
  sweeps past the cell's center, then vanishes. Engulfment is
  tied to the actual bloom curve (not a separate per-cell rate),
  so the sprite's disappearance lines up exactly with the
  visible flame arrival: edge cells engulfed at ~50 ms post-
  detonation, corners at ~80 ms. At engulfment, the cell also
  emits a small radial burst of debris embers (~6 per cell)
  from its own center, in evenly-spread directions with random
  gravity sag and ~400 ms lifetime. Per-cell origins (rather
  than all from the detonator's center) sell "this thing got
  blown up" rather than "everything got pulled toward the
  middle".
- **Continuous fireball embers** — additional embers shed
  continuously from random points within the fireball's body
  during the bloom + sustain phases. Outward velocities with
  gravity sag, ~400 ms lifetime, same yellow/orange/red palette
  as dynamite. Adds the visual texture of an explosion in
  progress.
- **Smoke wisps** — lifted from random points within the
  explosion area throughout the fireball's life. Drift upward,
  expand, fade. Drawn with the default blend (not additive) so
  they darken against the sky behind the playfield like real
  smoke. Last wisps die ~900 ms post-detonation.

The detonator itself is engulfed at distance 0 (immediately at
detonation). It is destroyed alongside everything else in the
3×3 area.

Total duration: ~1000 ms (100 ms plunger press + 900 ms
detonation effects).

The trigger-then-flash sequence has special cases:

- **Dynamite triggers a detonator.** The dynamite settles, the
  detonator triggers, the 3×3 blast destroys the dynamite before
  its fuse animation begins. The dynamite never explodes; only
  the detonator's blast occurs.
- **Detonator triggers another detonator (drop case).** The new
  detonator settles, the existing detonator triggers, the 3×3
  blast destroys the new detonator before it has a chance to
  arm. The new detonator never gets to behave as a detonator.
- **Pair lands on two detonators simultaneously.** If a
  horizontal pair is dropped such that each half lands on a
  different detonator, both detonators trigger at the same time.
  Every layer (presses, flashes, shockwave rings, fireballs,
  embers, smoke) animates in parallel on the same timing, with
  each detonator owning its own copy. Cleared cells are the
  union of the two 3×3 areas; cells in the intersection are
  engulfed by whichever fireball reaches them first. Where the
  fireballs overlap, additive blending makes the overlapping
  region brighter, which reads as right.
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

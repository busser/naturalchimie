# Restart and Leaderboard

This file describes two non-gameplay actions available to the
player: restarting the current round, and viewing a leaderboard
of past runs. Both actions are surfaced as small icons tucked
into the parchment chrome around the playfield, with matching
keyboard shortcuts.

Persistence semantics (when the in-progress run is cleared, when
leaderboard entries are written) live in `10-persistence.md`.
This file covers the input surface and the overlay flows that
drive those operations.

## Icons

The two icons are drawn from the [Iconoir](https://iconoir.com)
library, MIT-licensed:

- **Restart**: `restart.svg`. A clockwise 270-degree arc-arrow
  with a dot near the gap.
- **Leaderboard**: `leaderboard.svg`. The classic three-podium
  silhouette with first place in the middle.

Both icons render in dark-brown ink (the same color as the score
numeral, `#5a3820` or similar per `04-visual-style.md`) at a
2-2.5px stroke weight (increased from the library's 1.5px
default to match the weight of the sidebar vine borders). Each
icon is sized at roughly one cell-unit per side; the implementer
should tune the exact size by feel against the surrounding
parchment chrome.

The icons use `currentColor` for stroke, so color is controlled
entirely via CSS. A subtle warm-glow hover state and a brief
pressed-state inversion are appropriate but not specified in
detail.

## Placement

### Landscape

The two icons sit in the lower portion of the sidebar, in the
region otherwise reserved for the (currently empty) character
portrait slot per `04-visual-style.md`. They are arranged side
by side, restart on the left and leaderboard on the right,
horizontally centered within the sidebar.

### Portrait

The portrait bottom strip currently lays out as
`SCORE | NEXT PAIR` per `09-responsive-layout.md`. A third zone
is added on the far right of the strip holding the two icons
stacked vertically: restart on top, leaderboard below. The score
and preview zones reflow leftward to leave room for the icon
column.

```
┌─────────────────────────────────────────────┐
│   SCORE      │    NEXT PAIR    │   ⟳        │
│              │                 │   ⌷        │
└─────────────────────────────────────────────┘
```

(Glyphs above are placeholders; actual rendering uses the
Iconoir SVGs.)

Exact widths and spacing are intentionally not pinned. The
implementer sets them by feel and refines them after
playtesting on real devices.

## Keyboard shortcuts

Two single-key shortcuts trigger the same overlays the icons do:

- **R** opens the restart confirmation overlay.
- **L** toggles the leaderboard overlay.

Neither key collides with gameplay (which uses only the four
arrow keys, per `01-gameplay-rules.md`). Both shortcuts are
active during a round and on the game-over screen.

## Restart flow

Tapping the restart icon, or pressing R, opens a confirmation
overlay. While the overlay is open, gameplay is paused: no
inputs reach the active piece and no animation advances.

The overlay is styled like the game-over screen (described in
`05-animations.md`): a dim wash over the playfield with
parchment-textured hint text centered on it. The text reads, in
spirit:

> Restart this run?
>
> ESC / tap outside to cancel
> SPACE / double-tap to restart

Exact wording is for the implementer to pick. The cancel and
confirm vocabularies must use the inputs listed below.

**Cancel paths** (any of):

- Pressing ESC.
- Tapping or clicking outside the overlay text (anywhere on the
  dimmed playfield).
- Tapping or clicking the restart icon again.

**Confirm paths** (any of):

- Pressing SPACE.
- Double-tapping anywhere on the overlay.

The confirm vocabulary deliberately mirrors the game-over retry
(SPACE on keyboard, double-tap on touch, per
`09-responsive-layout.md`). A player who has played at least one
round to its end already knows it.

### What "confirm restart" does

On confirm:

1. The `naturalchimie:run` key is cleared from `localStorage`
   (see `10-persistence.md`).
2. A fresh round begins immediately: empty board, fresh spawn
   pool `{1, 2, 3}`, zero score, new active piece and preview
   drawn.
3. **No entry is written to the leaderboard.** The abandoned
   run does not count.

The third point is load-bearing. If quitting padded the
leaderboard with bad runs, players would be incentivized to
abandon hopeless games and the leaderboard would stop being a
record of completed effort. Dropping abandoned runs entirely
keeps the leaderboard meaningful.

## Leaderboard view

Tapping the leaderboard icon, or pressing L, opens the
leaderboard overlay. Gameplay pauses while it is open, just as
during the restart confirmation.

**Dismiss paths** (any of):

- Pressing ESC or L.
- Tapping or clicking outside the overlay.
- Tapping or clicking the leaderboard icon again.

### Contents

The overlay is rendered as a parchment scroll over the
playfield, using the same vine-border treatment as the sidebar.
The top bears a hand-drawn serif title (e.g., "Hall of Fame" or
"Top Alchemists"; the exact wording is for the implementer to
pick).

Below the title is a list of up to ten entries, sorted as
described in `10-persistence.md` "Sort order". Each row shows:

- Rank number, 1 through 10.
- The sprite of the run's highest tier, rendered at
  preview-cell scale.
- The count of that tier, prefixed `x` (e.g., `x3`).
- The final score, right-aligned for column alignment.
- The date of the run, in the player's locale's short format.

If fewer than ten entries exist, only the populated rows are
shown; the scroll has empty parchment below them.

### Empty state

The first time the player opens the leaderboard, no entries
exist yet. The overlay shows the title and a single line below,
in spirit: "No runs yet. Play to make your mark." Exact wording
is for the implementer to pick.

## Interaction with game state

Both overlays freeze gameplay while open:

- Input intended for the active piece is intercepted by the
  overlay layer.
- Animation timelines pause (they resume in place when the
  overlay closes; they do not restart or skip ahead).
- Time elapsed in an overlay does not advance the game in any
  way.

Closing either overlay resumes gameplay exactly where it left
off. The lose-condition check and the score update are not
re-triggered by closing an overlay; both run only at
cascade-settle time, per `01-gameplay-rules.md`.

## Edge cases

- **Only one overlay at a time.** Pressing L while the restart
  confirmation is up does nothing, and pressing R while the
  leaderboard is open does nothing. The first overlay must be
  dismissed before the second can open.
- **Restart on the game-over screen.** Opening the restart
  overlay from the game-over screen is allowed but redundant:
  confirming behaves identically to the standard retry. The
  `localStorage` clear is a no-op because the run key was
  already cleared when game-over fired.
- **Leaderboard on the game-over screen.** Allowed and useful:
  the player can check whether the just-finished run made the
  list. The new entry (per `10-persistence.md`) is visible.
- **Storage failures.** If the `localStorage` clear on restart
  fails (storage quota or disabled storage, per
  `10-persistence.md`), the in-memory state still resets and a
  fresh round begins. The next stable-board save will overwrite
  the stale key anyway.

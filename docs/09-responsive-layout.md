# Responsive Layout and Touch Controls

The game runs on devices with widely varying form factors:
phones, tablets, laptops, desktops, and hybrid devices in
between. Rather than splitting into a "desktop version" and a
"mobile version," the game has **two layouts** (portrait,
landscape) selected by viewport aspect ratio, and accepts **both
input modes** (keyboard, touch) on any device that offers them.

This file describes the portrait layout, the touch input mode,
and the rules for switching between layouts at runtime. The
landscape layout is described in `04-visual-style.md`; the
keyboard input mode is described in `01-gameplay-rules.md`.
Gameplay rules, elements, spawning, and animations are unchanged
across layouts.

## Choosing a layout

Aspect ratio alone decides:

- `width > height` → **landscape** layout (sidebar on the left,
  playfield on the right; see `04-visual-style.md`).
- otherwise → **portrait** layout (bottom strip below the play
  area; described below).

No user-agent sniffing, no `pointer: coarse` check. A foldable
half-open, a desktop user resizing their window, and an iPad
rotated all follow the same rule. The exact threshold is
`width > height`; the implementer may tune it after manual
testing on near-square form factors.

## Portrait layout

The portrait layout stacks two regions vertically: the sky-blue
**play area** holding the 7-column game field, and a parchment-
brown **bottom strip** holding the score and next-pair preview.
Dark-brown background fills the gaps between and around the
regions. Putting the strip at the bottom keeps the score and
preview within easy thumb reach when the device is held
one-handed.

```
┌─────────────────────────────────────┐
│           (outer gap)               │
│  ┌───────────────────────────────┐  │
│  │                               │  │
│  │                               │  │
│  │           PLAY AREA           │  │   ← 7 cols × 13 rows
│  │           (sky)               │  │
│  │                               │  │
│  │                               │  │
│  └───────────────────────────────┘  │
│           (mid gap)                 │
│  ┌───────────────────────────────┐  │
│  │   SCORE     │    NEXT PAIR    │  │   ← bottom strip
│  └───────────────────────────────┘  │
│           (outer gap)               │
└─────────────────────────────────────┘
```

The play area is a 7:13 rectangle (slightly under 1:2 aspect),
covering the same logical content as the landscape playfield:
the 7×7 grid, the two-row overflow zone above it, the two-row
spawn area above that, and margin sky to round out the
proportions.

### Cell size

As in the landscape layout, the cell is the primary sizing
unit. The cell size is derived from the viewport so the whole
layout scales coherently with the device:

```
cell = min(
  viewport_width  / 7.4,
  (viewport_height - safe_area_top - safe_area_bottom) / 15.6
)
```

Where:

- `7.4` = 7 grid columns plus two 0.2-cell side gaps.
- `15.6` = 0.2 (top gap) + 13 (play area) + 0.2 (mid gap) + 2
  (bottom strip) + 0.2 (bottom gap).
- `safe_area_top` and `safe_area_bottom` reserve room for
  device chrome (status bar, notch, home indicator). On the web,
  `env(safe-area-inset-top)` and `env(safe-area-inset-bottom)`
  provide these values.

The smaller of the two constraints wins. On phones, height-fit
typically wins, so leftover horizontal space becomes extra
background flanking the play area. On tablets in portrait, the
result is simply a larger cell value with the same proportions.
The play area is centered horizontally; the bottom strip stretches
to the same width as the play area.

`viewport_height` is measured with the **small viewport** unit
(CSS `100svh`), not the dynamic or large viewport. The layout
sizes itself for the smaller viewport that includes the mobile
browser's address bar. When the bar hides and the visible
viewport grows, the extra space shows as additional dark-brown
background; the layout does not reflow mid-play.

### Region sizes

All sizes are in cell-units. The cell value computed above turns
them into concrete pixels.

| Region | Size |
|---|---|
| Outer gap (top, bottom, left, right) | 0.2 cells |
| Play area | 7 × 13 cells |
| Mid gap (between play area and bottom strip) | 0.2 cells |
| Bottom strip height | 2 cells |

### Bottom strip contents

The bottom strip lays out horizontally with the score on the left
and the next-pair preview on the right, both vertically
centered. The score is rendered in the same hand-drawn serif
numeral as the landscape sidebar; the preview uses the same
recessed-frame style as the landscape preview window. Preview
elements render at grid cell size so the preview reads at the
same scale as the field.

## Input

The game accepts keyboard and touch input simultaneously.
Keyboard listeners and touch listeners are both wired up at all
times, regardless of the active layout, and both route to the
same action handlers (move-left, move-right, rotate, drop). A
hybrid device or a tablet with a Bluetooth keyboard may use
either freely, mid-round, with no mode toggle.

### Keyboard

See the controls table in `01-gameplay-rules.md`. No changes.

### Touch

The keyboard's four actions map to four touch gestures:

| Gesture | Action |
|---|---|
| Horizontal slide (drag) | Move the active pair, tracking the finger's horizontal motion. |
| Tap | Rotate the active pair 90° clockwise. |
| Downward flick | Drop the active pair. |
| Drag-then-flick | A horizontal drag may continue into a downward flick in the same gesture, committing the pair at its post-drag column. |

A gesture may begin **anywhere on the play area** (or, in the
landscape layout, anywhere on the playfield). It does not need
to start on the active pair or in any specific column. The
bottom strip and sidebar are not gesture-active.

#### Drag

While a finger is held down and moving primarily horizontally,
the active pair tracks the finger's horizontal motion, snapping
to columns. Sensitivity is **one column per cell-width** of
finger displacement, so the pair feels glued to the finger at
roughly 1:1 scale. The drag is **relative**: the pair does not
jump to the finger's column on touch-down; it starts at its
current column and moves from there.

The pair clamps at the grid edges. Dragging further left when
already in column 1 has no effect.

Shifts are **rate-limited**: at most one column per animation
frame, and only while the input/step pipeline is idle. The
finger may move faster than the pair animates, but the pair
will never run ahead of the finger, and the queue cannot grow
arbitrarily. Lifting the finger ends the gesture immediately:
any columns the finger reached but the pair had not yet caught
up to are discarded. As a consequence, a quick swipe shifts the
pair only by what was dispatched before lift-off (typically one
column for a fast flick); reaching a distant column requires
holding the finger at the destination long enough for the pair
to catch up.

#### Tap

A tap is a touch-down + touch-up within a small time and
movement budget. On tap-up, the active pair rotates 90°
clockwise (same semantics as the up-arrow).

#### Flick (drop)

A drop fires only when the finger has both moved downward fast
**and** covered enough distance while doing so. Specifically, the
gesture accumulates the downward distance traveled across
consecutive samples whose instantaneous velocity exceeds a
threshold expressed in cell-units per second; any sample below
threshold (including upward motion or a steady finger) resets the
accumulator to zero. The drop fires once the accumulated fast
travel reaches a minimum distance, also expressed in cell-units
so it scales with cell size.

This two-part check filters out both slow drags (never crosses
the velocity threshold) and short jolts (crosses the threshold
but for too small a distance to be a deliberate flick).

Starting values: **8 cells/second** for the velocity threshold
and **0.5 cells** for the minimum sustained distance. Both
should be tuned by feel.

A drop may follow a horizontal drag in the same gesture: if the
finger is mid-drag and then accelerates downward past the
threshold for long enough, the pair drops at its current column.

#### Direction lock

The first time a touch's displacement exceeds a small dead-zone
(suggested: 0.2 cells), the gesture is classified as drag or
flick. After classification, orthogonal motion is ignored,
except that an in-progress drag may still transition into a drop
when the downward-velocity threshold is hit.

This prevents diagonal motions from being interpreted
ambiguously.

#### Multi-touch

Only the first finger to touch the play area counts. Additional
fingers are ignored until the first touch ends.

#### Browser-level concerns

Native touch behaviors that would interfere with gameplay are
disabled on the play area: pinch-zoom, pull-to-refresh,
double-tap-to-zoom, and text selection.

## Game over

Both inputs work on the game-over screen: pressing SPACE or
double-tapping plays the same retry animation. The hint text
matches the current layout:

- Portrait layout: "Double-tap to play again."
- Landscape layout: "Press SPACE to play again."

The game has no buttons or other UI chrome anywhere else, so
introducing one only on the game-over screen would break the
game's visual identity. A double-tap, by contrast, fits naturally
into the gesture vocabulary the player has been using all round,
just as SPACE fits into the keyboard vocabulary.

A double-tap is two single taps within a short time window
(roughly 400 ms). The first tap may produce a subtle
acknowledgement (a brief pulse or particle, to be specified in
`05-animations.md`); the second tap commits the retry and
triggers the transition back into a fresh round.

## Runtime layout switching

The user may rotate their device or resize their browser window
across the portrait/landscape threshold during a round. The
layout switches smoothly: the new `cell` value is computed for
the new viewport, and all static elements (grid contents, score,
preview) re-render at the new size and arrangement immediately.
The pair's logical column is preserved across the switch since
it is a property of the game state, not the layout.

In-flight animations **continue** in the new cell size rather
than restart. A piece falling when the layout changes keeps
falling, scaled to the new cell; a merge sparkle running through
its particle timeline keeps running. Animation timelines are not
reset.

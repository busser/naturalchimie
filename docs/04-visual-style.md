# Visual Style

This file describes the look of the game: layout, palette,
sprites, and the sidebar. Animations are covered separately in
`05-animations.md`.

The layout described here is the **landscape layout**, used when
the viewport is wider than it is tall. The portrait layout (used
on phones and tablets held vertically) is described in
`09-responsive-layout.md`. Palette, sprites, and animations are
shared across both.

The visual identity is **hand-drawn cartoon**, not pixel art and
not flat-vector minimalism. Outlines are visible but not heavy.
Highlights are soft and round. Colors are saturated but not
neon. The overall feel is closer to a children's storybook than to
a slick mobile match-3 game.

## Aspect and overall layout

The game window is a single fixed-aspect rectangle, taller than it
is wide. A target reference resolution is **640 × 720 pixels**, but
the layout should scale uniformly to fit the available window. The
internal layout is divided into two horizontal regions:

```
┌─────────────────────────────────────┐
│                                     │
│  ┌──────────┐ ┌────────────────┐    │
│  │          │ │                │    │
│  │  SIDE-   │ │   PLAYFIELD    │    │
│  │  BAR     │ │   (sky)        │    │
│  │          │ │                │    │
│  │          │ │                │    │
│  │          │ │                │    │
│  └──────────┘ └────────────────┘    │
│                                     │
└─────────────────────────────────────┘
```

The **sidebar** occupies roughly the left third of the inner area;
the **playfield** occupies the right two-thirds. Both regions are
inside a decorative outer frame (described below).

### Cell size

The playfield's 7×7 grid cells should be the primary sizing unit.
A reasonable cell size for a 640×720 reference window is **48×48
pixels**, giving a 336×336 playfield grid plus a sky region above
it. All other measurements (sprite size, sidebar widths, font
sizes) flow from the cell size.

The spawn area (rows 10 and 11) and overflow zone (rows 8 and 9)
are visually contiguous with the playfield in terms of background
(sky and mountains continue upward), so a piece in the spawn
area or descending through the overflow zone appears against sky.

A **horizontal separator line** is drawn between row 7 and row 8
to indicate the lose threshold. The line is a thin horizontal
band — soft, not harsh — in a color that contrasts gently with
the sky background (a faint pale-cream stroke similar in tone to
the decorative filigree, or a thin shadow). Its purpose is to
remind the player at a glance where the danger zone begins.
Above this separator, sprites still render normally during a
cascade; the separator does not clip or mask anything.

There is no separator between rows 9 and 10. The full vertical
extent from row 1 up through row 11 is rendered, and elements
move smoothly between regions. The sky region above row 7 is
large enough to contain rows 8 through 11 plus a comfortable
margin.

## The decorative frame

The entire game window is bordered by a **cream-colored
filigree**: organic, hand-drawn vine-and-scroll motifs in an
off-white or pale-cream color (`#f0e8d0` or similar). The filigree
is densest in the corners and trails along the edges, fading
toward a thin outline by the middle of each edge.

The filigree overlays both the sidebar and the playfield slightly
at the corners — that is, the four corners of the inner content
area are partially obscured by the decorative scrollwork. This is
intentional and should not be cropped to a clean rectangle.

A thin dark outline (1–2px, near-black with a brownish tint) sits
at the very edge of the window, just outside the cream filigree.

## The sidebar

The sidebar is a **brown parchment-colored panel** with a faintly
mottled texture suggesting aged paper or cured leather. The base
color is a warm mid-brown (`#b88a5a` or similar), with subtle
darker mottling. Decorative cream-filigree scrollwork echoes the
outer frame, scattered lightly along the sidebar's edges.

The sidebar contains, from top to bottom:

1. **Score** — the current score, rendered in a large hand-drawn
   serif numeral typeface. Color is a deep warm brown
   (`#5a3820` or similar). The number is displayed without
   thousands separators and without leading zeros: `0`, `27`,
   `19683`, `62976`. The score sits roughly 10% of the window
   height down from the top of the sidebar, horizontally centered
   within the sidebar.

2. **Preview window** — a rectangular recessed area showing the
   next piece. The recess is rendered as a darker brown rectangle
   with a slight inset shadow, suggesting a frame carved into the
   parchment. The preview area is sized to comfortably hold a
   horizontal pair (approximately 2 cells wide and 1 cell tall,
   plus padding). A vertical pair fits within the same frame
   stacked. A solo item (dynamite or detonator) sits in the center
   of the frame.

3. **Character portrait — omitted from the initial
   implementation.** The original game's sidebar contained a
   circular portrait of a young red-haired character in a white
   t-shirt. In a future version this could be added back as a
   purely decorative static image (no animation, no expression
   changes). For the initial implementation, this slot is left
   empty — the lower portion of the sidebar is plain parchment.

The sidebar must be visible at all times during play. None of its
contents overlap the playfield.

## The playfield

The playfield is the area where pieces fall and react. Its visual
elements:

### Background

The background of the playfield is a **soft sky-blue gradient**,
slightly lighter at the top and slightly darker (more saturated)
toward the bottom. Reference colors: `#a8d8f0` at the top, fading
to `#80b8e0` near the floor.

Painted **pale mountain silhouettes** sit at the bottom third of
the playfield, behind any elements. They are pale grey-blue,
heavily atmospheric (washed-out, not detailed), and span the full
width of the playfield. The mountains are a single static layer;
they do not parallax or animate.

The sky background and mountains continue *above* the playfield's
top row, filling the vertical space where the spawn area and
overflow zone live. This way, when a piece is in the spawn area or
descending through the overflow zone, it visually appears against
sky, not against an obviously different "outside the playfield"
background.

### The visible grid

There is **no visible grid line** drawn between cells. Cells are
implicit; the player perceives the grid through the placement of
elements. This matches the original's clean look.

### Subtle floor indication

The bottom of the playfield (just below row 1) has a soft
horizontal shadow that grounds the elements. This is a subtle hint
of a floor, not a hard line.

## Element sprites

Each of the twelve elements occupies one cell. The sprite is
**exactly the width of a cell**, so neighboring elements visually
touch with no gap between them. The sprite is **slightly taller**
than one cell: spherical or main-body parts (potion bulbs,
eyeballs, apples) match cell dimensions, while extruding parts
(potion necks and corks, apple stems, wheat tips) may reach
upward into the visual space of the cell above.

Because sprites overlap vertically, sprites in **lower rows
render in front of sprites in higher rows**. Draw order is
bottom-up by row, so the upward-extruding tops of every sprite
remain visible.

### Common style rules

- **Outlines:** every element has a soft dark outline of about
  1.5–2 pixels at reference resolution. Outlines are not pure
  black; they tint toward a warm dark brown for organic items
  (potions, wheat, chocapic, apple, bone) and toward a cool dark
  blue-grey for inorganic items (crystal, ore).
- **Highlights:** each sprite has a clearly visible specular
  highlight on its upper-left, suggesting a single light source
  from above and slightly to the left.
- **Shading:** soft cell-shaded gradients, not flat colors and not
  photorealistic. Two or three tonal steps per sprite is plenty.
- **Center-of-mass:** sprites should be visually centered within
  their cell. Asymmetric silhouettes (chocapic, bone) should
  balance their visual mass on the cell center.

### Per-element notes

Sprite-specific notes augment the element descriptions in
`02-elements.md`. Implementers may render these as bitmap PNGs,
SVGs, or hand-drawn vector — whatever the chosen toolchain
supports best.

**Shared orientation.** Elements with a clear directional axis
(potions' necks, wheat stalks, bones) are all drawn at the same
tilt: **30° clockwise from vertical**, leaning to the right. This
gives the playfield a visually pleasing parallelism. Spherical
elements without a clear axis are not tilted.

- **Potions (tiers 1–4):** identical glass ampoule shape, differing
  only in liquid color. The bottle has a visible cork stopper at
  the top (warm grey-brown). The glass has a faint blue-white
  highlight running down its right side. The liquid fills roughly
  two-thirds of the bottle.
- **Wheat (tier 5):** a fanned bundle of golden wheat stalks. The
  silhouette is rotationally asymmetric — implementers should pick
  one orientation and stick with it.
- **Chocapic (tier 6):** a horseshoe/cashew curve. The opening of
  the curve faces up. Glossy highlight on the upper outer surface.
- **Apple (tier 7):** classic red apple, single green leaf on a
  short brown stem at the top.
- **Eyeball (tier 8):** pink-white sclera, red iris, black pupil,
  thin red veins.
- **Bone (tier 9):** simple white bone, slight diagonal tilt so it
  does not read as a perfect horizontal bar.
- **Crystal (tier 10):** pale blue gemstone with two or three
  visible faceted planes. A bright white highlight near the top.
- **Ore (tier 11):** rough dark grey-blue rock with embedded
  flecks that catch a faint highlight.
- **Gold nugget (tier 12):** bright yellow-gold lump, smaller than
  the ore, with a pronounced specular highlight. Should "pop" off
  the playfield to feel like the goal it is.

## Special-item sprites

### Dynamite

A red cylindrical stick with three or four horizontal yellow-orange
wrap stripes near the top and bottom (suggestive of paper
wrapping). A short yellow fuse curls up out of the top. The stick
fills its cell vertically and is centered horizontally. While
falling and at rest, no animation is needed; the explosion
animation is in `05-animations.md`.

### Detonator

A grey rectangular box with two horizontal black bands suggesting
metal seams. A red T-shaped plunger sits on top of the box, with
its grip extending half a cell above the box's top edge. The
plunger is a static image while the detonator is at rest — there
is no idle animation suggesting an active state.

When triggered, the plunger animates downward briefly into the box
before the explosion fires; see `05-animations.md`.

## The active pair

While the player is maneuvering a pair in the spawn area, the
pair is rendered as **two element sprites adjacent to each other,
touching, with no visible connector between them**. There is no
"capsule" outline grouping the two halves (in contrast to *Dr.
Mario*'s gel capsule). Vertical and horizontal pairs render with
their two elements directly stacked or side-by-side, sharing an
edge.

When a pair moves left or right, both elements move in lockstep.
When a pair rotates, the elements re-position with a brief tween
(see `05-animations.md`).

## Score readout

The score in the sidebar refreshes once per drop, at the moment
the play area has just stabilized — that is, when the cascade
ends and the next piece is about to slide into the spawn area.
The numeral snaps to its new value in a single update; there is
no count-up animation, and the score is not visibly stepped
through merges and detonations during a cascade. Implementers
who want a brief flash or color pulse on score change may add
one, but the value itself should not tween from old to new.

This is a presentation rule. The core's `score` field updates
live on every step's snapshot (so the chain-bonus settle is
already folded in by the final cascade step); the renderer
gates the DOM update on the stable-board moment.

## Color palette reference

A starting palette, all values approximate:

| Use | Color | Hex |
|---|---|---|
| Sky top | Pale blue | `#a8d8f0` |
| Sky bottom | Sky blue | `#80b8e0` |
| Mountains | Pale grey-blue | `#c8d4dc` |
| Sidebar parchment | Warm brown | `#b88a5a` |
| Sidebar mottling shadow | Darker brown | `#8a6038` |
| Filigree frame | Pale cream | `#f0e8d0` |
| Score numeral | Deep warm brown | `#5a3820` |
| Outer outline | Near-black brown | `#2a1810` |

These are guides, not law. The right way to use this palette is
to load it into a single CSS-variable or design-token file and
adjust holistically once the visual feel is right.

## Typography

The game uses one display typeface for the score and any rare
on-screen text (e.g. a "Game Over" message — see
`05-animations.md`). The face should be a **chunky hand-drawn
serif** with rounded terminals and slightly irregular weights —
something with character, not a polished revival serif. Examples
of acceptable directions include certain humanist or
"display-cartoon" serifs available on Google Fonts. Avoid sans-
serifs entirely. Avoid Comic Sans (it is the most obvious wrong
answer). The score is the only sustained piece of text in the
game; spending care on its readability is worthwhile.

If a "Game Over" text is shown, it uses the same typeface, larger,
in the same deep-brown color.

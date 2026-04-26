# Elements

This file lists the twelve elements of the transmutation chain and
the two special solo-spawn items. It describes each element's tier,
visual identity, behavior, and score value. Implementation of the
sprite art is covered in `04-visual-style.md`; merge and explosion
animations are covered in `05-animations.md`.

## The transmutation chain

The transmutation chain is the linear progression from tier 1 to
tier 12. Each element transmutes, when three or more are
orthogonally connected, into one element of the next tier. Tier 12,
the gold nugget, is **inert** — it does not react further and is
the implicit goal of the game.

The first four tiers are **potions**: glass ampoules with cork
stoppers, holding tinted liquid. They share a common silhouette and
differ only in the color of the liquid. The remaining eight tiers
are **distinct ingredients**, each with its own silhouette and
palette.

### Tier 1 — Green potion

A blue glass ampoule with a brown cork stopper, filled to roughly
two-thirds with bright lime-green liquid. The liquid surface
catches a small white highlight on the upper-left.

- Tier: 1
- Score value: **1**
- Reactive: yes
- Notes: the most common element. Always present in the spawn pool
  from the start of a round.

### Tier 2 — Yellow potion

Same ampoule shape as the green potion. Liquid is warm yellow,
slightly more saturated than goldenrod.

- Tier: 2
- Score value: **3**
- Reactive: yes
- Notes: also always present in the spawn pool from the start.

### Tier 3 — Orange potion

Same ampoule shape. Liquid is a strong orange.

- Tier: 3
- Score value: **9**
- Reactive: yes

### Tier 4 — Purple potion

Same ampoule shape. Liquid is a deep magenta-purple.

- Tier: 4
- Score value: **27**
- Reactive: yes

### Tier 5 — Wheat

A small bundle of two or three golden wheat stalks, drawn flat with
soft outlines. The bundle fills roughly the same footprint as a
potion but is shaped like a fanned-out spray rather than a vertical
ampoule.

- Tier: 5
- Score value: **81**
- Reactive: yes
- Notes: visually distinct silhouette — first time the chain breaks
  away from the potion-bottle shape.

### Tier 6 — Chocapic

A curved brown shape, roughly horseshoe- or cashew-like, suggestive
of a piece of chocolate cereal. Glossy highlight on the upper
surface.

- Tier: 6
- Score value: **243**
- Reactive: yes
- Notes: the silhouette has clear top-and-bottom asymmetry; it
  should always be drawn the same way up.

### Tier 7 — Apple

A red apple with a single green leaf on its short brown stem. The
apple has a pronounced highlight on the upper-left and a darker
shadow at the bottom-right.

- Tier: 7
- Score value: **729**
- Reactive: yes

### Tier 8 — Eyeball

A pink-white eyeball with a red iris and a small black pupil. Visible
red veins on the surface.

- Tier: 8
- Score value: **2,187**
- Reactive: yes
- Notes: the eye should generally face forward, but a slight
  glance-direction variation per sprite is acceptable.

### Tier 9 — Bone

A simple white bone shape: two rounded knobs on each end joined by
a shaft. Drawn at a slight diagonal so it doesn't read as a perfect
horizontal bar.

- Tier: 9
- Score value: **6,561**
- Reactive: yes

### Tier 10 — Crystal

A pale-blue faceted gemstone, drawn with two or three visible
facets and a bright central highlight. The shape is angular, in
contrast to the rounded silhouettes of most other elements.

- Tier: 10
- Score value: **19,683**
- Reactive: yes

### Tier 11 — Ore

A rough dark-bluish-grey rock with embedded crystalline flecks
catching light. The silhouette is irregular.

- Tier: 11
- Score value: **59,049**
- Reactive: yes
- Notes: this is the highest reactive tier. Three of these merge
  into a gold nugget.

### Tier 12 — Gold nugget

A bright yellow-gold lump with a slightly translucent quality and a
prominent highlight. Smaller and more compact than the ore.

- Tier: 12
- Score value: **177,147**
- Reactive: **no** — the gold nugget is inert.
- Notes: the gold nugget never reacts, never spawns from the spawn
  pool (it can only be produced by a tier-11 reaction), and remains
  on the board until destroyed by dynamite or detonator. Multiple
  gold nuggets stacking up is the natural late-game failure mode of
  a successful run.

## Special items

In addition to the twelve elements, two **special items** can spawn
in place of a pair. They are always solo (single-cell at spawn,
though the detonator's plunger sticks above the cell visually) and
are not part of the transmutation chain. Their spawn rules are in
`03-spawning.md`.

### Dynamite

A red cylindrical stick of dynamite with a yellow fuse curling out
of the top. The stick fits within a single cell.

**Behavior:**

- The dynamite is moved and rotated like any other piece, but
  rotation has no visual effect (it is a single cell).
- When dropped, it falls to the lowest empty cell in its column,
  exactly like any element.
- On the same drop in which it lands, the dynamite **explodes
  downward**: every cell from the dynamite's resting cell down to
  row 1 is cleared. Anything in those cells, including gold
  nuggets, is destroyed.
- The dynamite itself is consumed by its own explosion: it does not
  remain on the board.
- The explosion travels visibly downward; see `05-animations.md`.
- After the explosion finishes, gravity applies (no-op in practice
  since the column is now empty from the dynamite's resting row
  downward, but stated for completeness), and then the cascade
  proceeds — though there are typically no reactions to resolve,
  since clearing a single column does not change adjacency for the
  rest of the board.

**Score effect:** the destroyed elements no longer contribute to
the board sum, so the score recomputed at the end of the cascade
will be lower than before the drop (potentially significantly so if
high-tier elements were destroyed).

**Reactivity:** the dynamite is not an element, has no tier, and
cannot participate in reactions.

### Detonator

A grey rectangular metal box with a red T-shaped plunger sticking
half a cell above the top of the box. The box itself fits in a
single cell. The plunger is a visual element only — it does not
occupy a separate cell and does not affect gameplay logic.

**Behavior:**

- The detonator is moved and rotated like any other piece, but
  rotation has no visual effect (it is a single cell).
- When dropped, it falls to the lowest empty cell in its column,
  exactly like any element.
- On landing, the detonator does **nothing**. It stays in place.
- The detonator persists on the board, behaving exactly like an
  inert element (it does not react, it cannot be a member of a
  connected component).
- The detonator triggers when **any** element is dropped onto the
  cell directly above it. Concretely: the trigger condition is a
  freshly-dropped pair (or solo item) settling such that one of
  its halves comes to rest in the cell directly above the
  detonator.

  This is the **only** way a detonator can be triggered. Gravity
  cannot trigger a detonator: a detonator is always the topmost
  occupant of its column, because (a) it can only be triggered by
  a drop, and (b) on the drop in which a detonator first arrives,
  if there were already an element in the cell above where the
  detonator settles, gravity could not have left it stranded
  there. Reactions cannot trigger a detonator either: a reaction's
  result is always placed at one of the cells of the reacting
  group, and detonators are not elements and cannot be members of
  any reacting group, so no reaction landing-cell can coincide
  with the cell directly above a detonator.
- When triggered, the detonator and the eight cells in its
  Moore neighborhood (the eight orthogonally and diagonally
  adjacent cells, including the cell above that just triggered it)
  are all cleared. **Yes, this destroys the element that triggered
  the detonator.**
- The detonation occurs **before** any reaction check. That is: the
  trigger event places an element on top of the detonator;
  immediately the detonation clears the 9-cell area; then gravity
  applies; then the cascade's reaction-check step proceeds normally
  on the post-detonation board.
- If a detonator is in a corner or against a wall, the missing
  neighbor cells are simply not cleared (the explosion is
  effectively masked by the grid bounds).
- If a detonator is destroyed by another means (e.g., by another
  detonator's explosion, or by dynamite passing through it), it
  does not trigger — it is just gone.

**Score effect:** like dynamite, the detonator's effect on score is
purely the loss of value of destroyed elements.

**Reactivity:** the detonator is not an element, has no tier, and
cannot participate in reactions.

**Multiple triggers in one drop:** because each detonator is
always the topmost occupant of its column, no detonator can be
triggered by gravity, and chained-via-gravity detonations are
impossible. The only way two detonators can trigger from a single
drop is if the player drops a horizontal pair such that **each
half lands directly on a different detonator**. In that case both
detonators trigger simultaneously, and their 3×3 areas are both
cleared at the same time. If the two detonators' 3×3 areas
overlap, the overlapping cells are simply cleared once; there is
no double-effect.

**Detonator destroyed by another detonator's blast:** if a
detonator happens to be in the 3×3 blast radius of another
detonator that triggers (for example, two detonators end up in
adjacent columns at the same row, and the second one is in the
first one's blast zone), the second detonator is destroyed
**without triggering**. There is no chain explosion; a destroyed
detonator behaves like any other destroyed element.

**Dynamite landing on a detonator:** if a player drops a dynamite
into a column such that it would settle directly above a
detonator, the detonator triggers first. The 3×3 blast destroys
the dynamite before its fuse can light. The dynamite never
explodes; only the detonator's circular blast occurs. (This is
consistent with the dynamite's fuse-lights-on-landing rule in
`05-animations.md`: the trigger condition for the detonator is
met at the moment the dynamite settles, which is before the
dynamite's own explosion sequence begins.)

**Detonator landing on a detonator:** symmetrically, if a player
drops a detonator into a column whose lowest empty cell is
directly above an existing detonator, the existing detonator
triggers immediately on the new detonator's arrival. The 3×3
blast destroys the new detonator before it has a chance to be
"armed." The new detonator never gets to behave as a detonator.

**Special item landing in an empty column:** trivial case stated
for completeness — if a dynamite or detonator is dropped into a
column with no detonator in it, the special item behaves
normally (dynamite explodes downward; detonator settles and waits
to be triggered).

## Element properties summary

| Tier | Name | Reactive | Spawnable from pool | Score |
|---|---|---|---|---|
| 1 | Green potion | yes | yes (always) | 1 |
| 2 | Yellow potion | yes | yes (always) | 3 |
| 3 | Orange potion | yes | once produced | 9 |
| 4 | Purple potion | yes | once produced | 27 |
| 5 | Wheat | yes | once produced | 81 |
| 6 | Chocapic | yes | once produced | 243 |
| 7 | Apple | yes | once produced | 729 |
| 8 | Eyeball | yes | once produced | 2,187 |
| 9 | Bone | yes | once produced | 6,561 |
| 10 | Crystal | yes | once produced | 19,683 |
| 11 | Ore | yes | once produced | 59,049 |
| 12 | Gold nugget | **no** | **never** | 177,147 |

| Special item | Reactive | Spawn condition (see `03-spawning.md`) |
|---|---|---|
| Dynamite | no | rare; only when board is sufficiently full |
| Detonator | no | rare; only when board is sufficiently full |

## Visual size and footprint

Element sprites are **the full width of a cell** (so neighboring
elements visually touch with no gap between them), and **slightly
taller than one cell**: the spherical or main body of each sprite
fits within cell bounds, while extruding parts (a potion's neck
and cork, an apple's stem, a wheat stalk's tip) reach upward into
the visual space of the cell above.

Because sprites can overlap vertically, sprites in **lower rows
render in front of sprites in higher rows**, so that the upward-
extruding tops of every sprite remain visible. Equivalently, the
draw order is bottom-up by row.

Within a row, draw order between columns does not matter (sprites
in the same row do not overlap horizontally).

Elongated elements with a clear directional axis — potions
(their necks), wheat stalks, and bones — are all oriented at the
same angle: tilted **30° clockwise from vertical** (i.e., leaning
to the right). This gives the playfield a visually pleasing
parallelism. Elements without a strong directional axis (the
spherical potions, apple, eyeball, crystal, ore, gold nugget) do
not need this convention applied.

The dynamite occupies one cell. The detonator's box occupies one
cell; its plunger graphic extends visually into the cell above
(or above the playfield if the detonator is in row 7), but **the
plunger has no gameplay meaning** — only the box's cell counts
for adjacency, gravity, and triggering. The detonator's plunger
does not follow the 30°-tilt convention; it stands vertically.

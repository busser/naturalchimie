# Persistence

This file describes how the game persists state across browser
sessions. There is exactly enough persistence to recover from a
reload mid-round, plus a small leaderboard of past runs. There
is no server, no account, and no sync between devices: every
saved byte lives in the player's browser via `localStorage`.

The two things that persist are independent and held under
separate storage keys, so either can evolve, fail, or be
discarded without affecting the other:

| Key | Holds | Lifecycle |
|---|---|---|
| `naturalchimie:run` | Snapshot of the current in-progress round. | Written on every stable board. Removed on game over. |
| `naturalchimie:scores` | Top-10 leaderboard of finished runs. | Updated on game over. Otherwise untouched. |

Each value is a JSON-encoded object with a top-level integer
`version` field. The version bumps when the payload's shape
changes in a way that older or newer code cannot read. On
load, the game compares the stored version to the version it
knows; on mismatch the entry is discarded silently. There is
no migration code: the cost of writing migrations for a
single-device save file is not justified by the value.

Keeping the two keys independent means a run-schema bump
(expected to happen often as the game evolves) does not
endanger the leaderboard (small, stable, the part the player
would actually mourn losing).

## In-progress run

### When to save

The snapshot is written exactly once per stable board, at the
same moment the sidebar score refreshes: the cascade has
settled, the next piece has slid from the preview into the
spawn area, and a freshly generated piece has appeared in the
preview window. See `01-gameplay-rules.md` "Scoring" for that
sequence.

Mid-cascade snapshots are not taken. A reload that interrupts
an animation rewinds the player to the previous stable board:
they lose the in-flight drop, not the run.

### When to load

On startup the game looks for `naturalchimie:run`. If it
exists and its version matches the running code's version, the
snapshot is restored and play resumes at the beginning of the
next drop. If the key is missing, malformed, or
version-mismatched, the game starts a fresh round as if it
were the first launch.

### When to clear

The key is removed in two cases:

1. **The lose condition fires.** Clearing the run key and
   writing the leaderboard entry are paired so the game is
   never in a state where a finished run is still loadable as
   in-progress on the next launch.
2. **The player confirms a restart** via the restart icon or
   the `R` shortcut (see `11-restart-and-leaderboard.md`).
   Restart clears the in-progress key but does not write a
   leaderboard entry, because an abandoned run does not count.

### Payload shape (version 1)

```json
{
  "version": 1,
  "board": [
    [null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null],
    [{"tier": 1}, null, null, null, null, null, null],
    [{"tier": 2}, {"tier": 3}, null, null, null, null, null]
  ],
  "activePiece": {"kind": "pair", "left": {"tier": 2}, "right": {"tier": 5}},
  "nextPiece":   {"kind": "pair", "left": {"tier": 1}, "right": {"tier": 1}},
  "poolMax": 6,
  "score": {
    "comboScore": 120,
    "boardSum": 487
  }
}
```

Notes on the fields:

- `board` is a 2D array indexed `board[row][column]` with row 0
  being the floor (row 1 in the gameplay numbering) and column
  0 the leftmost column. Every cell is either `null` (empty) or
  `{"tier": n}` for a normal element. Only the 7x7 playable grid
  is serialized: the overflow zone (rows 8 and 9) is empty by
  definition on a stable board where the lose condition has not
  fired, and the spawn area is captured separately via
  `activePiece`.
- `activePiece` is the piece currently in the spawn area, in
  its spawn position (horizontal, columns 4 and 5 for a pair,
  column 4 for a solo). Because the save happens immediately
  after spawn, no rotation or column shift has been applied
  yet, so neither orientation nor column needs to be stored.
  A solo item is encoded as `{"kind": "dynamite"}` or
  `{"kind": "detonator"}`.
- `nextPiece` is the piece currently displayed in the preview
  window, encoded the same way as `activePiece`.
- `poolMax` is the highest tier in the spawn pool. The pool is
  always the contiguous range `{1, ..., poolMax}` (see
  `03-spawning.md`), so a single integer captures it.
- `score.boardSum` is fully derivable from `board` but is
  stored so the load path does not need to recompute it just to
  display the score.

### RNG state is not persisted

The pseudo-random number generator's internal state is not
saved. After a reload, the next piece the spawner produces
will differ from what the same RNG would have produced without
the reload. This is intentional. The player has no visibility
into the would-have-been sequence, so the divergence is
invisible in practice, and persisting the RNG state would
couple the save format to whichever PRNG implementation the
game uses.

## Leaderboard

The leaderboard holds at most ten entries. Each entry records
four fields:

| Field | Meaning |
|---|---|
| `score` | Final score (`comboScore + boardSum`) at the moment the lose condition fired. |
| `highestTier` | Highest tier present on the board at game over, 1 to 12. |
| `highestTierCount` | Number of cells holding an element of `highestTier` at game over. |
| `timestamp` | ISO 8601 string of when the run ended, in the player's local time zone. |

Payload shape (version 1):

```json
{
  "version": 1,
  "entries": [
    {"score": 12750, "highestTier": 11, "highestTierCount": 1, "timestamp": "2026-04-12T18:43:01+02:00"},
    {"score":  9810, "highestTier": 10, "highestTierCount": 3, "timestamp": "2026-04-11T20:12:55+02:00"}
  ]
}
```

### Sort order

Entries are kept sorted in descending order on the tuple
`(highestTier, highestTierCount, score, timestamp)`. The
gameplay arc of Naturalchimie is the transmutation chain:
reaching gold is the achievement, score is a by-product of how
efficient the player's cascades happened to be. The sort order
reflects that.

Specifically:

1. Higher `highestTier` wins.
2. If tied, higher `highestTierCount` wins.
3. If still tied, higher `score` wins.
4. If still tied, more recent `timestamp` wins (newer runs
   rank above older ones, so a tie pushes the older entry
   down first).

### `highestTier` and `highestTierCount`

Both are computed from the final stable board, the one on
which the lose condition fired:

- `highestTier` is the maximum `tier` across all elements
  present on the playfield (rows 1 to 7) and the overflow zone
  (rows 8 to 9). For a pathologically empty board, both
  `highestTier` and `highestTierCount` are 0.
- `highestTierCount` is the number of cells holding an element
  of that `highestTier`.

"Highest tier ever produced during the run" was considered and
rejected. An element the player merged away does not feel like
a kept achievement, whereas an element still on the board at
the moment of loss does.

### When to write

On game over, after the lose condition has fired and the run
key has been cleared, the game builds the new entry and
inserts it into the sorted list. If the list now has more than
ten entries, the trailing entry is dropped. The list is then
written back to `naturalchimie:scores`.

A run that does not displace any of the existing top ten is
still appended if there is room (fewer than ten entries
stored); otherwise it is silently dropped from the
leaderboard. The game does not surface a "you didn't make the
top ten" message: the leaderboard is private to the player and
expresses only what they have done well.

## Failure handling

Every `localStorage` operation may throw: storage quota
exceeded, private-browsing restrictions, storage disabled at
the browser level. The game catches these and degrades
silently. A failed save has no in-game effect; a failed load
is treated as "no save exists" and a fresh round starts.

The player is not notified when persistence fails. The
feature is a convenience layered on top of an otherwise
stateless game, so the cost of a missed save is a single
lost round, which the game was already designed to tolerate.

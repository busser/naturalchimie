# Worklog

A running log of work done on the Naturalchimie clone. Newest entries
at the top.

## 2026-04-26 — Wired up ESLint and fixed the Vitest config types

Now that the first core module exists, added the ESLint
`no-restricted-imports` rule promised in `08-software-design.md`:
`src/core/**` is forbidden from importing any sibling layer
(`store`, `input`, `animation`, `renderer`, `assets`). Verified
the rule fires by inserting a forbidden import and watching it
fail. Also fixed a pre-existing typecheck error in
`vite.config.ts` by importing `defineConfig` from `vitest/config`
instead of `vite` + a triple-slash reference; the merged types
now recognise the `test` block and `npm run typecheck` is clean.

## 2026-04-26 — Picked an RNG and landed the first core module

Closed the RNG open question by going with a hand-rolled immutable
**Mulberry32** in `src/core/rng.ts`. The API is `createRng(seed)` →
`Rng`, `nextFloat(rng)` → `[value, nextRng]` — no mutation, so the
core can stay a pure function of `(state, input, rng)`. Considered
`pure-rand` and `seedrandom`; rejected the latter because its
mutable surface fights the pure-core design, and skipped the former
to avoid a dependency for ~10 lines of code. Tests cover seed
determinism, range, and immutability. Also added two new open
questions (step application during animation, input buffering
during cascades) that surfaced while reviewing the design.

## 2026-04-26 — Scaffolded the project

Set up Vite + TypeScript (strict) + Vitest, with a multi-page Vite
config so `tools/sprite-tool.html` is served alongside the runtime
entry at `index.html`. Moved sprites from the top-level `sprites/`
under `public/sprites/` so Vite serves them as-is at `/sprites/*`.
Migrated `src/sprite-renderer.js` to TypeScript at
`src/assets/sprite-renderer.ts`; the sprite tool's import path
follows. Documented the directory layout in `08-software-design.md`
and closed two of the four open questions (project structure
decided; module dependency rule will be enforced by ESLint when the
first core module lands). RNG library and animation step shape
remain open.

## 2026-04-26 — Chose the rendering surface

Settled on Canvas 2D for the playfield and particles, with HTML/CSS
for the chrome around it. Documented the decision in
`08-software-design.md` along with the resize strategy: recompute
`cell_size_px` on viewport changes, scale the bitmap by
`devicePixelRatio` for HiDPI sharpness, and cap the cell size at
the PNG-native resolution to avoid upscaling blur. Also recorded
that the final element art is PNG raster (not programmatic
placeholders), which closed two of the open questions.

## 2026-04-26 — Tuned sprite metadata

Used the live preview tool to author and tune the metadata files that
position each element sprite within its cell.

## 2026-04-26 — Built sprite metadata tool

Wrote a tool for editing sprite metadata with a live preview, so that
sprite framing (size, offset, anchor) can be adjusted by feel rather
than by guessing numbers.

## 2026-04-25 — Drew element sprites

Produced the initial set of sprites for the twelve elements of the
transmutation chain, in the hand-drawn cartoon style described in
`04-visual-style.md`. Some early designs were set aside; they live in
the abandoned-sprites directory for reference.

## 2026-04-25 — Wrote the spec

Drafted the full specification for a single round of the game, split
across `00-overview.md` through `08-software-design.md`. The spec
covers gameplay rules, elements, spawning, visual style, animations,
acceptance tests, sprite tooling, and software design.

# 0022 — Retire the old chapter 2–5 worlds

- **Status:** accepted
- **Date:** 2026-11-04
- **Supersedes:** [ADR-0015](0015-keep-the-odyssey-one-world-escape-hatch.md)

## Context

ADR-0015 kept the eight-scene "diorama" journey alive behind `?odysseyOneWorld=0` and behind a
crash-catch around `createOdysseyWorld()`, so a machine whose world failed to build would recover
into a full journey. It called retiring them "an owner call, not a refactor".

The owner made that call: the old worlds look far worse than the One World and should not be in
the final game, in any path. The audit's blockers were re-measured against the code first, with
an import-graph walk from every entry point:

- The running game reached the four scenes only through the chapter registry. Nothing else in the
  shipped graph imported them: `mountain-language.js` and `canonical-mountain-range.js` had no
  shipped consumer left (Winter let go in its 2026-10 rebuild; the playground stopped being a
  production input on 2026-08-21).
- The 34 ecotone bridges that belong to chapters 1, 7 and 8 are untouched, since those chapters
  keep their scenes.
- The audit's other finding still stands: without the old scenes, a world that fails to build
  leaves chapters 2–5 with no ground.

## Decision

**The chapter 2–5 scenes, `?odysseyOneWorld` and everything only they used are removed.**

- `CHAPTER_SCENES` lists the chapters with a scene (1, 6, 7, 8); `ONE_WORLD_CHAPTERS` lists the
  chapters the world draws (2–5). Together they are the chapter list, test-enforced.
- A world that fails to build or compile is given up, and the journey plays on: chapters 2–5 have
  the corridor's parallax sheets and the atmosphere instead of ground, and stay fully playable.
  Travel into them waits for the world while it is coming and goes ahead once it is given up.
- That failure stays **loud**: a dismissible player-facing banner and a capped `localStorage` log
  (`world/world-build-failure-report.js`). The state is self-consistent enough to pass for a
  quieter map, so silence would hide it.

## Consequences

- About 17,000 lines, five GLBs and seventeen playground effects are gone, and the light rig is
  sized by the chapters that are built (4 slots), with no path that grows it.
- A machine that cannot build the world sees plain chapters 2–5, a real downgrade from the old
  recovery journey. That is accepted: the old worlds should not ship in any path, the game stays
  playable, and the banner says what happened. The failure log is local to each machine, so how
  often this happens in the field is not known.
- Comments elsewhere that cite "the ADR-0015 pattern" (a retired feature kept one flag from
  restoration) describe an unrelated practice and still stand.

## Enforcement

`src/rendering/odyssey/world/odyssey-world-default.test.js` pins that there is no off switch, that
the old modules stay gone and that a failed world is given up loudly with its corridor filled.
`tests/unit/chapter-registry-consistency.test.js` pins the two chapter lists against core, and
`tests/unit/odyssey-wave46-scope-invariants.test.js` pins the seam machinery the surviving chapters
still depend on.

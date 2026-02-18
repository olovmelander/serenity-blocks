# Sky Children Phase 0 Look Bible

## North Star

Target the "Valley of Triumph / Sunset" emotional state from Sky: Children of the Light with Journey-style painterly lighting language:
- warm-gold highlights,
- cool-violet shadows,
- soft atmospheric depth,
- readable silhouettes and board-safe contrast.

Phase 0 completion target:
- `12-20 curated Sky/Journey frames grouped by mood (sunset, cloud sea, interior haze) with approved palette targets`.

## Inspiration Guardrail

Use Sky and Journey as mood and lighting references only.
- Keep all implementation assets, layout, and shot staging original to Serenity Blocks.
- Do not copy characters, symbols, UI language, or trademark scene compositions.

## Mood Buckets And Palette Targets

| Mood | Emotional Use | Approved Palette Targets |
|---|---|---|
| Sunset (primary) | triumph, awe, arrival | `#F6C063`, `#E58D4A`, `#F3EBDD`, `#8FB6D8`, `#6A71B8` |
| Cloud Sea | calm traversal, openness | `#F6F2E4`, `#F0C9A2`, `#9CCDE2`, `#D7E3EE`, `#7E97BE` |
| Interior Haze | shelter, reflection, mystery | `#CDA46A`, `#8FAFC3`, `#4F7A8E`, `#A7B2B9`, `#6B5B51` |

## Style Anchors (Locked)

1. No black shadows. Shadow regions are always colored.
2. Soft light wrap. Avoid hard Lambert-style terminators.
3. Rim separation on silhouettes at near/mid/far depths.
4. Atmosphere-first depth. Fog and haze unify geometry layers.
5. Glitter/spark accents are selective and stable, never random strobe.
6. Warm/cool split remains visible during idle and stress states.

## Composition Locks

- Maintain three readable depth bands per hero shot:
  - foreground framing shapes,
  - midground playable/readability pocket,
  - far atmosphere cloud/terrain silhouette.
- Keep the brightest highlight cluster off-center from the board ROI.
- During combo peaks, preserve board-safe contrast and edge readability.

## Hero Shot Set (Phase 0 Review)

1. `hero-sunset-ridge`
2. `hero-sunset-cloud-rim`
3. `hero-cloud-sea-wide`
4. `hero-cloud-sea-silhouette`
5. `hero-interior-haze-entry`
6. `hero-interior-haze-depth`

## Phase 0 Review Workflow

1. Capture fixed-camera shots from the six hero bookmarks.
2. Compare against `docs/SKY_CHILDREN_PHASE0_REFERENCE_BOARD.md`.
3. Record every style regression in `docs/SKY_CHILDREN_LOOK_LOG.md`.
4. Block merge if warm/cool balance, silhouette readability, or atmosphere continuity regresses.

## Linked Artifacts

- Reference board: `docs/SKY_CHILDREN_PHASE0_REFERENCE_BOARD.md`
- Look log: `docs/SKY_CHILDREN_LOOK_LOG.md`
- Master plan: `docs/SKY_CHILDREN_WEBGPU_THEME_PLAN.md`

# Phaser Migration · Phase 5 Theme & Background Strategy

Phase 5 rationalizes theme metadata, connects the WebGL background renderer to the Phaser render loop, and sets the stage for richer background effects.

---

## 1. Theme Registry Modernization

- Added `src/themes/theme-registry.js`, a single source of truth for theme metadata (id, display name, module path, grouping). All theme lookups now rely on this registry, enabling future filtering and tooling.
- `core/constants.js` derives the exported `THEMES` array from the registry, so gameplay logic and UI automatically pick up new themes.
- `ThemeManager` reads from the registry rather than a duplicated map, simplifying lazy-loading and validation (`src/themes/theme-manager.js`).

## 2. Phaser-Driven Background Loop

- Introduced `BackgroundScene`, a lightweight Phaser scene that invokes the existing `WebGLRenderer` every frame and keeps it synchronized with the main game loop (`src/rendering/phaser/background-scene.js`).
- The renderer now supports an external render loop; Phaser owns the clock while the WebGL engine still handles particle batches (`src/rendering/renderer.js`).
- `SerenityBlocks.startBackgroundScene()` boots the background scene once the renderer and theme manager are ready, ensuring initial theme loads happen after the scene is active (`src/main.js:332`).

## 3. Layout & Configuration

- Phaser config now includes the background scene ahead of board scenes, and the canvas aspect ratio expands to accommodate dual-board layouts (`src/main.js:259`, `public/styles/main.css:4740`).
- Scene post-boot wiring stores references to the background/board scenes for later orchestration.

## 4. Observations & Next Steps

- Performance: manual profiling shows the manual-render path keeps GPU time roughly the same while avoiding double RAF scheduling. We can now hook debugging/profiling via Phaser’s scene events if needed.
- Asset pipeline: theme metadata paves the way for preloading (e.g., via dynamic imports or Phaser Loader packs). Future work could introduce optional sprite/texture manifests per theme.
- Cleanup: With the background renderer now owned by Phaser, we can gradually replace CSS-driven theme layers with Phaser display objects where it makes sense.

Phase 5 is complete. Upcoming work (Phase 6) can focus on system-wide cleanup, event wiring, and automated validation with the new renderer architecture.

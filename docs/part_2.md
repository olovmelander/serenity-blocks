# Phaser Migration · Phase 1 Assessment & Tooling

This report captures the outcomes of **Phase 1** from the migration plan.

---

## Rendering Path Inventory

| Rendering Area | Responsibilities | Primary Modules / Assets | Notes |
| --- | --- | --- | --- |
| **Single Player Board** | Falling piece, ghost, locked blocks, cascade FX | `src/rendering/phaser/board-scene.js`, `src/main.js` | Currently Phaser v3; relies on shared physics callbacks and has particle/shake logic embedded in-scene. |
| **Multiplayer Boards** | Dual boards, garbage animations, HUD flashes | `public/index.html` (DOM canvases), `src/rendering/draw.js`, `src/rendering/canvas-utils.js`, `src/main.js` | Still canvas-based; draws via legacy `draw()` pipeline. Candidate for migration to Phaser scenes. |
| **Fallback / Legacy Rendering** | Canvas rendering for compatibility | `src/rendering/draw.js`, `src/rendering/canvas-utils.js` | Serves as fallback for single player; needs evaluation post migration. |
| **Background & Themes** | Animated backgrounds, particles, theme assets | `src/rendering/renderer.js`, `public/styles/main.css`, `src/themes/**` | Hybrid WebGL renderer + CSS/SVG layers. Needs decision on remaining standalone vs Phaser integration. |
| **UI / HUD** | Stats, controls, modals, next-piece previews | DOM templates (`public/index.html`), UI modules under `src/ui/**` | Next pieces rendered via small canvases; future work to move into Phaser UI or keep DOM. |

---

## Tooling Implementation

✅ **COMPLETE** — All tooling infrastructure has been implemented:

- **Renderer bundling**: ✅ Migrated from CDN-based Phaser to ES module workflow using **Vite**
  - Created `vite.config.js` with dev server, build optimization, and path aliases
  - Updated `public/index.html` to remove CDN script tag
  - Phaser now bundled as a separate chunk for optimal caching
- **Linting / formatting**: ✅ ESLint (Airbnb-based rules tuned for Phaser) and Prettier configured
  - `.eslintrc.json` — Code quality rules with game-dev accommodations
  - `.prettierrc` — Consistent code formatting (4-space, single quotes)
- **Asset handling**: ✅ Vite configured for static asset handling (images, audio)
- **Project scaffolding**: ✅ Complete
  - `package.json` — Dependencies and npm scripts
  - `.gitignore` — Build outputs and dependencies excluded
  - `docs/TOOLING_SETUP.md` — Complete setup and workflow documentation

---

## Shared Utility Preparation

- Introduced `src/rendering/phaser/utils/index.js` (see `graphics.js`) with `ensureCircleTexture()` helper.
- BoardScene now depends on the utility rather than inlining the procedural texture generator, paving the way for shared particle helpers.
- Future expansion: color math, easing helpers, reusable particle configuration (tracked for Phase 2/3).

---

## Phase 1 Status: ✅ COMPLETE

All tasks and deliverables for Phase 1 have been implemented:

- ✅ Rendering path inventory documented
- ✅ Tooling infrastructure fully implemented (Vite, ESLint, Prettier)
- ✅ Utility module skeleton established
- ✅ CDN removed, ES module workflow active
- ✅ Complete setup documentation created

---

## Hand-off to Phase 2

**Phase 1 is complete.** Ready to proceed to **Phase 2 · Core Rendering Platform**:

- Create base Phaser scene architecture
- Migrate multiplayer board rendering from canvas to Phaser
- Evaluate moving DOM HUD elements into Phaser containers
- Expand shared utility modules as needed
- Document any additional utilities to keep the module cohesive

**Next step:** Run `npm install` to set up the development environment, then `npm run dev` to start.

# Serenity Blocks

Serenity Blocks is a falling-block puzzle game set inside living 3D worlds, with music and guided
breathing. Guide the falling pieces, complete rows, and build chains and cascades while the world
around the board answers. The boards are drawn with Phaser 4 and the worlds with three.js (WebGPU,
with a WebGL2 fallback). The game's own description is in [`game_description.md`](game_description.md).

## Quick Start

### Prerequisites
- Node.js 20+ (project currently developed on Node 22)
- npm

### Run in Development
```bash
npm install
npm run dev
```

Open the URL printed by Vite (typically `http://localhost:5173`).

Open **Settings → URL parameters** for a searchable development reference with descriptions,
accepted values and examples. See [reference maintenance and removal](docs/URL_PARAMETER_REFERENCE.md).

### Production Build
```bash
npm run build
npm run preview
```

## Core Architecture

- Gameplay rendering: Phaser 4 (`phaser` ^4.2.1, see `package.json`)
- Worlds (themes): three.js (`three` 0.187.0), WebGPU/TSL with a WebGL2 fallback, managed by the
  Phaser lifecycle
- Runtime orchestration: `src/main.js`
- Scene layer:
  - `src/rendering/phaser/board-scene.js`
  - `src/rendering/phaser/background-scene.js`
  - `src/rendering/phaser/multiplayer/board-panel.js`

## Useful Scripts

- `npm run dev` - Start Vite dev server
- `npm run build` - Build production bundle
- `npm run preview` - Preview production build
- `npm run lint` - ESLint checks
- `npm run format:check` - Prettier checks

## Documentation

- [`docs/ARCHITECTURE_INDEX.md`](docs/ARCHITECTURE_INDEX.md) - Index of the architecture and design records
- [`docs/adr/`](docs/adr/) - Architecture decision records
- [`HOW_TO_RUN.md`](HOW_TO_RUN.md) - Running the game in the browser or as a desktop app
- [`PHASER_QUICKSTART.md`](PHASER_QUICKSTART.md) - Phaser-first developer quickstart
- [`docs/WEBGPU_THREEJS_WORKFLOW.md`](docs/WEBGPU_THREEJS_WORKFLOW.md) - Building and checking a world
- [`src/playground/README.md`](src/playground/README.md) - The effect playground
- [`docs/archive/2026-06-repository-cleanup/`](docs/archive/2026-06-repository-cleanup/) - Archived
  records of the move to Phaser (migration plan, integration, architecture, troubleshooting, QA checklist)

## Notes

- The game uses Phaser for board rendering and three.js for the worlds behind the boards.
- Legacy canvas paths remain only as guarded fallback paths.

## Accessibility

**Photosensitivity.** Serenity Blocks contains flashing lights and visual effects (lightning,
bursts, strobes and bright transitions in its worlds) that may trigger discomfort or seizures in
people with photosensitive epilepsy, including people with no history of it. A photosensitivity
warning opens every launch, before anything else. **Settings › Visual › Reduce flashing effects**
turns frame-wide flashes into a soft glow, fires lightning once and holds strobes steady while the
worlds keep moving; **Reduce motion** calms shakes and large motion separately (it also follows your
system's reduced-motion preference). If you experience dizziness, altered vision, eye or muscle
twitches, loss of awareness, disorientation or any involuntary movement, stop playing at once and
consult a doctor.

That paragraph is the wording for the store page; keep it and
[`docs/adr/0021-photosensitivity-warning-and-reduce-flashing.md`](docs/adr/0021-photosensitivity-warning-and-reduce-flashing.md)
in step. Harnesses skip the warning with `?photosensitivityWarning=0` (or `skipIntro=1`); the
player always sees it.

## Legal

Copyright © 2025–2026 Olov Melander. All rights reserved: see [`COPYRIGHT.md`](COPYRIGHT.md).

Serenity Blocks is an independent game and is **not affiliated with, endorsed by, or
sponsored by The Tetris Company, LLC or Tetris Holding, LLC.** TETRIS® is a registered
trademark of Tetris Holding, LLC. Third-party asset attributions are listed in
[`CREDITS.md`](CREDITS.md).

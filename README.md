# Serenity Blocks

Serenity Blocks is a falling-block puzzle game with a Phaser-first gameplay renderer and Three.js/WebGL theme backgrounds.

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

- Gameplay rendering: Phaser 4 (`phaser@4.0.0-rc.5`)
- Background themes: Three.js renderer managed by Phaser lifecycle
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

- `docs/PHASER_MIGRATION_PLAN.md` - Migration roadmap and phase status
- `PHASER_QUICKSTART.md` - Phaser-first developer quickstart
- `docs/PHASER_INTEGRATION.md` - Current integration and rendering flow
- `docs/PHASER_ARCHITECTURE.md` - Scene graph and asset pipeline diagrams
- `docs/PHASER_TROUBLESHOOTING.md` - Common Phaser/Vite runtime issues
- `docs/part_9.md` - Phase 8 handoff summary and maintenance notes
- `docs/qa-checklist.md` - Manual QA matrix

## Notes

- The game uses Phaser for board rendering and keeps theme backgrounds in Three.js for visual flexibility.
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

Serenity Blocks is an independent game and is **not affiliated with, endorsed by, or
sponsored by The Tetris Company, LLC or Tetris Holding, LLC.** TETRIS® is a registered
trademark of Tetris Holding, LLC. Third-party asset attributions are listed in
[`CREDITS.md`](CREDITS.md).

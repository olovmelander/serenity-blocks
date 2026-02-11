# Serenity Blocks

Serenity Blocks is a Tetris-inspired game with a Phaser-first gameplay renderer and Three.js/WebGL theme backgrounds.

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

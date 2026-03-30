# Phaser Quickstart

This is the fastest path to run and validate Serenity Blocks on the current Phaser-first stack.

## Stack Snapshot

- Phaser: `4.0.0-rc.5` (bundled via npm + Vite)
- Build/dev server: Vite
- Background themes: Three.js renderer driven by Phaser lifecycle

## Run Locally

```bash
npm install
npm run dev
```

Open Vite's local URL (typically `http://localhost:5173`).

## What To Verify

1. Boot logs include Phaser initialization and loaded scenes.
2. Single-player board renders in Phaser (no visible legacy canvas path).
3. Switching game modes still keeps background themes active.
4. Theme switching works without restarting Phaser.

## Key Entry Points

- App bootstrap: `src/main.js`
- Single-player scene: `src/rendering/phaser/board-scene.js`
- Background bridge scene: `src/rendering/phaser/background-scene.js`
- Multiplayer scenes: `src/rendering/phaser/multiplayer/board-panel.js`
- Shared base scene: `src/rendering/phaser/base-board-scene.js`

## Common Commands

```bash
npm run lint
npm run build
npm run preview
```

## If Something Breaks

Use the troubleshooting guide:
- `docs/PHASER_TROUBLESHOOTING.md`

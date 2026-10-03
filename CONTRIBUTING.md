# Contributing to Serenity Blocks

Serenity Blocks is a falling-block puzzle game. Phaser 4 renders the board, three.js renders
the themes and Odyssey mode (WebGPU/TSL for most surfaces), and the game ships as an Electron
desktop app.

## Setup

You need Node.js 20 or newer (CI runs Node 24).

```bash
npm install
npm run dev              # Vite dev server; open the URL it prints
npm run dev:playground   # the WebGPU/TSL effect playground (/playground.html)
```

## Before you open a pull request

Run the main checks a pull request is gated on:

```bash
npm run typecheck
npm run lint:ci          # ESLint error-count ratchet: the count may not go up
npm test                 # Vitest unit suite
```

CI runs a few more gates on every pull request (architecture fitness, module boundaries,
release gates); `.github/workflows/pages.yml` lists them.

**Pull-request CI does not run the build.** The `build` job (the Vite build plus the
boot-closure guard) runs only after a push to `main`, so run it yourself before merging:

```bash
npm run build
```

## Rules for specific kinds of change

- **Visual changes** (a theme under `src/themes/`, an Odyssey chapter under
  `src/rendering/odyssey/`, a playground effect): follow
  [docs/WEBGPU_THREEJS_WORKFLOW.md](docs/WEBGPU_THREEJS_WORKFLOW.md). A clean build is not
  proof that it looks right; the change is done once it has been checked in a screenshot
  with a clean console
  ([ADR-0007](docs/adr/0007-webgpu-tsl-definition-of-done.md)).
- **Performance claims**: a number goes into a plan, a budget or a commit message only when
  it comes from a verified instrument and a content-matched comparison
  ([ADR-0016](docs/adr/0016-perf-claims-require-a-verified-instrument.md)).
- **Structural changes**: start at
  [docs/ARCHITECTURE_INDEX.md](docs/ARCHITECTURE_INDEX.md) and
  [docs/adr/](docs/adr/README.md). The ADRs record decisions that are not reopened
  casually.

Instructions for AI coding agents live in `CLAUDE.md` (Claude Code) and `AGENTS.md` (Codex).

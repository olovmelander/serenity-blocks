# Serenity Blocks — agent guide

## WebGPU / Three.js visual work: validate before "done" (required)

This project's visual surfaces are WebGPU/TSL. When you create or change a **theme**
(`src/themes/<id>/`) or an **Odyssey chapter** (`src/rendering/odyssey/`), you must verify
the result visually — a clean build is NOT proof it looks right.

**The loop (playground-first):**
1. Iterate the effect in isolation: `npm run dev:playground` →
   `http://localhost:5173/playground.html?effect=<id>`. Author/iterate effects under
   `src/playground/effects/<id>.effect.js` (drop-in file, auto-registers, instant HMR).
2. **Screenshot to verify** with the `chrome-devtools` MCP: open the page, wait for
   `window.__PLAYGROUND_READY__ === true`, capture the canvas, and read the console for
   WebGPU validation errors. Use `?t=<seconds>` for reproducible, phase-locked shots.
3. **Reference-driven** when there's a visual target: drop the concept image on the page
   (or `?ref=/playground-refs/x.png&refMode=split`) and iterate the shader toward it.
4. Only after a clean screenshot + no console errors, port the proven effect into the real
   theme/chapter `createScene()` / materials.

Do not claim a WebGPU/TSL change is finished without a screenshot. ⚠️ One small effect per
session — full-journey WebGPU captures have TDR-crashed this dev machine's iGPU.

The `webgpu-threejs-tsl` skill (auto-activates on WebGPU/TSL work) is the TSL reference.
Full details: **[docs/WEBGPU_THREEJS_WORKFLOW.md](docs/WEBGPU_THREEJS_WORKFLOW.md)**.
Playground contract: **[src/playground/README.md](src/playground/README.md)**.

## AI SFX generation: use the shared local wrapper

When generating Serenity Blocks sound-effect candidates, use the shared Stable Audio 3 Small-SFX wrapper:

`C:\AI\sfx-foundry\generate-sfx.cmd -Set Zen -Event move -Variants 8`

Do not call Stable Audio directly from ad hoc commands unless you are repairing the wrapper itself. Full workflow:
**[docs/SFX_GENERATION_WORKFLOW.md](docs/SFX_GENERATION_WORKFLOW.md)**.

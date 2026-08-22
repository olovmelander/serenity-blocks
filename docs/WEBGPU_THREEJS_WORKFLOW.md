# WebGPU / Three.js Theme Workflow (best-practice, Claude Code)

This is the **idiomatic** way to build and iterate on visual themes in this repo. It
replaces the bespoke "photo → Theme Spec → scaffold" pipeline (removed 2026-06-14),
which added a code-generation layer nobody wanted to maintain. The new approach is just:
**author a theme by hand with expert WebGPU/TSL knowledge on tap, and look at the result
in a real browser via an MCP.**

Three things do the heavy lifting:

| Piece | What it is | What it gives you |
| --- | --- | --- |
| `webgpu-threejs-tsl` skill | A reusable skill (from [dgreenheck/webgpu-claude-skill](https://github.com/dgreenheck/webgpu-claude-skill), MIT) | Authoritative WebGPU + TSL knowledge: renderer setup, node materials, compute shaders, post FX, WGSL interop, device-loss handling. Reference docs + runnable examples + templates. |
| Chrome DevTools MCP | `chrome-devtools-mcp` (Google) | The agent opens `localhost`, screenshots the live `<canvas>`, and reads the console — the visual feedback loop that closes the agent's blindness. |
| The **playground** | `/playground.html` (this repo) | A standalone page that mounts ONE effect in isolation with HMR, deterministic time, a screenshot-ready signal, and a reference-image overlay. Iterate a shader in seconds, then port it into a theme. See [`src/playground/README.md`](../src/playground/README.md). |

There is **no** official Three.js or Khronos/WebGPU MCP (verified). This pairing is the
closest thing to a "best practice" stack.

### Setup: Claude Code is wired; Codex and Antigravity are not

Claude Code gets the MCP **from the repo**: [`.mcp.json`](../.mcp.json) declares
`chrome-devtools` using the `cmd /c npx` pattern Windows requires, pinned to a known-good
version. Because it is committed, a fresh clone has the visual loop with no per-machine
setup — approve the server once when Claude Code prompts, then reload the session. The
skill sits in `<repo>/.claude/skills/webgpu-threejs-tsl/`.

Codex and Antigravity read the same skill from `<repo>/.agents/skills/`, but neither has
the screenshot MCP wired up (verified 2026-08-19: `~/.codex/config.toml` declares only
`playwright`, and `~/.gemini/config/mcp_config.json` is empty) — so they cannot close the
visual loop through this MCP today. Antigravity's IDE has a native agentic browser and can
screenshot the playground without it. The playground itself is tool-agnostic.

---

## The loop (prompt-driven)

The fast path is **playground-first**: iterate the effect in isolation, then port it into
a theme.

```
1. Start it:        npm run dev:playground      (opens /playground.html)
2. Prompt the agent for an effect. The webgpu-threejs-tsl skill auto-activates and the
   agent authors src/playground/effects/<id>.effect.js (auto-registers, instant HMR).
3. The agent opens the playground via the screenshot MCP, captures the canvas, reads console.
4. (Reference-driven) Give it a target image; it screenshots its render vs. the reference
   overlay and iterates toward it — a measurable loop, not "looks cosmic-ish".
5. When it's right, port the proven effect into the real theme (createScene / materials).
```

The skill activates automatically when a request involves Three.js WebGPU, TSL, node
materials, or GPU compute. You can also force it (`/webgpu-threejs-tsl` in Claude Code).

### Why playground-first

Booting the whole game to a theme is slow and heavier on the GPU. The playground mounts a
single effect with no game boot, so each iteration is seconds. It exposes a deterministic
fixed time (`?t=`) and a `window.__PLAYGROUND_READY__` flag, so screenshots are
**reproducible and phase-locked** instead of catching a random animation frame.

### Driving the screenshot MCP

After `npm run dev:playground`, point the agent at the page, e.g.:

> "Open `http://localhost:5173/playground.html?effect=nebula-dome&t=8`, wait for
> `window.__PLAYGROUND_READY__`, screenshot the canvas, and check the console for WebGPU errors."

A WebGPU canvas renders fine under headed Chrome, so this is the reliable way to verify
the look without manual capture. ⚠️ Keep to a single small effect per session — full
WebGPU journey captures have TDR-crashed the dev iGPU.

---

## Reference-driven iteration

Turn vague visual prompts into a measurable target. You already generate concept art with
nano-banana / Imagen — feed it to the playground as the target and the agent iterates the
shader toward it:

1. Drop the image in `public/playground-refs/` (or just **drag it onto the playground window**).
2. Open with `?ref=/playground-refs/target.png&refMode=split` (modes: `overlay` blended
   with an opacity slider, `split` draggable wipe, `side` side-by-side).
3. The agent screenshots, compares render vs. reference, adjusts uniforms/nodes, repeats.

The loop becomes: **concept image → prompt → effect in the playground → screenshot vs.
reference → iterate → port into the theme.**

---

## Isolated playground (reference)

- Run: `npm run dev:playground` → `http://localhost:5173/playground.html`
- Author an effect: drop `src/playground/effects/<id>.effect.js` exporting `meta` +
  `create(ctx)` (it auto-registers). Two starters to copy: `nebula-dome` (backdrop) and
  `pulse-sphere` (object material). Full contract + URL params in
  [`src/playground/README.md`](../src/playground/README.md).
- Decoupled from the game on purpose: it reuses only the leaf utils `computeScenePixelRatio`
  + `gpuResilience` and does **not** touch `BaseTheme`, theme DOM containers, or the eventBus.
- Production build: `playground.html` is registered in `vite.config.js`
  (`build.rollupOptions.input`) so `vite build` emits `dist/playground.html`.

---

## Authoring a theme (the repo conventions)

A theme is **authored code**, not generated. The contract:

- A class extending [`BaseTheme`](../src/themes/base-theme.js) in
  `src/themes/<id>/<id>-theme.js`, implementing `createScene()` and
  `getTetrominoConfig()`. Use the static container `document.getElementById('<id>-theme')`
  — **never** `this.getContainer()` for the static div (that registers it for deletion in
  `BaseTheme.cleanup()` and breaks the second load).
- WebGPU/TSL themes import `WebGPURenderer` from `three/webgpu` and build materials with
  TSL nodes. See existing examples: [`astral-weave`](../src/themes/astral-weave/),
  [`black-hole`](../src/themes/black-hole/). For WebGL + raw GLSL themes, the pattern is
  the same minus the node materials.

### Three wire-in touch-points

1. **Registry** — add an entry to `RAW_THEME_REGISTRY` in
   [`src/themes/theme-registry.js`](../src/themes/theme-registry.js)
   (`{ id, displayName, module, group, icon }`). If it's a heavy WebGPU/compute theme,
   also add its `id` to `HEAVY_GPU_THEME_IDS` (gates it out of startup-eligible / light
   resource profile).
2. **Loader** — nothing to do: `theme-manager.js` lazy-loads via
   `import.meta.glob('./**/*-theme.js')`, so a correctly-named `<id>-theme.js` is picked
   up automatically.
3. **Container** — add `<div id="<id>-theme" class="theme-container"></div>` to
   `index.html`.

Plus an icon and the tetromino piece config (`getTetrominoConfig()`).

### Shared utilities to reuse (don't reinvent)

`assetManager`, `eventBus` / `EVENTS`, `gpuResilience`, `computeScenePixelRatio`,
`BaseTheme.safeAnimate`. For asset loading: KTX2 textures transcode via the bundled
`./basics/basis/` transcoder (vendored from `three/examples/jsm/libs/basis/`); GLBs load
with `GLTFLoader` (+ `KTX2Loader` / `MeshoptDecoder` as needed). `neon-district` is the
working precedent for KTX2 asset loading.

---

## Where assets come from (optional)

Authoring is code-first. When a theme needs **art** (a backdrop, a prop GLB), the C:\AI
workspace is still wired up as MCP servers (`comfyui`, `blender`):

- **Backdrops / textures** → ComfyUI MCP (FLUX/Qwen → export, transcode to KTX2 if large).
- **3D props** → Blender MCP (also fronts Poly Haven / Sketchfab / Hyper3D), or
  hand-import CC0 GLBs.

**Licensing is a hard rule:** only commercial-safe assets — CC0, CC-BY (with attribution),
MIT, Apache. The user is in the EU, so Tencent/Hunyuan-licensed models are off-limits.
Record provenance + license in a per-theme `ATTRIBUTION.md` next to the asset (the
`ocean` theme is the format precedent). GLB optimization: `gltfpack` quantize-only
(KHR_mesh_quantization, native three support); avoid `-tc` unless you've verified the
`./basics/basis/` transcoder ships, or the KTX2 worker 404s and the GLB load hangs.

---

## Skill contents (for reference)

```
.claude/skills/webgpu-threejs-tsl/
  SKILL.md          # entry point, auto-loaded
  REFERENCE.md      # API quick-reference
  docs/             # core-concepts, materials, compute-shaders, post-processing,
                    #   wgsl-integration, limits-and-features, device-loss
  examples/         # basic-setup, custom-material, earth-shader, particle-system, post-processing
  templates/        # webgpu-project, compute-shader
```

Updating the skill: re-pull from the upstream repo and copy
`skills/webgpu-threejs-tsl` over `.claude/skills/webgpu-threejs-tsl`.

---
name: webgpu-threejs-tsl
description: Three.js WebGPU + TSL reference (node materials, compute shaders, post-processing) verified against this repo's pinned three r181. Use when creating or changing any visual surface — a theme (src/themes), a playground effect (src/playground/effects), an Odyssey chapter (src/rendering/odyssey) — or when working with shaders, particles, glow/bloom, reflections, auroras, GPU compute, node materials, or debugging WebGPU validation errors and TSL compile failures. Not for Phaser 2D code, DOM/CSS UI, Electron shell, or audio work.
---

# WebGPU Three.js with TSL (three r181)

TSL (Three.js Shading Language) is a node-based shader abstraction: you write GPU
shaders in JavaScript instead of GLSL/WGSL strings. Every visual surface in this
repo (themes, playground effects, Odyssey chapters) is WebGPU/TSL.

**Version contract:** this repo pins `three@0.181.x`. Everything in this skill was
verified against that version. TSL churns fast between releases — when an API is in
doubt, the source of truth is `node_modules/three/src/Three.TSL.js` (TSL exports)
and `node_modules/three/src/Three.WebGPU.js` (renderer/material exports), not your
training data and not the three.js wiki.

## Workflow (non-negotiable)

Iterate in the playground, screenshot to verify, then port. The full loop, the
screenshot requirement, and the ⚠️ TDR hazard (one small effect per session — full-journey
captures have crashed this machine's iGPU) are defined in CLAUDE.md and
`docs/WEBGPU_THREEJS_WORKFLOW.md`; the drop-in effect contract is `src/playground/README.md`.
This skill covers the API layer only — it does not replace that workflow.

## Quick start

```javascript
import * as THREE from 'three/webgpu';   // NEVER plain 'three' for WebGPU work
import { color, time, oscSine, Fn, uniform } from 'three/tsl';  // every TSL fn must be imported

const renderer = new THREE.WebGPURenderer({ antialias: true });
await renderer.init();                   // before first render/compute

const material = new THREE.MeshStandardNodeMaterial();
material.colorNode = color(0xff0000).mul(oscSine(time));  // oscSine already returns 0..1
```

Post-processing in r181 is `THREE.PostProcessing` — **`THREE.RenderPipeline` does not
exist here** (that rename lands in r183). Copy the working repo pattern, e.g.
`src/themes/wolfhour/wolfhour-post.js`:

```javascript
import { pass } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';

const post = new THREE.PostProcessing(renderer);
const scenePass = pass(scene, camera);
const scenePassColor = scenePass.getTextureNode('output');
post.outputNode = scenePassColor.add(bloom(scenePassColor));
post.render();                            // instead of renderer.render()
```

## Gotchas this repo has already paid for

Check this table before debugging "shader looks wrong / nothing renders / slow".

| Symptom | Cause | Fix |
|---|---|---|
| `THREE.RenderPipeline is not a constructor` | r183 API in r181 code | Use `THREE.PostProcessing` |
| `X is not defined` in effect code | TSL functions are not globals | Import every identifier from `'three/tsl'` (incl. `Fn`, `If`, `Loop`) |
| Instanced mask/displacement lands in wrong space | In r181, InstanceNode reassigns `positionLocal` **before** your `positionNode` runs | Use `positionGeometry` for instanced local-space masks |
| Instanced/point particles invisible or collapsed to a dot | `positionNode = buffer.element(instanceIndex)` replaces *every vertex* with one point | `positionLocal.add(buffer.element(instanceIndex))`, or the `vertexNode` billboard pattern in `src/themes/winter/rendering/snow-renderer.js` |
| Conditional write silently ignored | JS variable reassignment inside `If()` — TSL can't see `x = x.add(1)` | `.toVar()` + `.assign()`, or `select()` — see `docs/core-concepts.md` § Control Flow |
| Mask/fade is constant 0 | Reversed `smoothstep(hi, lo, x)` argument order | `smoothstep(lo, hi, x)` — it does not auto-swap |
| Effect "disabled" but GPU cost unchanged | Multiplying by a 0-value uniform is NOT dead-code-eliminated | Gate in JS (skip the pass / swap the node), not with shader zeros |
| Per-frame uniform upload you didn't intend | Mutating a `THREE.Color`/`Vector` inside `uniform(...)` in place still uploads every frame | Fine when intended; don't assume unchanged-value writes are free |
| Oscillation stuck in upper half | `oscSine` already returns 0..1 | Drop the `.mul(0.5).add(0.5)` remap |
| Emissive-only (selective) bloom does nothing | Selective bloom needs MRT; most themes here run bloom on the composite without MRT | Check the theme's `useMRT` before promising selective bloom; see `docs/post-processing.md` § MRT |
| First-visit hitch despite `compileAsync` | `compileAsync` doesn't cover post-`PassNode` / first-update paths | Warm by actually rendering once (see Odyssey warm-up) |
| Backgrounded tab burns GPU | Loop keeps computing/rendering when hidden | `shouldRenderFrame()` gate + clamp `delta` in the update loop (pattern in every theme) |
| Works in dev, black in packaged Electron | Absolute `/assets/...` fetch resolves to filesystem root under `file://` | Use relative `./assets/...` |

## Doc map — read on demand, not up front

- `docs/core-concepts.md` — types, operators, uniforms, control flow. Read when writing
  any nontrivial TSL, and always for conditionals/mutation (`If`/`toVar`/`select` rules).
- `docs/materials.md` — every `*NodeMaterial` and node property. Read when choosing or
  configuring a material.
- `docs/compute-shaders.md` — storage buffers, compute passes, atomics, GPU↔CPU readback.
  Read for particles/simulation work.
- `docs/post-processing.md` — PostProcessing, `pass()`, MRT, every r181 display effect
  with verified import paths. Read for bloom/grade/DoF/etc.
- `docs/noise-and-utility-nodes.md` — built-in noise (mx_* / triNoise3D), per-instance
  variation, billboarding, UV/blend utilities. Read BEFORE hand-rolling noise or
  desync logic for any theme effect.
- `docs/scene-techniques.md` — reflector() mirrors, soft particles, GPU feedback
  textures (trails/ripples), in-playground grade preview, fake lighting for unlit
  scenes, glass refraction, height fog. Read when building or upgrading a theme's
  hero visual.
- `docs/performance.md` — this repo's perf playbook: GPU timestamps, frame gating,
  fill-rate triage, TSL cost traps, tier scaling. Read before ANY perf pass and
  after adding a heavy effect.
- `docs/wgsl-integration.md` — `wgslFn` for raw WGSL. Read only when TSL can't express it.
- `docs/device-loss.md` — GPU device-loss recovery. Read when the iGPU TDRs or the
  renderer dies mid-session.
- `docs/limits-and-features.md` — `requiredLimits` for big buffers. Read when compute
  buffers exceed ~128 MiB or you hit limit validation errors.
- `REFERENCE.md` — one-page cheatsheet of the above.
- `examples/`, `templates/` — standalone-app scaffolds. For repo work prefer real code:
  a playground effect (`src/playground/effects/*.effect.js`) or a theme's `-post.js` is
  always closer to the target than a generic template.

## Verification checklist (before claiming done)

1. Playground screenshot via chrome-devtools MCP (`?effect=<id>`, wait for
   `window.__PLAYGROUND_READY__`, use `?t=<seconds>` for phase-locked shots).
2. Console clean — zero WebGPU validation errors or TSL compile warnings.
3. If you touched a material/pass shared across quality tiers, sanity-check one low tier.
4. Port to the real theme/chapter only after 1–2 pass in isolation.

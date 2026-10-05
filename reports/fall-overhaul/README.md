# Fall — amber glade visual overhaul

> **Superseded 2026-10-05.** This report describes the "amber glade" rebuild that shipped in #335. The theme was
> rebuilt again as the enchanted grove; the artwork, event language and modules described below no longer exist.
> Current record: [docs/FALL_ENCHANTED_GROVE_OVERHAUL_2026-10.md](../../docs/FALL_ENCHANTED_GROVE_OVERHAUL_2026-10.md).
> The captures in this folder are kept as the "before" evidence.

The Fall background now places the player inside an autumn grove: sculpted trunks and
roots frame a winding, leaf-covered path, gold and crimson maple crowns bridge overhead,
and layered woodland fades into cool blue-grey mist. A broad offscreen sunset glow and
soft shafts illuminate the clearing without adding a visible sun disc. Geometry-backed
maple silhouettes, fern fronds, grass, stones, tumbling leaves and luminous dust give the
foreground and distance distinct scales of detail.

The central clearing stays open behind the board. Portrait framing moves the camera
back and widens its vertical field of view; nearby trees and hanging boughs retain the
canopy arch on narrow screens. Dense foliage, continuous background silhouettes and restrained ground dapples keep
the scene coherent at every distance.

## Gameplay response

| Trigger | Visible response |
| --- | --- |
| Piece lock | A short, restrained leaf lift with a small gust and warm glint. |
| Line clear | Leaves lift from both outer edges; larger clears increase the warm clearing light and canopy shafts. |
| Combo | Paired spiral leaf cascades and fine harvest wind strands grow with the combo, accompanied by stronger wind, warmth and dust glow. |

Effects reuse a fixed pool of prebuilt burst meshes. Slots expire in simulation seconds,
and light/wind envelopes decay exponentially with elapsed seconds rather than frame
counts. The theme respects the background effects and piece-lock settings, pauses hidden
rendering, clamps resumed deltas, and keeps gameplay simulation untouched.

## Rendering and ownership

- Both native WebGPU and the forced WebGL2 backend use the same `three/webgpu` node
  materials, TSL artwork and event director under Three.js 0.186.1.
- Medium through Extreme use restrained bloom and grading through `RenderPipeline`.
  Low and Minimal render the same scene directly with ACES tone mapping and reduced
  scenery/particle budgets, without a post-processing pipeline.
- Trees are baked geometry; crowns, ground leaves and understory are instanced. Wind
  and leaf motion run in vertex nodes. Instance placement survives r186 ordering by
  deriving geometry masks from `positionGeometry` and preserving `positionLocal`.
- The theme owns its renderer, animation, event subscriptions and recovery registration.
  The world owns scenery, materials, burst slots and scene fog; the forest owns its
  procedural resources. Cleanup releases these owners and the post-processing targets,
  removes the canvas through the renderer lifecycle and restores world-owned fog.

## Visual evidence

| Capture | Surface |
| --- | --- |
| [native-idle.png](native-idle.png) | High, native WebGPU, idle grove. |
| [native-combo.png](native-combo.png) | High, native WebGPU, combo celebration. |
| [phone.png](phone.png) | Portrait, Low, forced WebGL2, direct scene rendering. |
| [production-desktop.png](production-desktop.png) | Integrated production theme, desktop. |
| [production-phone-combo.png](production-phone-combo.png) | Integrated production theme, portrait combo. |

The isolated WebGL2 capture matrix covers idle, combo, portrait Low, Minimal and board
composition. Its [capture-results.json](capture-results.json) reports ready states with
no captured errors or warnings. The [production matrix](production-results.json) verifies actual board rendering,
bounded events, pause suppression, resume, complete retirement and a fresh return to
Fall on desktop and portrait Low, with zero errors or warnings. Event screenshots
advance 0.7 simulation seconds while paused; live animation is checked separately.
Native [idle](native-idle.json) and
[combo](native-combo.json) checks report clean validation and console error lists.
The focused Fall tests currently total **70 passing tests** across the reaction,
artwork and theme lifecycle suites (15 + 18 + 37). Validation on 2026-10-05 passed all
5,790 repository tests before the concurrent Crystal Cave merge. After integrating
main at `4236bb79`, the combined run passed 5,858 of 5,859 tests (539 of 540 files).
The only failure was the unchanged Odyssey cloud-field bake-time check: 1,558 ms
against its 1,500 ms budget while browser and build checks ran concurrently. After
those checks finished, the unchanged cloud-field file passed all 12 tests in
isolation; its bake-budget test took 538 ms. The budget was not changed.
Type checking, production build/boot closure, the ESLint error-count ratchet
(1,133 errors, with the ceiling lowered to that count), dependency boundaries,
theme lifecycle audit and release gates passed on the combined tree. Fresh
[post-merge game checks](production-postmerge-results.json) passed desktop High and
portrait Low, including gameplay, event effects, pause/resume, complete cleanup
and fresh reactivation, with zero errors or warnings. Fall passes the
palette gate; its repository-wide result remains blocked by the existing Stillwater
full hue mapping. No Stillwater source was changed.

Native evidence was obtained with offscreen Chrome 153, software Vulkan and render-target
readback. It verifies actual WebGPU shader validation and rendered pixels; it does not
establish physical-GPU FPS or a hardware performance improvement. These checks do not benchmark physical desktop or phone GPUs.

## Reproduce the isolated shots

Run `npm run dev:playground`, open the matching URL and wait for
`window.__PLAYGROUND_READY__ === true`. `seed=271` fixes procedural placement and `t=8`
phase-locks animation; combo shots use event age 0.75 seconds and combo count 8.

- [Native idle](http://localhost:5173/playground.html?effect=fall&seed=271&t=8&quality=High&orbit=0)
- [Native combo](http://localhost:5173/playground.html?effect=fall&seed=271&t=8&quality=High&event=combo&eventAge=0.75&combo=8&orbit=0)
- [WebGL2 idle](http://localhost:5173/playground.html?effect=fall&seed=271&t=8&quality=High&forceWebGL=1&orbit=0)
- [WebGL2 combo](http://localhost:5173/playground.html?effect=fall&seed=271&t=8&quality=High&forceWebGL=1&event=combo&eventAge=0.75&combo=8&orbit=0)
- [Portrait Low](http://localhost:5173/playground.html?effect=fall&seed=271&t=8&quality=Low&forceWebGL=1&orbit=0), with a 390 × 844 viewport.
- [Minimal](http://localhost:5173/playground.html?effect=fall&seed=271&t=8&quality=Minimal&forceWebGL=1&orbit=0)
- [Board composition](http://localhost:5173/playground.html?effect=fall&seed=271&t=8&quality=High&forceWebGL=1&board=1&orbit=0)

For production-preview checks, build and run `npm run preview`; the same isolated URLs
are available on port 4173, while the integrated theme is selected through the game.

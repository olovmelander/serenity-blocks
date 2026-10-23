# Theme shader audit: per-object values read interpolated (2026-10-23)

**A record.** This follows up
[STILLWATER_FAR_TREES_AND_VESPER_FLASHES_2026-10-23.md](STILLWATER_FAR_TREES_AND_VESPER_FLASHES_2026-10-23.md).
The two faults found there were hunted for across every theme and the Odyssey, and the hunt
turned up three more bugs. It was checked the same way: headless Chromium on SwiftShader, with the
playground captured before and after each fix (WebGPU, High, 1920 × 1080, `t=12`).

## 1. The black flash on a save: five more themes

Every settings save carries `renderScale`, and a theme that resized on it set its canvas's size
again outside the frame loop, leaving it blank until the next frame. Five themes did this and the
first sweep missed them:

- **Aurora, Black Hole and Crystal Cave** test `detail.settings?.renderScale !== undefined`
  themselves rather than through the helpers the first sweep searched for. Their `resize()`
  already compares size and pixel ratio; the handler no longer clears `appliedSize` first.
- **Blood Moon's and Sunfall's** `resize()` set the pixel ratio and the size on every call. They
  now do so only when either changes:
  - the check uses `appliedSize`, cleared with the renderer;
  - the rest of `resize()` (post, board viewport) still runs every time.

Each of the five gains a test that fails on the old code. Every theme now sizes its canvas on a
save only for a real change of size or pixel ratio:
- 58 of the 63 do it through their settings handler and a same-size guard;
- Wolfhour listens only to the diffed window `settingsChanged`;
- Chromadelic Highway, Neon Dusk, Nimbus Veil and Synthwave Sunset don't listen for the render
  scale at all. They pick a new one up at the next resize, as the next section's dynamic
  resolution does for every theme.

## 2. Per-object values read interpolated

**The fault** is the one behind Stillwater's speckled crowns. In TSL, an `attribute()` read in the
fragment stage becomes a perspective-interpolated varying (three r186, `AttributeNode.generate`).
A value that is the same at a triangle's three corners (a seed, a kind, an index) then arrives a
few bits off, differently at each pixel. Smooth use doesn't care, but these do:

- a chaotic hash (`fract(sin(x) · 43758.5453)` and friends) gives a different number per pixel;
- a `floor`, `toInt`, `fract` or exact `equal` on a whole number gives the wrong one at scattered
  pixels: 4.0 arrives as 3.9999998.

**How it was audited.**
- Four read-only passes covered `src/themes` (a–g, h–r, s–z) and `src/rendering` with `src/ui`.
- Every finding was re-read in the code before changing anything.
- The visible ones were captured before and after; the table gives pixels changed by more than 6
  of 765.
- Anything not named here was found clean: most themes hash in the vertex stage, or round, or test
  with half-integer margins.

**The fix pattern.** `src/themes/shared/flat-varying.js` exports `flatVarying(node, name)`, which is
`varying(node, name).setInterpolation('flat', 'either')`. Where a value is only used as a whole
number, the fix rounds it first with `floor(x + 0.5)` instead.

| Theme | What showed | Fix | Captured |
|---|---|---|---|
| Rainbow Terraces | Glitter in every fall but slot 0: each rope's width, brightness, comet and main strand re-rolled per pixel (`scHash21` of the fall's slot) | Flat slot | 846 px, the right island's falls ([image](theme-shader-audit/rainbow-terraces-falls.png)) |
| Luminous Tides | A dithered fringe crawling along every palm frond (each leaflet's length hashed from the palm's seed per pixel) | Flat seed | 2,983 px along the fronds |
| Neon District | Logos 4, 8 and 12 (LEVEL GYM, HALE, the café's cup) drawn from the wrong atlas cell at scattered pixels: holes and fragments in bright tube logos | Cell index rounded | 467 px, the HALE wall sign ([image](theme-shader-audit/neon-district-logo.png)) |
| High Coast | Dark speckles in the backlit sails and grey ones on the deck houses (exact `equal` on the part tag); red specks on the black roofs (`fract` of 2.0) | Flat part tags | 911 px, a sail ([image](theme-shader-audit/high-coast-sail.png)) |
| Thermal Bloom | The ghost pines' branch stubs ragged and speckled (heights, sides and lengths hashed per pixel); drops, spray and motes flashing in part | Flat tree, ids and seed | 2,804 px on the pines |
| Stillwater | Grain on the ferns' and reeds' tone, and straw speckle on about 2% of reeds; the lily pads' tone (latent) | Flat seeds | 277 px |
| Summer, Verdant Hills | Wrong-colour pixels on butterfly wings (palette index truncated by `toInt`) | Index rounded | 110 and 246 px |
| Synthwave Sunset | Every third and fifth wheel bulb on its index's wrap, so pink or mint bulbs burned warm and flickered as the eye drifted; the bulb field's twinkle seed error, multiplied by time, grew into a fizz | Flat wheel bulb; the field's seed hashed once, flat | 567 px at `t=12`, 465 at `t=600` |
| Vesper Chrysalis | Dew beads on the silk half-formed (bead choice hashed from the thread's seed × 977) | Flat seed | 1,159 px along the threads |
| Wolfhour | WebGPU compute path: a debris sprite drawn from two particles' data (a floored offset one low) | Offset rounded | Not captured: debris shows only after a strike |
| Voltage Storm | Bolt beads and tremble hashed from a rib's seed per pixel (about 1%) | Flat rib seed | Not captured: no bolt at `t=12` |

**Not changed:**
- **Earth Core's basalt columns** hash a facet's interpolated normal, giving about 1% brightness
  jitter (up to 5–7% at a few pixels) under the material's own ±25% grain.
- **Latent cases** that the current seeds never trip, checked against the data: Sunbraid, Sunfall,
  Tornado, Void Ember, the Odyssey's world motes, forest and stars, the breathing worlds and the
  intro motes.

## 3. Three more bugs the hunt turned up

- **Astral Weave's line clears.** The game resolves a lock and the clear it makes in one step
  (`game.js` calls the physics right after `onPieceLock`, and nothing is awaited before
  `onLineClear`). A full row is always one the locking piece filled. The lock weaves its rows top
  to bottom, each a beat (0.05 s) after the one above, so every cleared row after the first had its
  clear stamped *before* its weave. The loom's `cleared` test (`clear ≥ weave`) failed, and
  `keepEmber` dropped the row at the shift. In practice, most clears (a flat T clears its lower
  row) showed one burning row, or none, and rows that were woven fresh, then vanished.
  - **Fix:** `clear()` pulls a still-to-be-woven row's weave back to now, as the first row already
    had it.
  - **Test:** a four-row lock and clear in one step, failing before: "expected 10 to be ≥ 10.05".
- **Crystal Cave's glints.** Each glint's tint switched between family colours with
  `smoothstep(i − 0.5, i + 0.5, family)`, but families are whole numbers, so families 1–4 came out
  half the colour of the family below. It now uses `step` at the half-integers. Captured: the
  amethyst glints take their own colour.
- **The Odyssey city in WebGPU compatibility mode.** Twelve flat varyings (neon signs, skybridges,
  Urban Dreams facades) used `.setInterpolation('flat')`, which WGSL reads as `flat, first`. three
  requests a compatibility adapter and turns on `core-features-and-limits` where the adapter has
  it, so core GPUs are fine. On a compatibility-only adapter, Dawn rejects the pipeline:
  - **Tested** in Chromium: "The interpolation sampling (First) of the vertex output at location 0
    is not supported in compatibility mode". `flat, either` passes.
  - **Fix:** all twelve now say `'either'`. The values are the same at every corner, so nothing
    changes on a core GPU.

**Smaller:**
- The Steam gating test undoes its per-test mock with `vi.doUnmock`. `vi.unmock` is hoisted, so it
  ran once before any test, and Vitest warns it will become an error.
- A comment in `earth-core.tsl.js` no longer quotes the PURE annotation that Rollup warned it could
  not place.

## 4. Follow-up: a render scale the desktop policy sets reaches the theme

**The gap.** `applyDesktopPerformancePolicy` changed the global render scale but emitted no
settings event. It runs for the desktop policy's startup pick, the Electron dynamic resolution
loop (which runs while the FPS overlay is on) and a GPU health update. Only Wolfhour listened for
`desktopPerformancePolicyChanged`, so the other themes kept their old pixel ratio until the window
resized. So did the four themes above that never listen for the render scale.

**The fix.** The policy and the display settings set the scale through one function,
`applyGlobalRenderScale(scale, themeManager)` in `base-theme.js`, beside `setGlobalRenderScale`.
It lives there to keep main.js within its line ratchet. When the scale really changed, it resizes
the active theme (`themeManager.resize`). Each theme's `resize()` compares the pixel ratio, so a
theme that had already followed the change does nothing.
- An earlier draft of this record said Wolfhour would then resize twice. It wouldn't: Wolfhour
  doesn't override `resize()`, and keeps following the policy through its own listener.
- **Test:** `display-settings-apply.test.js` "hands a new render scale to the active theme, and
  only a new one", which fails on the old main.js.
- **In the game** (a single-player run on Forest at 640 × 360):
  - the display settings at 0.5 took the canvas to 320 × 180;
  - the desktop policy at 0.75, applied as its dynamic loop applies it (`persist: false`, no
    settings event), took it to 480 × 270;
  - before the fix, setting the scale alone, as the policy did, left it at 640 × 360.
- **Still open:** at the menu no theme is the active one, so a change there reaches only the
  themes that listen for settings. The dynamic resolution loop only runs during a game.

## 5. Open

- **The production build** needs more than a 2 GB Node heap (`vite build` runs out of memory in an
  environment that defaults to that; CI's runners are larger).
- **The `chrome-devtools` MCP** is configured to start through `cmd` (Windows), so it cannot run in
  a Linux cloud session.

## Checks

- **Unit tests:** the full suite, including the seven new tests (Aurora, Black Hole, Crystal Cave,
  Blood Moon, Sunfall, Astral Weave and the render-scale hand-off). The Urban Dreams test that checks the city's flat inputs
  now requires `flat, either`.
- **Lint:** the ratchet at its baseline, with no file gaining an error or a warning.
- **Captures:** thirteen views before and after the fixes, with no WebGPU or console errors. The
  shared helper's refactor of the two first fixes is pixel-identical.
- **Not done:** nothing was run on a GPU. Worth a look on the laptop: Rainbow Terraces' falls, the
  Luminous Tides palms, Neon District's signs, High Coast's sails, and an Astral Weave line clear.

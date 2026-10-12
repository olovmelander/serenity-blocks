# Painted Ages — implementation record

The owner requested Painted Ages as an additional theme on 2026-10-12. The implementation starts from `main` at `429a2ff`; every existing theme, song and Odyssey orb is retained. Rainbark's adapter and director are used as source templates only, without merging its retirement of Cosmic Chimes.

Painted Ages is collected by completing all eight orbs in Chapter 4, Mountains & Thin-Air Ascension. This uses the collection service's existing chapter bonus route and quiet reconciliation for completed saves. The campaign remains 60 orbs; the catalogue becomes 62 themes and songs. Its placeholder song is the existing licensed placeholder recording, copied byte for byte. No new SFX or music is generated.

For a local preview, run `npm run dev` and open `/playground.html?effect=painted-ages&t=40&level=3&board=1`. To try the collected theme in the game, open `/?unlockAll=1&skipIntro=1` and select Painted Ages.

The implementation follows [the theme playbook](theme-concepts/PLAYBOOK.md) and [the revised concept](theme-concepts/painted-ages.md), especially its morning light, sediment record and world-space weather.

## World and game behavior

The theme and `painted-ages` playground effect mount the same world and post pipeline. The installed Three.js 0.186.1 is retained. A single `WebGPURenderer` supports WebGPU and its WebGL2 backend. All materials are TSL node materials. The six quality tiers retain every gameplay beat while scaling geometry and fixed effect pools. There are no runtime asset downloads, classic shader materials, camera-space rain, sun discs, shafts or heat distortion.

The terrain is an asymmetric hogback heightfield with unequal saddles, connected V gullies, long resistant spines, a shared far face, a central plum wash, dust-covered dip slopes, exposed scarps, obsidian and sulfur patches. The geological datum follows the terrain’s strike and dip: broad slopes expose dominant mineral beds while scarps cut through neighboring layers. Larger iron, cream and grey-green packages organize the far face. Raking morning light, world-space horizon shadows, concavity shading, rock bounce and cool sky fill separate the ridge ranks. Height-dependent aerial perspective clears high crests while retaining low wash dust. Unequal lenticular plates, a distant asymmetric rain bank and two bent steam plumes give the landscape scale; a terrain-following boardwalk, merged talus stones and sparse thorns provide foreground cues.

The CPU lab and subsequent graphics pass compared procedural renders with Zhangye and Hornocal reference photographs. Review rejected repeated teeth, isolated smooth domes and contour bands unrelated to the slope. The final runtime prepares a bounded 352×352 displacement field with 40 D8 stream-power passes, retains resistant crest shoulders, and samples it through the same height function used by ground effects. Height buckets replace repeated comparator sorts. Ten samples toward the light derive local horizons from the existing view-fan mesh. Reference photographs remain outside the repository; sources are cited in the concept’s reference section. This is a procedural interpretation of the references, not a reconstruction of either site.

The game prepares terrain in a one-shot module worker. Success, failure, timeout and cancellation terminate the worker and remove its listener. A failed worker has a complete, smaller analytic terrain fallback with zero erosion displacement; it never runs the erosion simulation on the animation thread. The synchronous bake remains available for unit tests and the playground's synchronous creation contract. A completed worker payload includes typed geometry, drainage and erosion arrays. The restored height sampler directly retains its transferred erosion field, so cache eviction cannot cause a second bake. Field and site caches are bounded and distinguish the analytic fallback.

Land also uses a generated, mip-filtered 256×256 half-float relief texture carrying height, analytic gradients and roughness. The gradients avoid texel-edge normal discontinuities; pixel-footprint filtering removes distant detail. Bounded GGX highlights distinguish rough minerals, damp rock and polished obsidian, with nonnegative clamped inputs. The texture is omitted on Minimal and disposed with the land. Meltwater braids have gravel contact edges, uneven widths, local flow glints and a subpixel coverage fade; fumaroles use layered advected density and sunward scattering.

Each cleared row writes its ten cell pigments into a 16×512 linear RGBA8 mineral ring. A bounded journal and checkpoint support deterministic capture seeks after wrapping. Natural mineral beds dominate dry terrain; player pigments occupy narrower laminae and recover chroma when wet. Nearest-filtered texture reads blend to bed means at distance. The renderer uploads the small full texture after a write; it does not rely on unsupported partial updates.

Locks and hard drops follow baked downhill chutes into persistent talus fans. Clears alternate deposition fronts, settle segmented slurry, bury fans, and step the near strata with a 0.6-second ease and 3% overshoot. Far strata and reduced-motion views crossfade over 0.3 seconds. Four-line clears trigger sediment-bearing channels and short falls. True combo depth moves rain through the ridge ranks; the director keeps cascade depth separate. Release returns light at every peak, with a physical antisolar primary bow only at peak 5+, a secondary at 6+, and additional fringes at 8+ on higher tiers. Sunlit wet rock dries with a 35-second time constant and shadowed rock with 70 seconds.

Back-to-back clears retain up to four fold steps. T-spins turn striped pinnacles out of the slope on the locking piece's side. Perfect clears put the record's colors into a nine-plate cloud stack. Level transitions tilt the strata and insert pale marker beds; modes without level events advance after each fifteen deposited lines. Game over flushes staged and queued clears before appending one tuff seal, lowers the sun over six seconds, and starts pale ashfall. Morning returns over four seconds. The completed record survives into the next game and is buried by later play.

Live card and HUD rectangles mask event effects and deposition motion; post grading calms the land under the UI. Portrait views use ten ground-aligned chutes below the card. Quality changes and GPU recovery preserve the ring, queued deposits, last locking column, weather clocks, fans, floods and pinnacles. Theme teardown aborts preparation and disposes the world, renderer and post.

## Palette and icon

The seven piece colors are the revised concept's exact mineral palette. The conventional hue-band gate is 0/7. Machado full-severity simulation with CIEDE2000 gives minimum pair distances of 21.75 normally, 13.17 for protanopia, 17.00 for deuteranopia and 14.12 for tritanopia. The lowest pair is turquoise T against rose J under protanopia. These values reproduce the concept's candidate table. The final real-game board was also inspected under all three simulations.

The icon is a real 720×720 world capture, processed by `scripts/process_icons.py` into a 512×512 RGBA circle. The source and public mirror are byte-identical. The selected frame uses `icon=1&iconFov=35&iconYaw=-10&iconPitch=-5&wet=.5&parts=sky,land`; it was inspected at the picker's 80-pixel size beside Himalayan Peak, Shifting Sands and Parhelion. The cloud refinement refreshes the world capture and picker comparison.

## Cloud refinement

The final cloud pass gives the standing stack unequal rounded plates, deeper shadows between layers, and tapered vapor tips. Analytic ray intersections and sun-exit distances shade their volume without a ray march. The distant rain bank combines six overlapping analytic volumes into one coherent asymmetric body, with a dominant rounded crown, smaller shoulders and a low trailing edge. Its density and lighting blend across the overlaps; the existing virga remains beneath it.

A generated 128×128 RGBA8 linear-data field carries broad density, its analytic gradients and finer erosion. Its eight explicit CPU-generated mip levels occupy **87,380 bytes**. The field replaces the previous cloud texture in the same sky material; there are no new draw calls, render passes or intermediate targets. Every tier disposes the sky geometry, material and owned cloud texture once while retaining the borrowed mineral-record texture. All six tiers build on both backends. The largest generated sky fragment is **21,839 bytes of WGSL / 20,558 bytes of GLSL**, with three uniform buffers, two textures and one WGSL sampler. The High-tier erosion lookup is materialized before the six-lobe loop; neither backend emits a texture read inside `rainLobe`.

The approved land, mineral palette, sky gradient and rainbow treatment are preserved. Before/after image checks find **zero differing pixels in the ground region at y ≥ 350 and in the clear upper-left sky probe**. The changed clouds retain the existing world-space framing, weather controls and perfect-clear mineral coloring.

The cloud pass passes **12 focused files / 247 tests**. After hoisting the shared erosion sample, the scoped shader and CPU-field rerun passes **19 tests**, and changed-file ESLint is clean. Fourteen final scenes cover desktop and phone on both backends, including WebGL2 Low weather and WebGPU Minimal perfect clear, together with the refreshed collection icon. The final production build with the refreshed, mirrored icon passes in **24.92 seconds**, including boot closure; the shipped IP-string and Pages-artifact checks also pass.

## Stair refinement

The former widely spaced slabs are rebuilt as a connected timber stairway with short flights and level landings on the near ridge. Treads sit on continuous stringers; support posts reach the surface actually drawn at the active terrain quality. Crossbeams, diagonal braces and gently sagging rope handrails complete the construction. Right-handed beam frames keep their face normals outward. A bounded slope-aware route stays within the left-hand scale-cue area and ends at a guarded overlook. At High quality, the default seed produces 16 flights and 17 landings. Across all six tiers, each tread run is at least 0.29 m and each rise is at most 0.19 m.

Timber has restrained per-board variation, lengthwise grain, darker joints and undersides, terrain-horizon shading and a small wet highlight. A 128×128 RGBA8 field has eight CPU-generated mips (87,380 bytes); Minimal retains the geometry and material colors without allocating the texture. Stairs, talus and shrubs still share one mesh/material. No render pass is added, and the material owns and disposes its field.

Construction references: [Fermanagh stairway](https://commons.wikimedia.org/wiki/File:Stairway_To_Heaven,_Co._Fermanagh.jpg) and [Cherokee Sink boardwalk](https://commons.wikimedia.org/wiki/File:Cherokee_Sink_boardwalk_up.jpg). Reference photographs remain in the scratch workspace and are not shipped.

The merged detail geometry ranges from 37,422 vertices / 2,095,632 bytes on Minimal to 68,262 vertices / 3,822,672 bytes on Extreme; High uses 62,124 vertices / 3,478,944 bytes. Land remains two material draws. Both generated detail shaders stay below 6.1 KB. All owned resources dispose exactly once, and the borrowed mineral record is retained. Construction runs once when the land is created.

The playbook's acceptance subset passes **27 files / 432 tests**, including ten new stair/material tests. Tests check connected landings, tread proportions, outward faces, support feet and clearance against the triangles actually rendered. Type checking, lifecycle, palette, import boundaries and architecture fitness pass. Changed-file lint is clean; the broader theme scope retains 16 pre-existing line-length warnings. The production build passes in **45.12 seconds**, including boot closure; shipped IP-string and Pages-artifact checks also pass.

Fourteen final scenes pass rendered review on WebGPU and WebGL2: rest, board, wet, construction detail, High portrait, WebGPU Minimal desktop/portrait and WebGL2 Low desktop/portrait. Matching High frames differ by at most **0.062/255 mean RGB** across the two backends. Against the prior cloud commit, the complete upper 400 pixels and the landscape right of x = 900 are pixel-identical in the 1920×1080 rest frame. The approved sky, clouds and mineral colors are preserved. The portrait checks validate the existing board composition; the stairs mostly sit behind that card.

## Verification

At the original theme delivery, the graphics pass passed **11 focused files / 242 tests** and the full repository suite passed **844 files / 16,151 tests**. Type checking, the TypeScript ratchet, architecture fitness, lifecycle audit, import boundaries, palette screening, performance-budget and release gates, production build/boot closure, shipped IP scan and Pages artifact checks passed. The repository lint ratchet passed; the new theme and playground effect had zero ESLint errors. Dependency audit reported zero vulnerabilities. WGSL and GLSL builder tests reject nonfinite literals and cap each generated shader below 96 KiB. The full repository suite was not rerun for the scoped cloud or stair refinements; their checks are recorded above.

The initial acceptance sweep covers the concept's 18 numbered scenes and its wetness, sun-elevation, formation, reduced-motion, false-color and layout probes. After the additional graphics pass, the desktop reference/event scenes, phone composition, Low/Minimal starred events, real game and mobile validation are refreshed. Diagnostics distinguish the initial sweep from this final graphics verification. The desktop reference frames use 1920×1080, portrait 390×844, wide 2560×1080, and short laptop 1280×720. The final Low/Minimal starred-event sweep passes all 28 frames at 960×540; ten portrait event/sun variants and two reduced-motion tilt captures also pass. Captures check the actual backend and selected tier, then inspect the image; WebGPU and WebGL2 compile and draw the same world. At peak 7, the release fixture produces wetness 0.743 and a double bow; peak 4 produces wetness 0.379 and no bow.

Real-game High captures and retained-owner teardown checks passed on both backends. Each final real-game run records three locks and hard drops after the world is ready. After switching away, the owner is stopped, its renderer/world/post/scene/director references are null, its event subscriptions and pending work are empty, and its container has no canvas or children. Mobile validation of the game adapter passed at Low and Minimal through portrait, landscape and resume, with nine node-material meshes, zero nonfinite values, zero GL errors and advancing heartbeats. Low passed the stock validator. The final Minimal run passed compatibility checks with a scratch-only 15-second startup-liveness and browser-close allowance: one stock run missed its 500 ms initial heartbeat window, and a second rendered every phase correctly but exceeded the 5-second browser-close limit. Both original timing failures are retained in the diagnostics; production code is unchanged by the allowance. The software driver emitted queue-serial warnings; the isolated WebGL2 adapter probe emitted `No available adapters.` These were not shader failures. In the WebGPU switch-away check, Forest exceeded its own initialization timeout and recovered through WebGL2 after Painted Ages had stopped cleanly. The game and mobile checks use the real adapter through Vite; the compiled production build is verified separately.

The initial live Minimal portrait sequence showed no stripe crawl or moiré; reduced motion held the camera fixed. At the original theme delivery, the 20-second demo kept 11 scene objects, nine meshes/geometries, 32 attribute buffers and 6,550,769 renderer-accounted bytes unchanged across four samples, including two quads and a combo release. GL allocation counters also stayed at 118 buffers and seven textures. This is bounded-allocation evidence, not a timing benchmark, and the demo was not rerun for the cloud refinement. Worker probes verified termination after both success and cancellation.

Independent image review accepted the final desktop and phone effects. Independent code review found and drove fixes for director continuity during quality/GPU recovery and chronological deposition when queue slots are reused, and the reduced-motion tilt/rain response. Reduced motion now dissolves between fixed strata angles over 0.3 seconds and reduces curtain drift/streak motion and strength to 0.3. The thumbnail comparison distinguishes Painted Ages from Shifting Sands, Himalayan Peak, Solar Eclipse and Parhelion. A Rainbark scene was unavailable in this checkout and is explicitly marked missing in the montage. The final reference review accepts the stronger geometry, bedding and depth in both color and grayscale. Sixteen final High views pass on both backends; paired images differ by at most 0.058/255 mean RGB. The far face retains a gentler dip than the strongest Hornocal flatirons.

Software-rendered Chromium captures prove shader compilation, finite output, composition and lifecycle behavior. They do not establish physical phone or integrated-GPU frame budgets; the concept's millisecond budgets remain unmeasured on hardware.

## Curated captures

The [capture manifest](painted-ages-captures/manifest.json) records playground queries, viewport sizes, tiers, backends and artifact hashes; [verification diagnostics](painted-ages-captures/verification.json) retain the backend and event-state checks. Images below are reduced WebP copies of the rendered frames; the phone images retain their original size. Reference photographs are not included.

| Evidence | Capture |
|---|---|
| Graphics upgrade in color and grayscale | [Before and after](painted-ages-captures/graphics-comparison.webp) |
| Morning strata and reference composition | [Rest, WebGPU](painted-ages-captures/rest-webgpu.webp) |
| Board and HUD calm zones | [Board, WebGL2](painted-ages-captures/board-webgl2.webp) |
| Grounded sediment and backend parity | [Clear, WebGPU](painted-ages-captures/deposition-webgpu.webp) · [WebGL2](painted-ages-captures/deposition-webgl2.webp) |
| Four-line sediment flood | [Flood](painted-ages-captures/flood-webgpu.webp) |
| Wet terrain and double bow | [Release](painted-ages-captures/release-webgpu.webp) |
| Perfect-clear mineral cloud stack | [Sky record](painted-ages-captures/sky-record-webgpu.webp) |
| Game-over tuff and low light | [Seal](painted-ages-captures/seal-webgl2.webp) |
| Portrait event footprint and bow placement | [Lock](painted-ages-captures/phone-lock-webgpu.webp) · [Low clear](painted-ages-captures/phone-clear-webgpu.webp) · [Release](painted-ages-captures/phone-bow-webgl2.webp) |
| Reduced-motion strata transition | [Settled marker bed](painted-ages-captures/reduced-motion.webp) |
| Tier coverage (seven scenes each) | [Low, WebGL2](painted-ages-captures/low-webgl2.webp) · [Minimal, WebGPU](painted-ages-captures/minimal-webgpu.webp) |
| Actual game and piece readability | [WebGPU](painted-ages-captures/game-webgpu.webp) · [WebGL2](painted-ages-captures/game-webgl2.webp) · [Color-vision simulations](painted-ages-captures/board-cvd.webp) |
| Theme differentiation and collection icon | [128×72 comparison](painted-ages-captures/similarity.webp) · [80 px picker](painted-ages-captures/icon-picker.webp) |

The cloud follow-up has its own [capture manifest](painted-ages-captures/clouds/manifest.json) and [verification diagnostics](painted-ages-captures/clouds/verification.json), keeping the final cloud evidence separate from the original delivery sweep.

| Cloud evidence | Capture |
|---|---|
| Before/after shape, depth and unchanged surroundings | [Comparison](painted-ages-captures/clouds/comparison.webp) |
| Unequal standing plates and shaded vapor tips | [Rest](painted-ages-captures/clouds/rest.webp) |
| Mineral-colored perfect-clear stack | [Perfect clear](painted-ages-captures/clouds/perfect.webp) |
| Coherent asymmetric bank and weather | [Weather](painted-ages-captures/clouds/weather.webp) |
| Portrait framing on both backends | [Phone](painted-ages-captures/clouds/phone.webp) |
| Refreshed collection thumbnail | [80 px picker](painted-ages-captures/clouds/icon-picker.webp) |

The stair follow-up has its own [capture manifest](painted-ages-captures/stairs/manifest.json) and [verification diagnostics](painted-ages-captures/stairs/verification.json), including geometry budgets, resource ownership and both backend results.

| Stair evidence | Capture |
|---|---|
| Matched full frames and enlarged construction crops | [Before and after](painted-ages-captures/stairs/comparison.webp) |
| Near-ridge route and preserved landscape | [Rest](painted-ages-captures/stairs/rest.webp) |
| Joined landings, braced supports and timber material | [Detail, WebGL2](painted-ages-captures/stairs/detail.webp) |
| Board framing and damp material | [Board](painted-ages-captures/stairs/board.webp) · [Wet](painted-ages-captures/stairs/wet.webp) |
| Reduced-quality construction | [Low, WebGL2](painted-ages-captures/stairs/low.webp) · [Minimal, WebGPU](painted-ages-captures/stairs/minimal.webp) |
| Preserved portrait board composition | [Phone, WebGL2 Low](painted-ages-captures/stairs/phone.webp) |

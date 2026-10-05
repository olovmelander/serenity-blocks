# Crystal Cave visual overhaul — October 2026

Crystal Cave uses the pinned Three.js 0.186.1 node renderer on both native WebGPU
and its WebGL2 compatibility backend. One procedural scene and one event director
serve the production theme and the isolated playground.

## Art direction

An asymmetric mineral cathedral surrounds a quiet central playing corridor.
Turquoise formations on the left and amethyst on the right provide the main
silhouette; sapphire, rose and citrine accents reveal the receding rock arches.
Broad crystal faces and narrow bevels catch different light. Baked mineral noise,
striae and emissive veins give the stone and crystals more surface detail.

The reflective pool extends beneath the full portrait frame. Medium and higher
tiers use a reduced-resolution planar reflection and restrained luminance bloom;
Low and Minimal render directly with an analytic water sheen. All tiers preserve
the hero formations. Mineral dust, layered pool mist and light shafts add depth.
The camera adjusts its field of view and distance for portrait screens.

## Event language

- Piece locks release larger jewel sparks, a fractured corona and a colored
  water ring near a foreground formation. The response follows the locked
  piece's color and side, preferring Infinity's viewport origin when supplied.
- Line clears create a traveling mineral resonance, coronas, sparks and colored
  rings on open water. Four-line clears add delayed wall ribbons and aftershocks.
- Combos answer from both walls with a staged cascade of ribbons, coronas,
  shards and rings. Each burst has a distinct jewel hue. Airborne bursts and
  ribbons frame the central board corridor.

Event objects, geometries and materials are allocated at startup. Bursts reuse
fixed particle, arc, ripple, corona and delayed-reaction slots. Hidden event
drawables warm through the shipped render path during startup. Energy and
resonance decay in seconds;
successive waves coalesce without restarting a traveling wave. Pause, visibility,
live effect settings, quality changes, renderer recovery and cleanup follow the
shared theme lifecycle.

## Quality budgets

| Tier | Crystal clusters | Dust | Event particles | Arcs / rings | Coronas | Reflection scale | Bloom scale | DPR cap |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Extreme | 52 | 1600 | 220 | 7 / 7 | 8 | 0.40 | 0.60 | 1.50 |
| Ultra | 42 | 1200 | 180 | 6 / 6 | 7 | 0.35 | 0.55 | 1.35 |
| High | 32 | 900 | 140 | 5 / 5 | 6 | 0.30 | 0.45 | 1.25 |
| Medium | 22 | 550 | 100 | 4 / 4 | 5 | 0.22 | 0.30 | 1.00 |
| Low | 14 | 260 | 64 | 3 / 3 | 4 | — | — | 0.90 |
| Minimal | 10 | 120 | 36 | 2 / 2 | 3 | — | — | 0.75 |

The application's render scale also applies to the DPR cap. These are allocation
budgets, not measurements of physical-device frame rate. Medium phone reflections
are visibly softer at the reduced mirror resolution; Low omits the mirror pass.
Delayed reaction capacity is twice the arc budget and never grows during play.

## Reproducible preview

Run `npm run dev:playground` and open:

- `/playground.html?effect=crystal-cave&quality=High&t=12`
- `/playground.html?effect=crystal-cave&quality=High&t=12&event=combo&combo=7&eventAge=0.35`
- `/playground.html?effect=crystal-cave&quality=Low&t=12&forceWebGL`

The playground shares production artwork, fixed event pools and post-processing.
`t` fixes the animation phase; `eventAge` fixes the elapsed time after the event.

## Acceptance evidence

Fresh isolated playground and production captures were inspected using headless
Chromium 153.0.8010.0 with software WebGL2. The production theme was instantiated
directly, without a gameplay board. These verify artwork and lifecycle behavior;
they do not establish hardware frame rates.

- High desktop: 1280 × 720, effective pixel ratio 1; full mirror and post active.
- Low phone: 390 × 844, effective ratio 0.45, rotated to landscape and back;
  direct rendering, no mirror or post allocations.
- Medium phone: 390 × 844, effective ratio 0.75, rotated to landscape and back;
  mirror and post remained active.

Each production surface passed a 750-event burst without growing its geometry
or material pools, two pause/resume cycles, two stop/start cycles, and repeated
cleanup. Captures had zero console errors, warnings, GL errors or non-finite
geometry values. Cleanup removed all canvases and preserved the static theme
container. The icon is a fresh 512 × 512 render of the shared artwork.

The restored candidate passed the full suite (531 files / 5,708 tests), build and
boot-closure checks, typecheck, lint ratchet, dependency boundaries, architecture
fitness, theme lifecycle, TS ratchet, performance-budget and release gates.
Current main's breathing overhaul was then integrated, preserving its lower
ratchets; focused integration checks and a new build verify the combined tree.

Evidence: [idle](crystal-cave-overhaul/idle.webp),
[combo](crystal-cave-overhaul/combo.webp),
[Low portrait](crystal-cave-overhaul/low-portrait.webp),
[Medium portrait](crystal-cave-overhaul/medium-portrait.webp),
[Medium landscape](crystal-cave-overhaul/medium-landscape.webp), and
[acceptance metadata](crystal-cave-overhaul/validation.json).

Native WebGPU hardware and physical-phone performance acceptance remain open.
The fresh captures exercise the modern renderer's WebGL2 backend; native WebGPU
was not freshly validated in this run. An earlier environment lost native GPU
devices on this theme and unrelated control scenes.

## Prismatic event refinement acceptance

The stronger event response was validated as an increment on current main
(`e3a15c8`). Fresh software WebGL2 production captures cover High desktop and
Low/Medium portrait at the same viewport and render scales listed above.
Actual theme event listeners received colored left/right piece locks, an
Infinity viewport-origin override, and combo response levels 1, 3 and 8. The
level-1 payload is a response probe; gameplay's cascade emission rules are
unchanged. Event captures use deterministic 60 Hz simulation and requested
ages of 0.15, 0.35 and 0.8 seconds, quantized to one simulation step.

All three surfaces passed a 750-event flood inspected at six simulated ages,
rotation where applicable, two pause/resume cycles, two stop/restart cycles and
repeated cleanup. Geometry, material, slot-array, shader-program and reported
renderer-memory budgets stayed fixed through the flood. Active particles,
ribbons, rings, coronas and pending echoes stayed within their allocated slots.
Application console warnings, JavaScript/runtime errors, GL errors and
non-finite geometry counts were zero. Each run recorded four SwiftShader driver
performance hints about its reserved `outsideRenderPass queueSerial`; the exact
messages are retained in the metadata.

The full suite passed (543 files / 5,941 tests), along with production build,
boot closure, typecheck, lint ratchet (1,103 warnings), dependency boundaries
(1,064 modules / 3,384 dependencies), architecture fitness, theme lifecycle,
TS ratchet, performance budgets and release gates. IP string and Pages artifact
checks passed against the temporary shipping artifact. Desktop and phone images
were reviewed for visible local
feedback, distinct jewel hues, preserved facets and a calm central corridor.
Medium retains its deliberately soft mirror budget.

Evidence: [colored lock](crystal-cave-overhaul/prismatic-effects/lock.webp),
[prismatic combo](crystal-cave-overhaul/prismatic-effects/combo.webp),
[Low portrait](crystal-cave-overhaul/prismatic-effects/low-portrait.webp),
[Medium portrait](crystal-cave-overhaul/prismatic-effects/medium-portrait.webp),
and [increment metadata](crystal-cave-overhaul/prismatic-effects/validation.json).

One bounded native probe reached an actual WebGPU backend on Google SwiftShader,
then lost the device with reason `destroyed` and produced black captures.
The logs contained device-loss and `popErrorScope` errors, without a WGSL
parse/type diagnostic. Native WebGPU acceptance remains unavailable; this probe
does not establish the cause. Physical-device performance remains unverified.

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

- Piece locks send a brief glint through a crystal formation and release motes.
- Line clears create a traveling mineral resonance, curved light ribbons and
  expanding rings on open water.
- Combos intensify the same language with a bounded response. Events interleave
  both walls and keep ribbons outside the central board corridor.

Event objects, geometries and materials are allocated at startup. Bursts reuse
fixed particle, arc and ripple slots. Energy and resonance decay in seconds;
successive waves coalesce without restarting a traveling wave. Pause, visibility,
live effect settings, quality changes, renderer recovery and cleanup follow the
shared theme lifecycle.

## Quality budgets

| Tier | Crystal clusters | Dust | Event particles | Arcs / rings | Reflection scale | Bloom scale | DPR cap |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Extreme | 52 | 1600 | 220 | 7 / 7 | 0.40 | 0.60 | 1.50 |
| Ultra | 42 | 1200 | 180 | 6 / 6 | 0.35 | 0.55 | 1.35 |
| High | 32 | 900 | 140 | 5 / 5 | 0.30 | 0.45 | 1.25 |
| Medium | 22 | 550 | 100 | 4 / 4 | 0.22 | 0.30 | 1.00 |
| Low | 14 | 260 | 64 | 3 / 3 | — | — | 0.90 |
| Minimal | 10 | 120 | 36 | 2 / 2 | — | — | 0.75 |

The application's render scale also applies to the DPR cap. These are allocation
budgets, not measurements of physical-device frame rate. Medium phone reflections
are visibly softer at the reduced mirror resolution; Low omits the mirror pass.

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

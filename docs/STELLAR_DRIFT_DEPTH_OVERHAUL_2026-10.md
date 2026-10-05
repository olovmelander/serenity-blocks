# Stellar Drift — orbital depth and event overhaul

## Result

The scene now reads as a voyage through layered space: nearby debris, drifting
interstellar motes, a ringed gas giant, independently moving moons, depth-distributed
stars and distant cloud banks. Mouse movement eases the camera through these layers.
The nebula covers the entire viewport, including ultrawide and phone orientations.

The previous scene combined a fixed-size background plane, regular sinusoidal cloud
belts and very large multicolored rings. Its celestial reactions were almost
imperceptible thin streaks. The before/after screenshots and validation reports are in
`reports/stellar-drift-depth-2026-10/`.

## Visual design

- **Space:** a clip-space sky guarantees coverage. Soft domain-warped gas, backlit dust
  cavities and two world-space cloud banks replace sharp, electrical-looking contours.
  Cyan and violet clouds sit against a dark blue field rather than filling it uniformly.
- **Stars and particles:** stars occupy a perspective volume with varied size, spectral
  color, diffraction glints and gentle twinkle. Interstellar motes and corner debris
  establish nearer depth; fine ring particles retain their own orbit and scale.
- **Planets:** irregular cloud belt widths, anisotropic turbulence and four coherent
  storms are baked once into a deterministic texture. Its alpha channel stores cloud
  relief. World-space sunlight, a dark hemisphere, atmospheric scattering and ring-cast
  shadows give the giant volume. Shared moon materials add crater basins, rims and
  mineral patches to the copper and icy bodies.
- **Rings:** fine muted ice sheets with density variation, a major division and a
  planetary shadow replace the broad alternating rainbow bands. The camera/planet
  distance prevents the near ring from dominating the whole screen.
- **Motion:** small autonomous camera drift and independent lunar motion establish a
  living scene. Mouse position adds bounded, exponentially smoothed camera translation
  and a restrained change of viewing direction. Touch input does not steer the camera;
  reduced-motion preference disables camera travel and lunar drift. Pointer leave/blur
  recenters the target, and the theme lifecycle removes its listeners.
- **Events:** clear/combo reactions combine luminous orbiting ribbons, curved comet
  trails, bright nuclei with cyan comas, local contact coronas and polar auroral curtains.
  Comets approach from outside the planet and meet its visible tangent, with shared
  trajectories for the trail, head and impact. Rapid piece locks cannot overwrite the
  active clear/combo choreography. A soft board mask dims event light under the board.

## Rendering and budgets

One node-material scene runs on native WebGPU and the node WebGL2 compatibility
backend. High tiers retain the existing emission-aware bloom/grade; Low and Minimal
render directly without allocating offscreen/bloom targets.

| Tier | Stars | Ring dust | Space motes | Ring debris | Near debris | Arc slots | Comet slots |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Extreme | 5,200 | 1,500 | 2,300 | 500 | 44 | 12 | 4 |
| Ultra | 4,300 | 1,200 | 1,900 | 400 | 36 | 10 | 3 |
| High | 3,400 | 900 | 1,500 | 300 | 28 | 8 | 3 |
| Medium | 2,200 | 600 | 950 | 200 | 18 | 6 | 2 |
| Low | 1,300 | 320 | 550 | 100 | 10 | 4 | 1 |
| Minimal | 800 | 160 | 280 | 50 | 6 | 3 | 1 |

Particle families are instanced. Four fixed event draws reuse their geometry, material
and uniform pools; inactive slots collapse instead of constructing new GPU resources.
The atmosphere owns scene resources, and event disposal detaches its groups before
the remaining shared-resource disposal traversal. Simulation-seconds timing, frame
gating, hidden-tab pause, backend recovery and gameplay mechanics are preserved.

## Reproduction

Run `npm run dev:playground`, then open
`/playground.html?effect=stellar-drift&t=8&quality=High&seed=481516&orbit=0`.
Add `&event=combo&combo=5&eventAge=0.35` for launch, `eventAge=1.65` for contact,
`&board=1` for board framing, or `&forceWebGL=1` for the compatibility backend.
Omit `t` to interact with live camera smoothing.

`scripts/stellar-drift-depth-validation.mjs` captures deterministic scenes, records
renderer diagnostics and GPU/console failures, compares center/corner pointer states,
and validates the production theme owner through the real event bus. It accepts
`--native`, `--live`, `--pointer`, `--board`, `--profiles=...`, `--states=...` and
`--event-age=...`. Provide existing local Playwright/Chromium paths through
`PLAYWRIGHT_MODULE` and `CHROMIUM_EXECUTABLE` when needed.

Software-rendered screenshots establish shader correctness, composition and renderer
parity. They do not establish frame-rate claims for physical phones or desktop GPUs.

## Acceptance evidence

- 17 final visual states pass with zero console, shader or GPU errors. These cover
  native desktop idle/launch/contact; WebGL2 desktop, ultrawide, phone portrait and phone
  landscape idle/combo; production theme events and disposal; and actual single-player
  gameplay on desktop and phone.
- Real pointer movement produces a 1.9677-unit camera displacement after smoothing.
  All production stop checks remove the theme canvas and deactivate the owner.
- 124 focused tests pass across scene, event, renderer parity and lifecycle suites.
  The full suite covers 5,934 cases. Its two timing failures during concurrent capture
  work (binary fuzz timeout and Odyssey cloud bake budget) pass in isolated reruns;
  the other 5,932 cases pass in the original run.
- Production build and boot closure pass. Typecheck, TS/lint/architecture ratchets,
  import boundaries, theme lifecycle, release gates, performance-budget scaffolding
  shipped IP-string and Pages artifact checks pass. Changed source/tests have zero ESLint warnings.
- The optional palette check still flags the unchanged Stillwater palette; no
  tetromino palette or gameplay code is changed by this overhaul.

See the report README for the acceptance matrix and before/after images. The report's
`verification-summary.json` records source SHA-256 hashes and exact check outcomes.

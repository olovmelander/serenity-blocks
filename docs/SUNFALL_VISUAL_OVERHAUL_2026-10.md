# Sunfall — a new theme in Moonrise Summit's place (2026-10-20), and its visual overhaul

`sunfall` replaces the legacy `moonrise-summit` theme (the old id is retired to it: saves, the
collection, Odyssey completions and the music key all resolve; `RETIRED_THEME_IDS`,
`RETIRED_TRACK_KEYS`, `tests/unit/sunfall-rename-migration.test.js`). Built from the concept in
[theme-concepts/sunfall.md](theme-concepts/sunfall.md) (§3 amendments govern where they differ from
§1).

The first build (merged as `fd07c044`) drew the doline as a displaced tube with a white disc for the
oculus and a small bush for the jungle; it realised little of the concept's picture. **The second
pass (this record, branch `feature/sunfall-overhaul`) rebuilt the whole visual layer** on the
concept's frame: an authored, Cycles-baked chamber, a planned canopy, and the light in the air
integrated in the world. The director, the piece palette, the rename and the gameplay grammar stay.

## The picture

The eye stands on a rimstone ledge on the chamber's near wall, about 110 m above the canopy, looking
across the void (16:9 rest rig: the origin, pitched 2° down, a 52° vertical lens).

- **The oculus**, a collapse skylight through a 30 m roof, is cropped by the top-left of the frame:
  sunlit rainforest crowns lean over its rim against the sky and a fringe of lianas hangs into the
  shaft.
- **The sunfall** pours from it through the cave's cloud deck (a gilded hole where it passes) onto
  the canopy in the left free space; its lengthwise streaks are the rim's vines.
- **The pool**: the crowns the column lands on blaze chartreuse; round it the forest falls into
  deep blue-green shade.
- **The vault and walls** are lit by the column itself and by the sunlit pool, warm green-gold from
  below; the chamber's far wall fades into teal haze behind the card.
- **The passage** runs away on the right to the far doline, a second, smaller skylight whose soft
  beam stands in the passage's mouth, the walls round it warm with its light.
- **Near**: strands of aerial roots hang either side of the card (the lock leaves grow on them);
  rimstone shoulders frame the bottom corners.

Wider screens keep the vertical lens (ultrawide shows more of both sides); a 4:3 screen turns a
little toward the column; an upright phone turns toward it, raises the lens and puts the
incandescent pool in the band below the card (the column itself passes behind the card, softened by
the calm zone). `cameraRigFor(aspect)` in `sunfall-composition.js`.

## How it is built

### Authored in Blender (`scripts/blender/sunfall_assets.py`, package `scripts/blender/sunfall/`)

Run headless; nothing in an open Blender session is touched:

    blender --background --factory-startup --python scripts/blender/sunfall_assets.py -- \
        --out src/themes/sunfall/assets [--scratch <dir>] [--preview <png>]

- **The chamber** is a rock-positive distance field in numpy (`field.py`): a plan ellipse whose
  vertical lower walls curve into a vault, the oculus collapse through a thin roof with the outside
  ground round it, an arched passage running away to the right, the far doline in its roof. Geology
  is written into the field: bedding planes (soft layers weathered back into ledges and stepped
  ceilings), two vertical joint sets that break the vault into cuboid breakdown blocks (bigger near
  the collapse), rounded weathering, and ribbed flowstone drapery on the far right wall. OpenVDB
  (`openvdb` ships in Blender 5.2) polygonises it at 2.5 m (35 M voxels, ~105 s); the domain-edge
  faces OpenVDB closes over open air are dropped (outside the array it reads the iso level, so it
  lids the sky), faces behind the eye are culled, then Blender decimates. The domain reaches past
  the passage's rounded end on every side: when the passage ran out through the domain's edge, the
  dropped faces left a hole there with a sawtooth rim, and the sky dome showed through it as a white
  window that looked like the far doline's light.
- **The ledge** (`ledge.py`): a heightfield of dry gours, pools stepped along warped contours with
  raised scalloped dams, its lip curving away at the corners; a spikemoss mask in the pool floors.
- **The canopy** (`canopy.py`): about 5 900 crowns by dart throwing with a truncated power-law radius
  (3.4–13.5 m), light gaps from a low-frequency field, thinning toward the walls, and a few
  emergents; six cauliflower crown variants polygonised from smooth unions of sub-clumps, decimated
  to 720 triangles each.
- **Bakes** (Cycles, OptiX, vertex colours): ambient occlusion; the sky light through both skylights
  (white sky); and the sunlight, direct and bounced off the canopy, for each of the five stations.
  Light is stored as log2 over 12 stops below a ceiling. Each bake takes about 3 s.
- **Files** (`src/themes/sunfall/assets/`, compact GLBs with KHR_mesh_quantization, 16-bit index
  chunks): `sunfall-shell.glb` 2.11 MB, `sunfall-ledge.glb` 0.72 MB, `sunfall-crowns.glb` 0.23 MB
  (the six crowns and the plan as points), `asset-manifest.json` 69 KB (layout, light encoding,
  floor height grid). `tests/unit/sunfall-assets.test.js` holds the budgets and checks the manifest's
  layout against `SUNFALL_LAYOUT`.
- `--preview <png>` path-traces the scene from the rest camera with volumetric haze: the lab used to
  settle the composition before any shader (it caught the camera inside the near wall, and the
  OpenVDB lid that sealed the oculus).

### The world (`sunfall-world.js`, `sunfall-tsl.js`)

`SunfallWorld.prepareSafely()` loads the assets (a failed load still leaves the sky, the light and
the life); the theme awaits it in `createScene` and abandons a superseded start.

- **Shell**: limestone in beds of uneven thickness (about 9.5 m, the field's rhythm), each its own
  tone and its own depth of weathering: the soft layer at the top of each bed recessed and darker,
  a dark parting under the overhang of the bed above, a lit ledge at its foot where moss grows; the
  field's two joint sets as cracks, each through its own block rows with its own width and a darker
  weathered margin (a grid on the vault, fewer there); broad drip stains and wet seeps; flowstone
  draperies on the far right wall (curtains about 22 m wide along the wall, each its own length
  with a lobed lower edge, fluted, worked out from the layout: the decimated mesh's mask is too
  coarse at its edges); the forest floor outside; a screen-derivative bump. Wet rock (the seeps and
  the flowstone) catches a sheen toward the column's nearest stretch.
- **The shell's light**: the baked sun of the two stations the sun is between (`sfStationSun`),
  told apart as direct or bounced by its own level; the baked sky (it carries the rock's form, so it
  weighs 1.5×); an art-directed **pool light** (the sunlit canopy as an area light sending its light
  upward, lobe³: the physical bounce off a canopy that far below is weak, and the vault lit from
  below is the doline's signature, but the far walls keep their dark); and the **column's own
  light** (`sfColumnLight`: 1/d beside the column, 1/d² past its own length); and the **far
  doline's sunlit floor** as a small area light warming the passage's end (art-directed for the
  same reason as the pool). The analytic lights
  are occluded by the square of the baked occlusion, so recesses hold their dark. Measured term by
  term in the playground: before this, the pool and column lights laid one smooth level over every
  wall and the frame read flat grey.
- **Ledge**: dry calcite dams pale on their exposed crests, damp silt in the pool floors, a soft
  light from the column's side for their shape; peacock spikemoss in fronds, deep green face-on and
  iridescent blue at grazing angles.
- **The sun mask** (`sfSunMask`): a point is in the sunfall where its sun ray crosses the oculus
  plane inside the opening, read from one polar texture of the skylight (a ragged rock rim, great
  trunks and boulders over it, and the vine fringe, which alone rotates for the Turning), blurred by
  the sun disc's penumbra with distance, narrowed into the combo's fingers, widened by a perfect
  clear. Every lit thing reads it, and so does the post's integral.
- **Crowns**: six instanced variants; five crown greens and a little natural flush on smaller crowns;
  leaf clusters in the crown's own frame as a derivative bump (faded where they are sub-pixel), a
  leafy alpha cut near the silhouette, the sun mask times a march through the canopy height map
  toward the sun (crowns shade each other and their far sides), translucency toward the eye, sparse
  wet glints; ambient from the oculus's solid angle, the pool, the column and the cave. A crown
  between the eye and the column glows through its leaves with the column's light, brightest at its
  edge (the emergents beside the pool were dark balls against it). Crowns have elliptical
  footprints and a small lean. The canopy height map (512², half float) is rasterised at load from
  the plan.
- **Understory** (`bakeUnderstoryGrid`, `createUnderstoryMaterial`): one continuous layer of dark
  foliage about 20 m over the floor under the crowns (sinking to shrubs in a clearing), so a gap in
  the canopy shows deep leaves, and sunflecks where the column reaches through, never bare black
  floor. A 160² grid over the floor grid, cut away with a leafy edge where no crown stands within
  about 45 m, so it never meets the walls. It is what made the far canopy read as one forest
  rather than separate crowns.
- **Sky**: blue overhead, white toward the sun, drifting cumulus; drawn last, only where the rock
  leaves it.

### The light in the air (`sunfall-post.js`)

One world-space integral per pixel to the depth the scene pass wrote, then bloom, filmic and grade.

- **Haze and valley mist** in closed form (exponential height fog, integrated piecewise: the valley
  mist is densest at the canopy's top and is dark below it), lit faintly by the cave's teal light
  (more and the whole chamber greys).
- **The column's glow**: the haze lit round the column with a Gaussian profile about its axis
  (σ 38 m: wider and the column loses its edges in a milky halo), integrated along the ray in
  closed form, only in front of what the ray hits and above the crowns.
- **The sunfall**: the ray's chord through the column (the oculus projected along the sun, an
  oblique elliptic cylinder) is a quadratic; the march (0/0/6/8/12/16 steps by tier, Simpson's rule
  on the two lowest) runs inside the chord only, reading the sun mask, a density profile (humid air,
  the deck crossing, the valley mist), two 3D lattice reads of patchiness and the canopy height map
  (the crowns stop the light); two-lobe Henyey-Greenstein phase; static interleaved-gradient jitter.
  The column emerges from the opening without a lid (its density fades in below the oculus plane)
  and dies into the understory through the canopy's gaps (it lit them as white holes).
- **The cloud deck**: a four-step march through a 38 m slab with a parabolic profile, three scales
  of billow in banks with gaps between them (an even sheet hid the whole vault), the hole the
  sunfall burns through it, gold falling off smoothly from the hole's edge, pearl light below.
- **The far doline's beam** in closed form.
- Output: calm zones behind the card and HUD, a knee bloom, exposure, a hue-preserving filmic
  shoulder, a grade (teal shade, warm light), vignette, grain, dither, false colour. The event
  flash (zenith, cataract) is mostly a lift of exposure with a little added veil, so a held zenith
  brightens the light without greying the dark; it keeps `flashScale()` (Reduce flashing effects).

### The life (`sunfall-life.js`, `sunfall-strands.js`, `sunfall-water.js`, `sunfall-air-life.js`)

- **Strands** (`roots`): instanced camera-facing ribbons, at least 1.4 px wide, leaning and curving,
  some root tips ending in view; and **lock leaves** in a ring of instance slots (96–640 by tier).
- **Rim lianas** (`roots`): the vine fringe hanging into the shaft, against the light.
- **Rim forest** (`jungle`): 56 surface trees with trunks round the oculus.
- **Water** (`water`): rain lit only inside the column; the cataract and three flood threads as
  ribbons from rim stations chosen so the falls stay in the light; the spray shell with the bow.
- **Air** (`beam`, `birds`, `mist`): dust in the light, swiftlet pairs that flare in the beam, the
  Exhale cloud rising out through the oculus.

## Gameplay: light, water, stone and delayed greening

| Event | What the world does |
|---|---|
| Piece lock | **Flush**: four young leaves open on the strand on the piece's side of the card, one at each cell's row height, in the piece's pigment, and green over ~20 s (piece colour → bronze → emerald). The strands on that side are kicked. A shoot on the canopy flushes the nearest crowns too. |
| Hard drop | **Snap**: the same leaves, opening faster, and a harder kick down the strands (counted once with the lock that follows). |
| Line clear (1–3) | **Shower** (rain glittering only in the light), **Ripening at the rows** (leaves at the cleared rows mature to emerald in 1.2 s) and **New Growth** (crowns in the pool flush in the rows' colours, then green). |
| Four lines | **Cataract**: a white fall pours from the rim through the column, its leading edge dropping through the light; the spray at its foot carries the theme's **only** double rainbow (`dlBowNode`, placed by `solveBowSun`). |
| Combo chain (2+) | **Sevenfold**: the vines close over the opening except for gaps, one per link; the column splits into that many shafts with their own pools. |
| T-spin | **The Turning**: the vine fringe turns 15° per line about the column, so the streaks and the light on the pool turn with it; it persists for the session. |
| Back-to-back | **Flood threads**: 1–3 thin falls while the chain lives; the far doline's beam swells (Echo). |
| Perfect clear | **Zenith**: the sun stands in the oculus, the column widens and every crown round the pool flushes in the seven colours (no bow). |
| Level up / clock | The light walks through five stations (the bakes blend between them); four cave weathers on the clock. Level 1 rests on High Sunfall. |
| Game over | The deck closes over the oculus; the cave sinks into teal dusk. |

## Verification

- **Playground** (`?effect=sunfall`; the world loads asynchronously, so wait for
  `diagnostics().assets === 'ready'` as well as `__PLAYGROUND_READY__`): rest `t=40&level=1` (and
  `&board=1`), opaque-first `parts=sky,cave,jungle,gours`, `falseColor=1`, `event=lock`,
  `event=clear&lines=3`, `event=quad`, `combo=7`, `event=tspin`, `b2b=2`, `event=perfect`,
  `event=over`, `level=4`, 2560×1080, 390×844, `quality=Low`, `quality=Minimal`, `forceWebGL=1`:
  clean consoles on both backends. A replay re-seeks every frame, so the director's session reset
  now restarts the weather clock and its random stream, and the playground's replays skip the
  Morning pulse (a session start widens the opening).
- **In the game**: `node scripts/run-electron.mjs scripts/capture-theme-screenshots.mjs -- --theme
  sunfall --base-url <dev server>` → PASS (0 lifecycle failures, 0 console errors).
- **GPU time** (playground `profile=1&trackTimestamp=1`, 1898×998, RTX 5080 Laptop, WebGPU):
  Low 1.38 ms, High 2.56 ms, Ultra 2.69 ms p50 (the rock's bedding, joints, flowstone and sheen,
  the understory and the far doline's light cost about 0.6 ms over the first pass); Sunbraid 1.84 ms
  and Grainfields 3.28 ms measured the same way. Integrated GPUs and phones are not yet measured.
- **Tests**: `tests/unit/sunfall-{assets,core,director,composition,world,shaders,theme,rename-migration}.test.js`
  (the shader gate builds every material, the air integral and the output for WGSL and GLSL at High
  and Minimal: no warnings, stage budgets, no NaN or equal-edge literals, no unassigned WGSL reads,
  laid-out `sf_*` helpers pure). The full suite passes but for three number-formatting tests that
  fail on this machine's locale on `main` as well, and the TTS recorder test, which cannot symlink
  through a worktree's linked `node_modules`.

## Deviations from the concept

- **The column is integrated in the post**, not drawn as a hull mesh (the concept's last-resort
  fallback, §3.16 item 10): with the scene's depth the strands cut it and it ends on the canopy it
  lights, and the deck, the valley mist and the haze share one integral. It is world-space, never
  screen-space rays (§3.3 holds: no `GodraysNode`, no radial blur).
- **The sun stands beyond the oculus and to the left**, not behind the eye: the column leans toward
  the eye, forward scattering makes it a body of light, and the canopy is lit through. The bow is
  art-directed anyway (§3.4).
- **Five stations**, not six (the director's existing ring).
- **The flowstone wall** is geometry and a mask, not yet a lit hero; the 21:9-only stalagmite is not
  built.

## Open

- Integrated-GPU and phone measurements; a crown LOD for the far canopy if they need it.
- The far doline's own floor stands behind a bend of the passage from the rest camera; only its
  beam and the light on the walls round it are seen.
- The pool's green-gold light on the vault reads mostly through the gaps in the cloud deck, which
  covers the vault from the eye.
- The ledge's mesh shows its facets up close (only its outer lip is in the frame's corners).
- The frame and colour budgets of §3.2 and §3.15 are not yet measured.

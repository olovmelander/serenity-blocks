# High Coast — a new theme in Mountain's place (2026-10-13)

The owner asked for the Mountain theme (a legacy DOM/CSS theme: three canvas ridges, a CSS sky
gradient) to be replaced by a new theme called **High Coast**, built from scratch on three r186.1
as "a visual masterpiece with amazing lock piece and combo effects", from `main`, with a photo of
Höga Kusten as the reference (an overlook on lichen-crusted granite with an old pine and a trail
sign reading HÖGA KUSTEN, a sheer red-granite headland, a bay of pine islands, a sailboat, red
cottages with a flag on a near island, the sun low over the sea with its glitter road, golden
cumulus), and asked that more references be found on the web.

High Coast takes Mountain's registry slot, its Odyssey orb (orb 24 of the campaign, id 25 in the
data, now "The High Coast"), its chapter (4) and its song (a placeholder copy, renamed). `mountain`
is an alias of `high-coast` in `RETIRED_THEME_IDS`, so saved selections, collection grants and
Odyssey completions that name it now mean High Coast; the track key `Mountain` resolves to
`HighCoast`. The frozen V2 save table keeps `mountain` (PLAYBOOK §4.5).

To look at it: `npm run dev`, then `/playground.html?effect=high-coast&t=10&board=1`
(`hour` 0 golden hour … 5 afternoon; `event=lock|drop|clear|quad|tspin|perfect|levelUp|release|over`
with `eventAge`; `combo=<n>`, `lift=<m>`, `b2b=<n>`, `locks=<n>`; `look=x,y,z,fov` for close-ups).
In the game: `/?unlockAll=1&skipIntro=1`.

## The subject

The High Coast (Höga Kusten, a UNESCO World Heritage site on Sweden's Bothnian coast) is the
highest coastline in the world: since the ice left it some 9,600 years ago the land has risen about
286 m out of the sea (the highest old shoreline is marked on Skuleberget's summit), and it still
rises about 8 mm a year. The wave-washed old shorelines show on the hills as bare rock and shingle
fields (klapperstensfält) of rounded beach cobbles high above the water; hilltops that stood above
the old sea kept their moraine and their forest ("kalottberg"). The bedrock is red rapakivi granite
(Nordingrå granite). Fishing villages of Falu-red boathouses (sjöbodar) sit on the islands; old
boathouses now stand far above the water the land has left. Sources: the World Heritage listing
(whc.unesco.org/en/list/898), Höga Kusten's own pages (hogakusten.com), Skuleskogen National Park
(sverigesnationalparker.se), the High Coast / Kvarken education pages on kalottberg
(highcoastkvarken.org).

**The theme's idea: the rebound, sped up.** Every line cleared lifts the land; the sea draws back
from every shore; wet rock and skerries come up out of it. That is High Coast's own physics, not a
reskin of the fleet's shared event devices (catalogue Part 0).

## The picture

The eye stands on a bare granite summit 152 m above the sea, its rim a dozen metres ahead. On a
knoll on the left an old Scots pine leans out over the view (long grey-brown plates parted by
deep furrows below, thin orange-red flaking bark above, limbs that run out level and turn up at
their ends, a crown of flat-topped needle plates with sky between them) beside a weathered
trail sign carved HÖGA KUSTEN with an arrow board VÄRLDSARV (World Heritage) pointing out over the
coast. Lichen-crusted boulders and mats of heather, crowberry and reindeer lichen lie on the
summit rock. Left: a headland whose east face is a 200 m wall of jointed rapakivi granite falling
in steps to a talus foot, its crown forested, its washed south flank stepped with shingle beach
ridges. Below: a bay strewn with skerries, a large pine island behind the card, a low island on
the near right with the hamlet (Falu-red cottages with white trim on stone plinths, boathouses
along the shore, a jetty, a flagpole with the Swedish flag), islands to the right, the high outer
archipelago, a lighthouse on a steep far island, the mainland's rounded blue hills to the left and
the open Bothnian Sea toward the sun. A fleet of sailboats reaches round loops of open water on
both sides of the card. Gulls wheel over the bay. Cumulus banks stand on the horizon, a lighter
deck drifts overhead and its shadows cross land and water.

## How the land is made

- **Plan** (`high-coast-plan.js`): the summit (a superellipse dome, rim ~12 m ahead, the knoll),
  the headland (a crest polyline; west side a rounded ridge, east side a plateau to a lip that
  wanders and zigzags every ~50 m along its vertical joints, then down in jointed steps — risers
  and ledges via `terrace()` — about 65° overall, to a talus foot), the islands as lobed domes with
  granite knolls, skerry fields (ice-polished whalebacks in cells, two in five holding a rock, most
  just under the sea: the rising land's reveal), the mainland's kalottberg hills, a sea floor.
- **Bake** (`scripts/high-coast/bake-coast.mjs`, ~40 s): evaluates the plan on three nested
  fields (near 1024² over 2.5 km, mid 1024² over 10 km, far 512² over 52 km), cuts two joint sets
  into the bare rock (grooves on slabs, ledges on faces), steps the shingle fields into beach
  ridges, settles the steepest posts a little, nests the fields, computes forest cover from the
  real slopes, drops the far land by the earth's curvature and writes
  `assets/coast-{near,mid,far}.png` (16-bit height RG, sky visibility B, forest A) + a manifest.
  `--preview=<dir>` ray-casts it on the CPU (8 workers, ~20 s); `scripts/high-coast/hillshade.mjs`
  draws it from above with the frame's edges. The composition was iterated this way first.
- **Runtime** (`high-coast-assets.js`): the PNGs are inflated by hand; the land is a fan mesh
  (bearings ±48° × log-distance 3 m–48 km) built in slices that yield to the page; far forests
  are lifted by their canopy in the vertex stage (beyond 2.6–3.6 km; nearer, the trees are real).

## The light

Six hours on a wheel (`high-coast-hours.js`): golden hour (the reference: sun low right over the
open sea), sunset (the disc touching the sea), the light night (63° north in summer: the sun a few
degrees under the northern horizon, an afterglow band, the cottages' windows and the boats'
masthead lights lit, the lighthouse flashing), dawn mist (sea fog lying on the bay), morning (sun
from the left, deep blue sea, the granite's red at its brightest) and afternoon (sun behind the
eye). The sun walks the northern sky from right to left through the night. The wheel turns with
the clock alone — one hour per 100 s, resting 15 % at each end — and a level-up adds a whole hour
on top, eased over 5 s, always forward from wherever the light was heading; a new run keeps the
light where it is.

The air is an exponential haze integrated exactly along each ray plus a sea-fog layer on the
water; the sky is a function of direction (deep blue overhead, a clear lighter blue lower down, a
thin pale horizon band thickening toward the sun, the aureole) shared by the dome and the sea's
mirror. The land's shadows come from sun-visibility targets per field, re-marched only when the
sun has moved; the cloud deck's shadows drift across land and sea.

## What gameplay does

| Event | What happens |
|---|---|
| Lock | A gust — a cat's paw — sets out across the visible water beside the card on the lock's side and runs out to a boat of the fleet on that side, which **sets a spinnaker in the piece's colour** (it pops open, glows where the low sun shines through it, holds ~24 s, is doused). The gust ruffles the water dark and blue and glitters in the piece's colour where it starts, sun-white as it runs. |
| Hard drop | A wider, faster gust and a splash plume thrown up where it starts. |
| Clear | **The land rises**: the sea draws back (2.4 m a line, eased over ~0.5 s), every shore widens, skerries come up, the newly risen band is bare, wet and gleams (gold toward the sun), seawater runs off the steeper risen faces in white threads, a foam line marks the waterline and sea mist breathes off the shores. The bare band dries from the top down over ~16 s. |
| Chain | Each link lifts more (+30 % a link, up to six); the lift approaches a 30 m ceiling; the wind freshens (the fleet heels, the water sparkles) and the gulls gather low over the near bay. Between bursts the sea slowly returns (time constant 48 s). |
| Chain break (after 3+) | A swell runs in from the open sea — long crests and surf along every shore — and the sea returns faster. |
| Four lines | **The great rebound**: the lift plus 6 m at once, the risen rock flaring gold, spray bursts off the shores on both sides of the card, the gulls lift off. |
| T-spin | The fleet comes about: every boat turns and heels the other way. |
| Back-to-back | The lighthouse burns steady and sweeps its beam through the haze. |
| Perfect clear | The wind dies: the sea lies glass-calm (the glitter collapses to a pillar, the islands mirror), then the breeze line returns from the horizon. |
| Level up | The day steps an hour forward (it also turns with the clock) and the lighthouse signals once. |
| Game over | Dusk falls and the sea returns; morning comes back with the next run. |

Every reaction is closed-form in the theme clock or written into preallocated slots (gusts, motes,
the fleet's spinnakers), so `seek(t)` plus a fixed-step replay reproduces any frame.

## Quality tiers

Every tier keeps every part and every beat. Tiers scale the land fan (220×200 … 800×700), rock
detail near the eye, the sea fan, the ripple trains and noise layers, the mirror march that finds
the islands in the water (6 … 34 steps), single sun-sparks, the shadow targets, cloud layers and
banks, the number of trees (4,000 … 38,000), the near props and the mote pool.

## Decisions and traps

- **The composition was settled on the CPU first.** `bake-coast.mjs --preview` ray-casts the
  baked fields from the eye, and `hillshade.mjs` draws them from above with the frame's edges.
  The first plans failed in ways a GPU frame would have hidden behind lighting: the headland's
  root covered the left third, the cliff was seen edge-on, and the summit knoll stood at eye
  height. The fixes were a re-routed crest polyline and a superellipse summit 6 m below the eye.
- **The eye does not rise with the land.** A first build lifted the camera with the rebound,
  which moved the horizon and broke the frame on every clear. The sea falls instead
  (`u.sea = −lift`), and every shore, skerry and wet band follows from that one number.
- **The cliff.** A smooth heightfield face read as melted wax. The plan now cuts it into risers
  and ledges (`terrace(h, step, shift)`) with a zigzag lip. The land shades it in face space
  (`cliffFace`: the coordinate along the face, and height), with ledges every ~9 m, joints every
  ~14 m, a tone per block and ink streaks below the ledges.
- **The near rock's noise scale (the "crumpled paper").** `bakeNoise` packs lattices of period
  8 (r), 16 (g), 32 (b) and 64 (a) into one tile, so `texture(noise, xz / D)` has features
  D / period metres wide, not D. Every near-rock read was 8–64× finer than meant. The vertex
  relief and the hollows' mask drew centimetre spikes that the fan mesh (rows 0.15–0.5 m apart
  on the summit) could not hold. The reads are now sized by their channel: swells
  `r @ xz / 28` = 3.5 m with `.level(2)`, hollows in their dips, lichen crusts a span across,
  joints opening in metre runs. Only the swells and cushions move vertices; the grooves, tufts
  and grain bend the normal.
- **The mirror.** Islands in the water are found by marching the mirror ray over the baked
  heights (6–34 steps by tier, each 23–219 % longer than the one before). A per-pixel hit or miss at discrete
  steps drew stair-stepped edges, and the mirrored land was hazed twice, once from the eye to the
  land and again by the water's own aerial, so it read pale grey. The hit is now bisected
  (4 steps), a ray that grazes the land between steps fades in by its smallest angular clearance,
  and the mirrored land takes only the air between the water and the land. The land test is
  written once: one `Loop` of `mirrorSteps + 4` iterations marches, then spends the rest of its
  iterations bisecting. Inlined in two loops it cost 7 KB of GLSL. A laid-out `Fn` would have
  closed over the field textures, which r186 caches module-wide (invalid WGSL in a second build;
  `high-coast-shaders.test.js` guards it).
- **Ripples.** Coherent sine trains interfered into a lattice of fish scales. Each train's phase
  is now domain-warped by low-frequency noise, the trains have incommensurate wavelengths and
  headings, and noise layers ride on top.
- **Gusts.** A gust aimed beside the card first started behind the summit rock, invisible.
  `surfaceAt` lets near rock occlude (`near = 0.5`), and `waterSite` searches 28 rows up and down
  for open water. Eight gusts run in one TSL `Loop` over a uniform table; unrolled, they had
  pushed the sea's GLSL to 50.9 KB.
- **Shader budget.** The land's fragment was 62 KB with the Voronoi helper inlined at each call.
  As one laid-out `Fn` (`hc_cells`) it is 36 KB in WGSL and 45 KB in GLSL (cap 48 KiB).
- **The pine** (rebuilt 2026-10-13, `high-coast-pine.js`). The first crown was a flat pancake,
  the second a pile of closed noise-pushed icosphere lumps that read as broccoli, with spotted bark
  and glowing tube limbs. The tree is now a branching skeleton (ten limbs that run out level and
  turn up, two to five side shoots each, drooping dead stubs) carrying 50 flat-topped foliage
  plates. Each plate holds needle tufts drawn as two crossed alpha-tested cards; a tuft carries its
  plate's dome normal, its depth in the plate and its openness to the sky (traced on the CPU
  against the other plates), so a plate shades as a mass and glows at its thin edge against a
  low sun. The needle texture is a bottlebrush shoot drawn in code, and its mip chain rescales each
  level's alpha to keep the alpha test's coverage (alpha-tested foliage otherwise thins to nothing
  with distance; the scene pass has no MSAA, so alpha-to-coverage is not available). Bark carries
  coordinates in metres round and along each stem with the seam turned away from the eye: long
  warped plates and furrows of varying width low down, papery orange flakes higher up. A patch of
  the summit round the tree multiplies in its shadow: each point's ray toward the sun is tested
  against the plates (flattened spheres) and the trunk, with darkening at the trunk's foot and
  under the crown. Boulders built from non-indexed icospheres showed facets and are merged
  (`mergeVertices`) for smooth normals. The 3D heath mats read as pancakes and were removed; the
  ground grows its own cushions.
- **Framing at every aspect.** A lens too narrow to hold the pine's trunk (−24°) cut its crown
  off at the left edge, so a sliver of crown floated in the top corner. `frameYaw` either turns
  the lens left until the trunk is in, or (portrait, which faces the sun) turns it right until the
  crown is out. Portrait also shifts the lens vertically (`projectionMatrix.elements[9]`) so the
  horizon and sun sit above the card while the camera stays level.
- **The wet film.** The risen band mirrors the low sky. Uniform, it read as sand. It is now
  patchy (water stands in hollows and runs off crowns) and subtler, so the band reads as wet
  granite with gold glints.
- **Palettes never pass through grey.** The golden-hour and dawn horizons were retuned when a
  unit test caught grey half-way mixes between neighbouring hours.
- **The heath.** Rescaled to its true size, the summit's ground cover first read as camouflage:
  three hues in hard-edged blotches of one size. The cushions now lie in the swells' dips as one
  mass that drifts from crowberry to heather over metres. Each tuft has its own light and shade,
  reindeer lichen is a pale fringe at the rim, and the lichen crusts sit closer to the rock's own
  tone.
- **The cumulus banks.** The billows' edge erosion added noise to the union's height even where no
  billow was (`top = 0`), so flat-shaded lumps grew anywhere on a bank's card and the card's
  rectangle cut them off with straight edges. The outward lumps now die off with distance from
  the nearest billow (`reach`), and billows keep a wider margin inside the card. The overhead
  deck's fine erosion and the cirrus's wisps had the same noise-scale fault: 40 m features at
  10 km drew white flecks and scanlines.
- **The lighthouse beam.** A long ribbon pointed near the eye folds into a wedge along the
  horizon and reads as a seam. The beam is now a soft shaft 2.6 km long that dies away
  exponentially, and it fades out as it swings toward or away from the eye; the lantern's glow
  carries that phase.
- **The lowest tiers keep the summit's form.** Minimal and Low have no near detail, and their
  summit read as flat tan sand. Every tier now has the swells (one read per vertex, three per
  fragment within 78 m) and the cushions in the dips (two reads). Detail tiers add the crusts,
  joints, crystals and tufts.
- **Determinism.** `seek(t)` reseeds the theme's random and resets the gulls and lighthouse. The
  session snapshot carries `beaconShown`, `levelUpAt` and `gustCursor`.

## Verification

All on the RTX 3070 laptop (`force_high_performance_gpu`) unless noted, through the
playground's batch capture and the real game on the dev server. Captures are under
`.cache/hc/` in the build worktree (not committed).

- **Playground, rounds 1–14** (`?effect=high-coast&t=…`): every hour, lock, hard drop, combo
  5, quad, perfect clear, night B2B, Minimal through Ultra, portrait 390×844 and an aspect-0.9
  window. WebGL2 (`forceWebGL=1`) matches WebGPU frame for frame. The batch capture logs no
  WebGPU validation errors; the only console lines are the blocked HMR socket and Electron's CSP
  notice.
- **The real game** (`/?skipIntro=1&themeValidation=1&unlockAll=1`, theme pinned, High):
  - **Play:** keyboard hard drops, then clears, a 6-link chain, four lines, a chain break and a
    level-up through the app's own event bus. The theme ran on WebGPU and on WebGL2
    (`forceWebGL=1`) with 0 dropped events. The display-limited loop held ~130 fps at rest and
    during the rebound on both. Hard drops set spinnakers (6 of 8 boats), the chain lifted the
    land 12 m, four lines took it to 14.3 m, and the level-up stepped the light to sunset.
  - **Quality and switching:** a live switch to Medium rebuilt in place. Leaving for Forest left
    no High Coast canvas behind.
- **The clock alone** (`highCoastFixedDt=0.25`, no clears, level 1, eight frames 50 s apart):
  the wheel moves 0.14 → 0.61 → 1.11 → 1.62 → 2.11 → 2.64 → 3.12 → 3.65, golden hour → sunset →
  light night → dawn mist → toward morning. The sun walks azimuth 25° → −78° and elevation
  4.8° → −5.5° → 19.7°. Unit tests pin the wheel's rest (0.15 at each end), the level step and
  the absence of grey half-way mixes.
- **The theme validator** (`scripts/validate-all-themes.mjs --theme high-coast`, which picks the
  theme through the real collection UI on this laptop's integrated AMD GPU): PASS, with 0
  lifecycle failures, 0 console errors and 0 process failures.
- **Rebuild in place:** a tier change at t = 153 s (place 1.53, sunset) resumed at place 1.62 at
  t = 162 s on Medium. The light carries on from where it was.
- **Gates:** typecheck, `ts-ratchet` (at baseline), `lint:ci` (611 errors against the 807
  baseline; the legacy Mountain files are gone), architecture fitness (resize listeners 26 <
  40), `audit:theme-lifecycle`, `check:boundaries`, `check:palette` (High Coast 0/7),
  `perf:budgets:gate`, `check:release-gates`, `npm run build` with the boot closure,
  `check:ip-strings` over `dist/` and `check:pages-artifact` all pass. The theme's 248 unit
  tests pass. The full suite's only reds when run alone are the two environmental ones known on
  pristine main: `tts-recorder-e2e` (symlink EPERM) and `odyssey-level-briefing` (this machine's
  Swedish number format).
- **Shader sizes (High, WGSL / GLSL fragment):** land 36.6 / 46.2 KB, sea 36.2 / 41.3 KB,
  cumulus 38.4 / 35.1 KB, all under the 48 KiB GLSL cap.
- **The pine's rebuild (2026-10-13, later that day):** four playground rounds on the 3070. They
  covered the full frame, close-ups of the crown (`look=-6,155,-19,46`) and the trunk
  (`look=-8.2,147.5,-19,20`), every hour, Minimal through Ultra, portrait 390×844, an aspect-0.9
  window and WebGL2. Shader sizes (High, WGSL / GLSL fragment): wood 13.0 / 13.5 KB, needles
  6.4 / 6.6 KB, shadow patch 4.2 / 4.6 KB. Tufts: 2,577 / 4,296 / 6,010 by props tier (built in
  about 40 ms). The needle texture's mips keep 15 % alpha-test coverage down to 4 × 4. The
  crown's right reach is +2.9°, so `PINE_FRAME.crown` is now 3.5°, and the phone portrait turns
  to 22.7°. In the real game the tree drew on WebGPU and WebGL2 with no dropped events: 131.7 fps
  at rest on WebGPU, and 131.2 at rest and 131.1 through the rebound on WebGL2. One WebGPU
  reading of 38.4 fps through the rebound was taken while the machine was busy with other work
  and is not a measurement of the theme.
- **The icon:** the old pine (re-baked after the pine's rebuild), the sign, the cliff and the
  bay, from `?effect=high-coast&t=10&quality=Ultra&look=-20.8,145,-97.8,52&locks=4` at 852×852,
  cut to a 512 px circle (contrast 1.14, saturation 1.24) and judged at 80 px.
- **Not done:** no physical phone, and no perf-lane GPU reading. The song is a renamed
  placeholder copy of Mountain's.

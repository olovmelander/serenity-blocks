# Grainfields — a new theme in Misty Lake's place (2026-10-18)

`grainfields` replaces the legacy `misty-lake` theme (the old id is retired to it: saves, the
collection, Odyssey completions and the music key all resolve). Asked for as a complete remake
"from scratch", renamed, after the Ghost of Yōtei landscapes and a reference photo of golden fields
under a storm with the sun piercing the deck; then, mid-build, three steers from the user:

- "Take inspiration from golden forest, summer, verdant hills and sakura twilight … a good low
  angle on the grain field so we don't see when it becomes flat."
- "And we need to improve the trees."
- "Instead of the current mountain … redesign it to a Lapporten designed mountain" (with a
  reference photo of the gate at dusk), then "a bit bigger, so we see a bigger mountain and
  larger gap", and "the grainfield … glow more like before".

Module map: `src/themes/grainfields/` (`grainfields-core.js` constants and maths,
`grainfields-plan.js` the land's plan, `grainfields-hours.js` the day, `grainfields-tsl.js` shared
uniforms and the storm deck, `grainfields-light.js` sky and air, `grainfields-world.js` the world,
`grainfields-reactions.js` the event language, one module per part, `grainfields-post.js`,
`grainfields-theme.js` the BaseTheme shell, `grainfields-director.js` the gameplay director).
Playground: `?effect=grainfields` (`src/playground/effects/grainfields.effect.js`).

## The subject

Grain country in the north at harvest, seen from LOW in a stand of ripe bearded barley. The ears
round the eye fill the bottom of the frame; the field rises to a crest a hundred metres out whose
ears stand at the eye's own height, so everything beyond lies below the line over them and the
field is barley all the way to its horizon, never a flat floor. Over the crest: shelterbelts of
Japanese larch, Ezo spruce and white birch, a stone ruin on a knoll, forested ridges in ranks, and
filling the left of the sky **Lapporten**, the Lapland gate near Abisko: two fells with a glacial U
cut clean between them. A storm deck hangs over everything and is breaking; the sun comes through
its gaps, and through the gate, in shafts that walk the land.

Lapporten (Čuonjávággi, "the goose valley"; Wikipedia, visitnarvik.com, a Biuletyn Peryglacjalny
excursion guide): Nissuntjårro 1738 m and Tjuonatjåkka 1554 m, 2.1 km apart, the lake
Čuonjájávri at 950 m in the U, walls of Seve–Köli amphibolite with cirques. The silhouette is
authored at that size and drawn larger than life (`SIZE`: 1.3 across, 1.5 up) at 12 km.

## The picture

- **The low view** (`EYE`, `CREST`, `nearField`): eye 1.45 m over the field; the crest at 80–108 m
  rises 1.25 m. `.cache/grain/probe-sight.mjs` checks for every bearing that the land between the
  barley's reach and 1.5 km stays under the crest's horizon (only the fort's knoll stands over it).
- **The barley** (`grainfields-grain.js`): 22 000 near clumps of six stalks (2.5–30 m; a crop's own
  density inside 7 m, constant screen density beyond) and 18 000 far clumps of three (to 150 m,
  past the crest) at High. Each ear is a spindle of grains with its brush of awns (strands that
  fade to their mean coverage under a pixel; alpha-to-coverage on a multisampled pass). Ripeness
  drifts in patches; gusts and events bend the stand; backlit, the awns blaze gold (a
  hue-preserving cap keeps a blaze from turning into a white speck); light passes through the
  stand, so the field glows even in the deck's shade.
- **Lapporten** (`grainfields-lapporten.js`): a height field in the gate's own frame; birch on the
  skirts, heath, scree and rock, the last snow in cirques and gullies; the high faces keep the
  afterglow (alpenglow) after sunset.
- **The trees** (`grainfields-forest.js`, assets from `scripts/blender/grainfields_assets.py`):
  nine Blender-authored grove trees (three each of larch, spruce, birch) on Summer's pipeline
  (Fall's branching library, Golden Forest's needles), drawn as bark plus instanced sprays within
  1.1 km (sprays the crest hides are never drawn, far trees keep a third of theirs) and as sprites
  from an impostor sheet beyond.
- **The storm deck** (`grainfields-tsl.js` `deckCover`, `grainfields-sky.js`): one 2D field at
  3300 m that the sky, every shadow and the light in the air read. Its threshold follows the
  measured quantiles (`DECK_QUANTILES`), so `cover` is the share of sky that is cloud. Gaps tear
  the field open by raising its threshold (edges follow the billows, frayed by finer noise); torn
  edges are thin cloud lit through, never darker than the sky behind; the underside's billows
  carry relief lit from the bright band under the storm's far edge.
- **The light in the air** (`grainfields-post.js` `buildAir`): a half-resolution march to the land
  or the deck; under thick cloud the air gets sun only through the gaps, so the shafts stand
  alone. The eye's own shaft is left out near the eye (it would be one glare toward the sun).
- **The herd** (`grainfields-herd.js`, the horse from `scripts/blender/grainfields/horse.py`): a
  few Hokkaido native horses (Dosanko: stocky, short-legged, thick-maned) graze in the barley right
  of the card, their backs, necks and heads over the ears. One authored mesh whose vertex colour
  names each vertex's part (body, neck and head, the four legs, the tail) with masks for the dark
  mane and tail and the pale muzzle; the vertex stage poses it about the authored pivots (the neck
  dips to graze, the legs swing in diagonal pairs, the tail swishes), a small CPU simulation moves
  each horse. A first procedural attempt (ellipsoid blobs) read as toy sheep and was dropped.
- **The ruin, the geese, the motes**: a broken keep on the knoll; skeins of geese crossing (the
  goose valley); chaff and pollen glinting over the field.

## The light: a day on the clock

Five stations (storm break, golden hour, dusk, dawn mist, morning) on High Coast's smooth day:
wheel place = clock / 100 s + (level − 1), no rest anywhere, the sun's height the real one for its
hour at 43° N, its bearing through the stations'. A level-up steps forward from where the light
was headed. Dusk is the reference photo's: a violet sky going rose, the fells lit pink, the field
amber in the afterglow.

## What gameplay does

| Event | What happens |
|---|---|
| Lock | A small gap tears in the deck; a sunbeam stands in the barley beside the card on the piece's side (its column across the free field, its row as distance) and walks slowly with the wind (0.5 m/s: riding the deck's ten metres a second swept it behind the card in two seconds); pigment motes of the piece's colour lift through it |
| Hard drop | A wider beam and a ring of wind pressing out through the stalks |
| Clear | A lane of wind runs out from the eye's feet across the field, laying the stalks along it, chaff of the rows' colours glinting (two lanes for four lines) |
| Chain (combo ≥ 2) | The storm breaks: the deck opens into clouds with clear sky between, the wind rises; at three the horses run |
| T-spin | The wind wheels in the stand (a whirl) and lifts a spinning column of chaff; the herd wheels round |
| Four lines | The sky tears open over Lapporten; a front of light runs out of the gate over the fields |
| Perfect clear | The whole sky clears and the wind stills, then the deck returns |
| Back-to-back | Wider, brighter beams, a stronger wind |
| Level up | A wave of wind across the field; a skein of geese lifts off the field and flies out through the gate |
| Game over | Dusk falls and the storm closes; morning returns with the next run |

## Quality tiers

`grainfields-quality.js`: the land fan, the fells' mesh, cloud detail, the barley's counts and
reaches (every tier reaches past the crest), the forest's near range and spray share, the geese and
the motes. The air march runs from Medium up; bloom from Medium up; MSAA from High up.

## Decisions and traps

- A low eye needs upright, slender, bearded heads: nodding ears seen from above read as a roof of
  blobs ("mesas").
- A clipped field loses every variation to the tone map's shoulder; the glow comes from light
  through the stand, not from a brighter albedo.
- Gaussian gaps look like paper cut-outs; tear them through the field's own threshold.
- A gap near the sun shows the aureole: keep its rim brighter than the sky behind it.
- Thinning the whole deck for a chain floods the air with a veil; open real gaps instead.
- TSL: an expression node is emitted where it is used, so pin with `.toVar()` before an
  `assign` that changes its inputs (the march's step length read 0).
- The march cannot resolve a gap a few metres wide (its steps are hundreds of metres apart): the
  locks' gaps are left out of it (`deckCover(..., { locks: false })`) and drawn as beams.
- The eye standing inside the vale's mist layer turned the horizon into a white line; the fells'
  skirt mesh ending above the land showed sky under it (an apron runs it into the ground).
- Near-square screens (3:4 to 5:4) get their own lens (`RIG.square`): the landscape lens lost the
  gate past its left edge there.
- Bugs a test pass found and fixed: the sunrise popped (a knot after the dawn station), a grey sky
  half-way from dawn to morning (a rose-lilac dawn horizon), the motes' ring not reset by a seek, a
  rebuild in place dropping the storm's break.

## Verification

- Shader gate `tests/unit/grainfields-shaders.test.js`: every material (the trees' from the real
  GLBs served from disk), the post's output and the march, WGSL and GLSL, at High and Minimal.
- Unit tests (337 in twelve files): assets with the horse, director, theme lifecycle with the
  real world and post, the rename migration, playground parameters, core (the lenses, the gate in
  every frame), hours (the clock-only drift, no pops, no grey crossings), plan (the crest's sight
  line), Lapporten (the U, the skyline), reactions and world.
- Playground captures (RTX 3070, WebGPU; `.cache/grain/shots/g10–g12`): the five hours, the
  storm break with its shafts, a held chain, four lines, a hard drop, a level-up's skein, portrait
  430×932, Low and Minimal, and the WebGL2 fallback (identical picture); consoles clean (only the
  blocked HMR socket).
- The real game (`.cache/grain/ingame.mjs`, Electron on the dev server, High): the theme starts
  and runs; on the final build about 130 fps in play on WebGPU and 131 fps on the forced WebGL2
  fallback (the display's own cadence on the 3070); locks, hard drops, clears, a chain of 3, four
  lines, game over (dusk) and level 2 (the light steps on to the golden hour) all reach the world;
  a quality change to Medium rebuilds in place keeping the clock.
- Clock-only drift in the real game (`--script=drift`, `grainfieldsFixedDt=120`): level 1 and no
  clears throughout, the wheel's place 0.12 → 5.11 over 511 s of theme clock, through all five
  hours and back to the storm break.
- `npm run build` (boot closure OK); `npm run lint:ci` 543 errors against a baseline of 574.

Open: no perf-lane reading; no physical phone; the icon is my pick (the golden hour through the
gate); the gaps nearest the sun still read a little cut-out; the horse's trunk is 1.62 m, not 2.0 m
(a Dosanko is barely longer than it is tall; 2.0 m looked stretched).

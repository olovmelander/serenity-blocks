# Painted Ages — visual rebuild (2026-10-12)

The owner asked for a total visual overhaul of Painted Ages ("the mountains, the clouds, the
colours, the composition, the landscape, the stairs, the flood, the sky, the style, the assets —
everything can be improved very much"), built on three r186 and made a visual masterpiece with
amazing lock-piece and combo effects, starting from `main` (3ff50fe7). He named the rebuilt themes
he likes as the bar: Ice Temple, Void Ember, Voltage Storm, Tornado, Sakura Twilight, Moonlit
Greenhouse, Summer, Golden Forest, Forest, Geode, Chiral Gold and Verdant Hills.

The theme keeps its id, name, Chapter 4 reward, song and the gameplay wiring that worked (the
adapter's lifecycle, the director, the layout readers, the mineral record of cleared rows). Every
visible thing is new: the land, its bake, the strata, the light, the sky, the clouds, the
landmarks, the water, every event and the post. The first build's implementation record is in
the git history (`docs/PAINTED_AGES_VISUAL_OVERHAUL_2026-10.md` at 3ff50fe7).

To look at it: `npm run dev`, then `/playground.html?effect=painted-ages&t=10&hour=1.2&board=1`
(`hour` 0 first light … 5 blue hour; `event=lock|drop|clear|quad|twist|perfect|levelUp|release|over`
with `eventAge`; `look=x,y,z,fov` for close-ups). In the game: `/?unlockAll=1&skipIntro=1`.

## The picture

The rainbow badlands of Zhangye and Hornocal seen from an overlook: the eye stands on a spur above
a valley of striped "dragon spine" ridges. A timber boardwalk winds out along the spur, with
stairs where it climbs and a lamp every twenty-odd metres, to a pavilion with red lacquered
columns and a double roof with upturned eaves on its knoll (left third). A braided river runs down
the valley with rows of golden poplars on its banks (right third). At three kilometres a range of
flatirons stands across the whole view, its triangular faces cut into zigzag stripes by their
gullies; behind it, hazy ranges and a line of snow peaks. Cumulus banks stand on the horizon, a
lighter deck drifts overhead, and their shadows cross the land.

## How the land is made

- **Plan** (`painted-ages-plan.js`): smooth analytic landforms — the river's course and its
  floor, anisotropic ridged "dragon spine" ranks (low in the basin below the eye so the lower
  third shows the valley), the spur and its pavilion terrace, a spine ridge with saddles, rainbow
  cones, the flatirons (a planar dip slope cut into triangular facets by gullies deepest near the
  crest), far ranges and snow massifs.
- **Bake** (`scripts/painted-ages/bake-badlands.mjs`, about a minute): evaluates the plan on
  three nested square fields (near 1024² over 2.2 km, mid 1024² over 8.4 km, far 512² over
  40 km), runs droplet erosion on the near and mid fields with each step scaled by the softness
  of the bed it cuts (hard beds stand out as ledges), lets the slopes settle to a talus angle and
  softens the one-post comb, carves the river's bed, nests each field into the next one out,
  drops the far land by the earth's curvature, and writes `assets/badlands-{near,mid,far}.png`
  (16-bit height in RG, sky visibility in B, drainage in A) plus a manifest. `--preview=<dir>`
  ray-casts the result from the eye on the CPU (8 workers, ~12 s); `scripts/painted-ages/hillshade.mjs`
  draws a top-down hillshade. Shapes were iterated this way before any GPU time was spent.
- **Runtime** (`painted-ages-assets.js`): the PNGs are inflated by hand (exact bytes; a 2D canvas
  may be noised) and the land mesh — a fan laid out for the one eye, bearings across the widest
  frame by log-distance from 8 m to 42 km — is built in slices that yield to the page. If the
  images cannot be read, the plan is sampled small and unweathered instead.
- **Strata** (`painted-ages-core.js`): a column of beds from packages of mineral families
  (oxblood, vermilion, brick, orange, ochre, gold, cream, rose, sage, teal, slate, lilac, plum,
  umber), weighted toward the red and orange beds, 0.4–5 m thick, with laminae. A point's bed is
  read at its geological height: its height with the beds' dip and folds taken off — gentle near
  the eye, steeper than the faces under the flatirons — so a band climbs across a hill rather than
  drawing its contour, and every gully bends the beds into a V. The beds follow the land a little
  smoothed, so the fine comb of rain-cut gullies does not saw them.

## The light

Six hours on a wheel: first light, morning, high day, afternoon, sunset, blue hour
(`painted-ages-hours.js`). **The light turns with the clock by itself, independently of the level:**
the wheel's place is `clock / 100 s + (level − 1)`, resting 15 % of each step at each end on the
hour's own light, and a level-up adds a whole hour on top, eased over five seconds from wherever the
light was heading; a new run keeps the hour it has reached. The sun walks round the sky: up out of
the right at first light, behind the eye at noon, down into the left at sunset, under the horizon
for the blue hour. Every hour sets the sun, sky fill, ground bounce, sky gradient, aureole, haze,
valley mist, cloud light and shade, alpenglow on the snow, exposure and stars.

The land lights itself (`painted-ages-land.js`): sun with soft terrain shadows (`painted-ages-shadow.js`:
a sun-visibility target per field, marched across all three fields and re-painted only when the sun
has moved, one field per frame), drifting cloud shadows from the deck overhead, sky light by the
baked visibility, the warm bounce of red ground, flutes near the eye (an erosion filter: rills
straight down every steep face, faded by their own pixel footprint), dust on gentle slopes,
colour washes in gullies, alluvium and sand on the flats, scrub, snow on the peaks, and the air
(`painted-ages-light.js`: an exponential haze integrated along the ray, lit warm toward the sun,
plus a valley mist).

The sky (`painted-ages-sky.js`) draws the hour's gradient, aureole and sun disc, the deck overhead
(the same cover the land's cloud shadows read) and high cirrus; the cumulus banks on the horizon
(`painted-ages-cumulus.js`) are heaps of billows on far cards, lit as solids with a silver lining
when the sun stands behind them, kept off the sun's bearings at first light and sunset.

The post (`painted-ages-post.js`): one scene pass, bloom with a hue-preserving knee that follows
the exposure, sun shafts (High and up), a hue-preserving filmic shoulder, a warm/cool grade,
vignette, calm zones under the card and HUD, grain.

## What gameplay does

| Event | The land answers |
|---|---|
| Lock | The bed where the piece "landed" (a point of the land beside the card: the column picks the side and bearing, the row the depth) lights up in the piece's colour and the light races along it across every hill it crosses; a puff of pigment dust rises. |
| Hard drop | A wider, faster ribbon, a ring of light running out along the ground, sparks. |
| Clear | A band of light per cleared row, in that row's colour, climbs the strata through the whole land; pigment rises off the hills on both sides; the rows are laid down as the newest beds of the mineral record, which crowns the high ground and slides down one bed per row. |
| Chain | A shower walks in from the horizon as the chain grows: the cloud cover thickens and darkens, rain veils hang beyond its front, the land behind it darkens and its colours deepen; rain falls at the eye once it arrives. When a chain of four or more breaks, a rainbow arcs low across the valley, its legs on the hills either side of the board (doubled after seven), and the wet rock dries in the sun. |
| Four lines | A rainbow tide climbs every bed of the land, and a flash flood of water carrying the rows' pigment races down the river, foaming at its front, then drains. |
| T-spin | A dust devil of pigment spins up from the valley floor on the side the T locked on. |
| Back-to-back | Mica and gypsum glint on the sunlit rock. |
| Perfect clear | The clouds take the colours of the pieces, every bed lights in turn, a double bow. |
| Level up | The day steps an hour forward; a pale marker bed of light climbs the land; an ash bed is laid in the record. |
| Game over | Dusk falls and the lanterns and lamps light; morning returns with the next run. |

Effects live in the land's own shader (`painted-ages-events.js`: ribbons, waves, bow, veils,
sparkle, river and flood, all sized in pixels where they cross the land) and in one instanced mote
mesh moving in closed form (`painted-ages-motes.js`). Strata light is kept off the alluvium and
flats.

## Quality tiers

| Tier | Land mesh | Flutes | Shadow targets | Clouds | Banks | Motes | Props |
|---|---|---|---|---|---|---|---|
| Minimal | 220 × 200 | — | 256 / 128 / 64 | deck | 5 | 256 | silhouette |
| Low | 300 × 270 | — | 384 / 192 / 96 | deck | 7 | 512 | full |
| Medium | 420 × 380 | 1 octave | 512 / 256 / 128 | deck + cirrus | 9 | 1024 | full |
| High | 560 × 500 | 2 | 768 / 384 / 192 | deck + cirrus | 10 | 2048 | full |
| Ultra | 680 × 600 | 2 | 1024 / 512 / 256 | deck + cirrus | 10 | 3072 | full |
| Extreme | 800 × 700 | 2 | 1024 / 512 / 256 | deck + cirrus | 10 | 4096 | full |

Bloom from Medium, sun shafts from High.

## Decisions and traps

- The foreground feather grass of an intermediate version was removed at the owner's word ("the
  grass does not fit … does not look good"): it read as oversized hay floating in front of the
  valley. Low vegetation is the land shader's scrub; the poplars give the valley its life.
- A level crest carries one bed along its length and drew a straight "plank" across the view; the
  same happened along the alluvium's height threshold beside a straight stretch of valley. Crests
  now have saddles, and the threshold wanders.
- A band in geological height a few metres thick covers a whole flat; strata light is sized in
  pixels and needs a slope.
- A ribbon's trail written `exp(front − d)` overflowed to `Inf` far from the lock and turned the
  far ranges black once masked (`Inf × 0 = NaN`); every exponent is bounded before it is masked.
- Event rays aimed beside the card hit the ground the eye stands on; they now pass through the
  near ground.
- The soft tails of the hero landforms raised the valley floor ten metres above the river's
  planned bed; landforms are cut off by the valley, and the bake carves the bed.

## Verification

- **Unit tests:** eight files, 242 tests (`tests/unit/painted-ages-*.test.js`: core, hours,
  land, world, shaders, theme, playground, and the unchanged director). The hours test pins the
  owner's rule that the light drifts with the clock at any level; the shaders test builds every
  material for both backends without a GPU and refuses non-finite literals and fragments over
  96 KiB; the land test pins the baked PNGs to their manifest, the field nesting, the river bed,
  the pavilion terrace and the boardwalk. Writing them found three real bugs (a rebuild in place
  lost when the last lock was, so the rock dried twenty times too fast; a forward seek in the
  playground replayed old record rows; an undocumented control), all fixed.
- **Full suite:** 840 of 842 files and 16,155 tests pass; the two failing files are this
  machine's known environmental reds, which fail on untouched main too (the Swedish-locale number
  format in `odyssey-level-briefing`, a symlink `EPERM` in `tts-recorder-e2e`).
- **Gates:** typecheck, the TS ratchet, the lint ratchet (no new errors), architecture fitness,
  the theme lifecycle audit, import boundaries, the palette check, performance budgets, the
  production build with its boot closure, the IP-string, Pages-artifact and release gates — all
  pass.
- **Shaders:** every material builds for WGSL and GLSL in Node (land fragment ≈ 50 KB, sky
  ≈ 12 KB, cumulus ≈ 22 KB).
- **Lifecycle:** `scripts/validate-all-themes.mjs --theme painted-ages` passes (0 lifecycle
  failures, 0 console errors, 0 process failures).
- **Real game** (Electron on the dev server, the theme pinned): WebGPU on the RTX 3070 and the
  AMD integrated GPU at High held the ~131 fps cap; the WebGL2 backend in play ~130 fps. Locks,
  hard drops, clears, a chain and its break, four lines, a level-up and a live High → Medium
  rebuild all ran with no errors; the rebuild kept the clock (150 → 159 s) and the light carried
  on from where it was (wheel 1.50 → 1.59).
- **The light turns with the clock alone** (real game, `paintedAgesFixedDt=100`, no line
  cleared, level 1 in every frame): the wheel went 0.11 → 3.61 hours in 350 s of theme clock
  (first light → afternoon) and the sun swung from 27° to 313° of bearing
  ([strip](painted-ages-captures/clock-ingame.jpg)).
- **Not measured:** a physical phone, the perf lane (ADR-0016), multiplayer and Infinity layouts.

## Atmosphere pass (2026-10-21)

The owner asked to keep improving the visuals, effects, atmosphere and graphics. Full-resolution
captures of every hour showed the sky and the air as the weakest parts, so this pass is about them.
The land, the strata, the composition and the gameplay beats are unchanged.

- **Cumulus banks** (`painted-ages-cumulus.js`, rebuilt). The old banks were sixteen soft spheres
  each, and their edge noise alone pushed the alpha up across the whole card, so every bank sat in a
  visible pale rectangle. Now the outline is a distance field: the billows' soft union, dilated by
  two octaves of small sphere caps (a lattice; the highest cap wins), so the edge is cauliflower at
  three scales and nothing outside the union is drawn. The card reaches past the heap, so no lump is
  clipped. The light uses one smooth "pillow" normal from the outline's distance and gradient (a
  per-billow normal drew a ring wherever one billow met the next), the caps' normals blended softly
  (a hard max drew cracks), darker creases, a flat grey base, and the hour's sky light on the tops.
  Backlit, the body darkens and a one-or-two-pixel silver thread burns on the edge facing the sun,
  measured from the lumped outline at a steady pixel width. Towers climb in zigzag pairs of billows,
  with a lean and a swell, so they have a body instead of a chimney.
- **Where the banks stand.** A 16:9 frame shows ±33° and the board covers about ±11°, but the old
  bearings were ±46–73° or behind the board: almost no cloud showed in play. The first four banks
  (what Minimal draws first) now stand in the side thirds at about ±17° and ±39°, clear of the sun's
  dawn and sunset bearings (±27°), so the heaps beside the sun take its silver lining. Narrow and
  ultrawide screens get the rest.
- **Cirrus** (`painted-ages-sky.js`). Everything the frame shows of the sky is 10–15° up, so the
  cirrus deck 8 km up is seen 30–50 km away and squashed about six to one; its old features drew
  scratch-like dashes. The strands are now sized for that view (kilometres long, hundreds of metres
  across), stream away from the eye a little off its axis so they converge on the horizon, drift
  slightly across their run, and come in patches.
- **The cloud deck** keeps its shadows on the land but shows in the sky only above about 7° (low
  down a flat deck drew white dashes). As a chain's storm thickens the cover, it comes down to the
  horizon again.
- **The sun** has a glare round its disc (a tight core and a wider skirt in the sun's colour), which
  the bloom carries on. It was a flat white dot.
- **Valley mist** (`painted-ages-light.js` `mistPatches`). The mist's density is modulated at the
  ground point by two scales of noise creeping downwind, so it lies in banks and clear lanes along
  the valleys at first light, sunset and the blue hour instead of a uniform sheet. The poplars read
  the same banks.
- **Depth.** The far ranges' bands soften into their mean from 2.4 km (was 3.5 km) and further
  (68 %, was 55 %): ten kilometres off they read as rock in the air rather than contour lines. The
  noon haze is a little thicker (1.05, was 0.85).
- **The river** (`painted-ages-events.js` `riverWater`). Two crossing sine waves of ripples, about
  7 m long, aliased into a twisted rope at the normal view. The ripples are now noise streaks drawn
  down the current, faded once they are under a few pixels, where the unresolved roughness widens the
  sun's glitter instead (a tight sparkling lobe near, a broad path far). The silty body is lighter,
  the gravel shows through the shallows at the edges, and the water's mask reads the height per
  pixel from the baked field: the mesh's rows are ~26 m apart a kilometre out, and its interpolated
  height dashed the shallow channel.
- **Perfect clear** also paints the cumulus banks: the pieces' colours in bands up each heap, like
  the strata of the land below.

Verification: the eight theme suites (242 tests, including every material built for WGSL and
GLSL), typecheck, the lint ratchet (at baseline), the palette gate, and
`scripts/validate-all-themes.mjs --theme painted-ages` (PASS, 0 console errors; its real-game frame
shows the new sky). Frame cost in the playground, origin/main against this pass in interleaved
runs: the same within noise on the RTX (about 0.7 ms at high day and 2 ms at first light, at
2560 × 1440) and on the integrated GPU. WebGL2, Low, Minimal, Ultra, phone portrait and 21:9 were
captured and look right. (Close-ups through the `look=` lens can show the land fan's edge: the
lens turns past the bearings the land is built for.)

## Poplars: windbreak rows and their shadows (2026-10-26)

The owner asked how the trees could be improved. Captures showed three things: the poplars cast
no shadow (they read as floating, most of all at the golden hours, when everything else lays a
long shadow), they stood scattered at random rather than in the windbreak rows the module
described, and 31 of the 170 (the nearest and largest) stood where no screen could see them,
even at 21:9. This pass takes the first two of the four suggested steps; the shape (a
Blender-grown columnar poplar) and the autumn colour are the next ones.

- **Rows** (`painted-ages-life.js` `poplarRows`). The valley is planted as a farmed valley plants
  it: straight windbreaks along the banks, parallel to the river's course (a fifth of them doubled,
  the second line staggered), rows down the edges of fields running out from the water, and a few
  wild clumps by it. A planting is one age (heights within 12 %) and turns together, so a green row
  can stand beside a gold one. The river's stretch is cut into fourteen reaches taken in a seeded
  turn, so rows stand all along the valley at every tier; a smaller tier keeps whole rows (the
  first 90, 150 or 220 trees of one list) rather than thinning each. Every tree stands on level
  ground just above the river's floor and where a 16:9 screen sees its middle at rest
  (`seenAtRest`, a CPU twin of `pose()` checked against three's own projection). The tiers went
  from 70 / 110 / 170 trees to 90 / 150 / 220, all of them in view.
- **Shadows** (`createPoplarShade`, `poplarShadeAt`). The land's own shadow targets are 2–3 m a
  texel, too coarse for a crown 4 m wide, so the trees have their own map: an R8 target laid out
  on a level plane at 6 m, where every point is moved along its sun ray to the plane, holding the
  height of the highest tree on that ray (the caster shares the poplars' geometry and instance
  matrices, writes its height and keeps the highest by `MaxEquation` blending, under a hand-set
  oblique projection). A receiver is in a tree's shadow where that height is above its own, read
  in four bilinear taps for a soft edge, so a shadow that reaches a slope climbs it at the right
  length and nothing above the trees is ever shaded by them. The land multiplies it into the
  sun's light; the trees read it too, lifted by the rise of a ray over 7.5 m so a crown never
  shades its own far side (the wrap light gives it its form) but another row does. The map's size
  is set once for the longest shadows (the sun at 4°, any bearing; 785 × 1759 at High, 1.2 m a
  texel, capped at 2048 a side), its box follows the sun with its corner snapped to whole texels
  (no crawl), and it is re-drawn only when the sun has moved 0.1°. A draw three skipped (its
  pipeline still building, as in the real game's first frames) is not counted: the land stays lit
  and the map is asked for again. Shadows fade out between 4.5° and 1.5° of sun and are off under
  the horizon and when the poplars are hidden.
- **Cost, by construction** (not timed: parallel sessions were on both GPUs). One instanced draw of
  the trees (≈ 53 k triangles at High) into a 1.4 MB target, every few frames while the sun moves;
  four more bilinear taps on the land wherever its sun ray falls in the box (the valley), one on
  Minimal (2.4 m texels); fifty more trees at High. No new pass in the frame itself.

Verification: the eight theme suites (255 tests: rows straight within 0.6 m and of one age, every
tree in the 16:9 frame, every tier at its full count and spread over a kilometre of river, the
box holding every tree's shadow at any sun, the map drawn once, re-asked for after a skipped draw,
skipped when hidden or under the horizon, and the caster built for WGSL and GLSL); the map read
back from the GPU (its footprint where the plane shift puts it); playground captures at five
hours against origin/main, close-ups, Minimal, Low, WebGL2, phone portrait and 21:9; and the real
game (single player on Painted Ages at High: the map drawn, 220 trees, no console errors).

## Poplars: the tree itself, grown in Blender, in autumn (2026-11-20)

Steps three and four of the poplar plan. Where the trees stand, their rows, their counts per tier
and their shadow map are untouched; the tree is new. It was a nine-sided lathe spindle, every one
the same, one flat mix of green and gold. On a 1600 × 900 screen the 220 trees are 8 to 50 pixels
tall (half of them under 17) and 2 to 12 wide (half under 4), 590 m to 2.1 km off: a row of yellow
matchsticks. At that size the outline and the light on it are all there is.

- **The tree** (`scripts/blender/painted_ages_poplar.py`, headless; it writes
  `painted-ages-poplar-model.js`, 22 KB of base64 typed arrays, no loader and no asset file). The
  columnar white poplar of a Central Asian windbreak, grown for its outline: a pale bole bare for
  the lowest tenth, a slim inner column on its axis, eighteen steeply ascending plumes round it in
  a spiral (each a flame of its own that stands off the column at its tip, so the outline is lumpy
  and feathered upward), a leading shoot and a shorter second one beside it (a forked top). Blobs
  along those lines, each pushed about by a noise, are skinned as one mass (a voxel remesh at
  15 cm, 26,800 triangles), smoothed, roughened and collapsed to three levels of 544, 320 and 158
  triangles, bole included. Every level is the unit tree the instance matrix scales (its foot at
  y = 0, its top at 1, its widest point one unit out, a third of the way up). A vertex carries a
  normal blended half toward the whole flame's (a tree takes the light as one shape with lumps on
  it), how far out toward the hull it stands, how much sky it sees (64 rays against the tree
  itself), its plume's index, and bark or leaf. Leaf clumps only: at this size a leaf is a sparkle.
  The script holds each level to its checks (unit bounds, the flame's profile, the bare bole, the
  lumpy outline, the winding, the triangle budget) and writes nothing if one fails; `--preview`
  renders the levels from six sides, as outlines, and at 28 and 16 pixels tall enlarged eight times.
- **No two alike, from one mesh** (`createPoplars`, `POPLAR_FORM`). An instanced mesh has one
  geometry and the shadow caster shares it, so the variety is made in the vertex stage from the
  tree's seed: a girth (0.9 to 1.2), the width sitting low or carried high, every plume drawn in or
  pushed out and set a little lower or higher by a hash of plume and tree, the top cut short on
  most trees by a little and on a few by an eighth (a blunt or forked top), a lean of its own.
  The instance matrix is applied before `positionNode` runs, so each tree is also handed its foot
  as an instance attribute and the stage works on the vertex measured from it. The caster draws
  the grown tree as it stands: what the stage does to one tree is a texel of the map at most.
- **Colour and light.** A planting still turns together (`aTree.x`), but inside a crown the top
  and the plumes' tips turn first, a plume at a time, and the clefts keep their green longest: a
  gold row has an olive core, a green one yellowing tips. A cleft takes less sun and less sky;
  gold deepens to amber low in the crown and pales to lemon at its top; the bole is pale. With
  the sun behind a crown (first light, sunset) its light comes through the leaves in their own
  colour, most toward the outline where the crown is thin, and the core stays dark. The cool sky
  fills the shade. The land's shadow, the other rows' shadows, the cloud shadows and the air with
  its mist banks are applied exactly as they were.
- **Wind.** Gusts are fronts that travel with the cloud deck's drift (`u.wind`: 10 m/s, more when
  play raises a breeze), bent across the wind and unevenly spaced, so a row bows in turn: the top
  of a 20 m tree stands 0.1 m downwind at rest and 1.2 m in a gust. In a gust the leaves show
  their pale undersides, plume by plume (in the shading, not the mesh). A plume's skin also
  breathes and the tree trembles, but only where a metre is more than about two pixels (a close
  lens): at the game's size that motion is finer than a pixel, and all it did was flip samples
  along the outline (eight pixels of the right third stepped by a tenth of full range from one
  frame to the next; two to six do now, from the slow bow alone). Closed form from `u.time` and
  `u.wind`, nothing per frame on the CPU; reduced motion changes nothing here beyond the theme's
  own slowing of the deck's drift.
- **Tiers** draw a level by `tier.props` (`POPLAR_LEVEL`): 220 trees of 544 triangles from High
  up (120 k), 150 of 320 at Low and Medium (48 k), 90 of 158 at Minimal (14 k). One draw, six
  vertex buffers. The shadow map's draw grew with it (it was 53 k triangles at High) and is still
  made only when the sun has moved.

Verification: `tests/unit/painted-ages-poplar-model.test.js` (16 tests: the arrays measured again
against what the script recorded, a level for every tier, the foot attribute against the instance
matrix, the caster sharing geometry and matrices, and the trees' material and the caster built for
WGSL and GLSL at High and at Minimal); the theme's eleven suites with it (274 tests; none of the
other ten pinned the old spindle); playground captures of the six hours against the old trees at the same times, close-ups,
Minimal, Low, WebGL2 and phone portrait, all with a clean console; and frames a second apart and
one step apart with the camera's breath off, where the trees are the only thing that changes (a
mean of 1.1 levels over the right third between two seconds, the grain's own floor being 0.9).
Not done: the real game (the playground mounts the same world), a timed frame cost (parallel
sessions held the GPU; the trees cover about 1 % of the frame and are one draw).

## The living pass (2026-11-20)

The owner asked for a full audit of the theme and then to make it "one of the most visually
stunning themes in my game": every part named (the striped mountains and hills, the pavilion, the
lantern-lit stairway, the walkway, the river, the poplar rows, the valley mist, the towering
clouds, the sun, the sky, colours, light, animation, UI, every event effect), varied over time
"so it never looks the same for long", a distinct effect for every event with the biggest moments
the most spectacular, smooth and easy to read; Blender allowed for models.

To look at it: `/playground.html?effect=painted-ages&maxFps=30&board=1&hud=0&t=10&hour=1`, plus
`air=fair|towers|pools|showers|crystal|mist|dust` (hold the weather), `happen=meteor|flicker|gust`
with `happenAge`, `happenings=0`, `fxaa=0|1`, `vultures=thermal|pass|off` with `vultureAge`,
`vultureSide`, `vultureVisit`, `vultureWay`, and the events as before (`event=…&eventAge=…`).

### What the audit found (from captures of main, kept in the session's scratch)

Strong, and kept: the land and its strata, the composition, the six hours of light, the clear's
bands, the four lines' tide, the chain's bow, the stair's lamps at dusk.

Weak, generic or missing:

- **Nothing changed but the hour.** One sky per hour, the same cloud shapes in the same places,
  clouds that only translated; nothing alive but poplars swaying far off.
- **The cumulus banks** read as thumbs: a narrow chimney of billows on a thin raft, every bank
  alike, standing still.
- **The blue hour** was flat: no moon, uniform white dots for stars, the land lit by fill alone.
- **Cloud shadows** were a faint grey wash (read off the deck's soft cover), never a shadow.
- **The valley floor** was bare sand, the river a thin featureless line, the poplars matchsticks.
- **The ground near the eye** was blurred paint (its pebble noise was sized under a pixel).
- **Edges** were stair-stepped: the scene pass has no MSAA and nothing smoothed it.
- **Events:** the twist's dust devil was a white smear of additive motes on the near slope; the
  flood was a strip of flat coloured tiles; back-to-back was pixel sparks (grain, which the owner
  has rejected on other themes); the level-up was a clear's band in white; the perfect clear
  painted the clouds in candy-striped spectrum and otherwise repeated the four lines; game over
  was simply the blue hour; a plain lock was hard to find at all.

### The weather: a wheel of airs beside the hours (`painted-ages-weather.js`)

Seven airs of 92 s (not a divisor of the hour's 100 s, so the two wheels drift against each other
and an hour is rarely met twice in the same air), each resting 40 % of its time and melting into
the next; a pure function of the clock, air 0 the day as it was:

| Air | What it is |
|---|---|
| fair | scattered cloud, soft shadows |
| towers | the banks boil up to their full height, the deck thins |
| pools | a broken deck: most of the land in shade, pools of sunlight wandering the stripes |
| showers | a far shower trails curtains across one side, a shard of rainbow in them by day |
| crystal | thin haze, deep colours, the snow peaks sharp, cirrus high up |
| mist | a sea of mist in the valleys, the hills standing out of it |
| dust | a warm wind: the clouds race, dust along the valley floor, the far ranges fade |

It drives the deck's cover and the depth of its shadows, the haze, the valley layer (density,
height, and by day a dust tint), the wind (integrated, so a seek lands under the sky a live run
would have reached: `airDrift`), the banks' growth, the cirrus and the far shower. A chain's
storm still closes the sky over any air. Small **happenings** come by the clock (slots of 23 s,
one seeded draw each): a meteor while the stars are out, lightning far inside a bank in the dim
hours (one soft stroke and an echo; a single stroke, scaled, under Reduce flashing), and a pale
dust devil of the wind's own by day.

### Sky, cloud and light

- **The deck forms and melts.** Its two noise fields ride different drifts (`u.wind`, `u.wind2`),
  so a cloud is where both stand high. The land's shadows read the same function (`deckCover`)
  with an edge of their own, so there are real shadows and real pools of light.
- **The banks** (`painted-ages-cumulus.js`): a floor, a broad mound, a main tower and a lower
  turret; each billow carries a share of the bank's growth (the weather lifts the towers off a
  base that stays); every billow breathes, a swell travels up each tower, and the lump lattice
  wells upward, so the skin boils. Lightning glows behind the lumps; the moon silvers them.
- **The dark hours** (`painted-ages-sky.js`): stars in two layers with magnitudes, colours and a
  slow twinkle, sized no smaller than a pixel; the river of heaven rising out of the horizon in
  the left third; a gibbous moon with its seas and halo that rises as the dark deepens (right
  third, beside a bank) and lays a soft unshadowed light on the land, the clouds and the props,
  so the hills keep their form at night; a meteor. The sky turns about the pole.
- **Antialiasing:** FXAA closes the post chain from Low up (the scene pass stays single-sampled:
  the land is a dense fan of pixel-sized triangles with a heavy fragment stage).

### The valley and the overlook

- **Fields** along the river (`painted-ages-land.js`): two ranks of small lots on each bank
  (lucerne, ripe barley, stubble, plough, fallow), a pale bund between them, furrows where the
  eye can resolve them. They follow the river's own coordinates, so they bend with it.
- **The river** is a little wider; its course is read once for the fields and the water.
- **The poplars** are a Blender-grown tree in autumn colour with gusts that travel down a row
  (see the section above; built by a helper on its own branch).
- **Pennants** (`painted-ages-pennants.js`): strings of small flags from lamp to lamp along the
  walk's own line, fluttering with the weather's wind: flags near the eye, a dotted line of colour
  up the stair.
- **The ground near the eye** has grain (grit and stones sized for what a pixel covers there).
- **Bearded vultures** (`painted-ages-vultures.js`, a Blender model; built by a helper): two to
  four circling in a thermal over a side third for about a minute in every three, and now and
  then one passing the overlook close, large. By day only; world-anchored; every visit enters and
  leaves outside the frame and keeps off the card and HUD.

### What gameplay does now

| Event | Before | Now |
|---|---|---|
| Lock | a thin ribbon along the bed | the same, plus a stain of the piece's pigment that blooms where it landed; a bed on the near hill takes less of the light (quick drops laid a white glare on it) |
| Hard drop | wider ribbon, ring, sparks | unchanged |
| Clear | a band per row climbs the strata | unchanged |
| Twist | additive motes on a helix | a funnel of pigment dust on the valley floor (`painted-ages-devils.js`): it climbs out of the ground, stands, drifts, lifts off its foot and thins away; a twist that clears nothing raises a small one |
| Back-to-back | pixel sparks on the rock | veins of gold cutting ACROSS the beds (every other light runs along them); a run holds a soft glow in them and each clear sends a flare racing out along the seams |
| Four lines | rainbow tide; a flood drawn as lanes of flat colour | the tide; the flood as paint poured into water: marbled, drawn out by the current, a pale seam where two paints meet, foam at the banks and the front |
| Chain | the sky closes to a grey deck | the storm with pools of sun breaking through; from the fourth step each step is answered by lightning far inside a bank |
| Perfect clear | spectrum-striped clouds, the tide again, a double bow | **an age in a breath**: the whole day wheels round once in 7.5 s (the sun arcs over and sets, night falls, the stars turn, the lamps come on, dawn breaks) while every bed lights and the clouds take the land's own strata; as the light returns the double bow stands over the valley. Under reduced motion the light does not sweep and the bow rises at once |
| Level up | a pale band | new ages are laid down: the column of beds slides under the land, so every stripe on every hill moves up its slope (16 m of geological height over four seconds; it stays, so each level's land is striped differently, there and back over 400 m); the marker bed; the lamps flare in turn up the stair to the pavilion |
| Game over | dusk, lamps | dusk; the lamps light one after another up the stair (each lamp knows its place along the walk), the moon rises, and sky lanterns leave the pavilion and drift up over the valley |

By the clock alone the strata also slide one step at the start of each new day of the wheel
(every 600 s, not in the first), so the land changes in modes that never level up.

### Decisions and traps

- Air 0 is the look the owner knew; the first weather values were also checked for being seen at
  all (the cloud shadows were not, until they got an edge).
- The far shower shows a SHARD of the bow (its foot on the shower's side); a chain's bow or a
  perfect clear's stands whole and takes over from it.
- The dust devil stands on level ground 430 to 1700 m off on the lock's side of the card, found
  by marching rays; on the near slope it was a wall.
- Pennants strung straight from lamp to lamp cut the walk's bends and lay across the open slope
  like spilt confetti; they follow the walk's own line.
- A crack pattern for the near ground (isolines of the noise) read as worm trails and was
  dropped; the grain stayed.
- The sweep of the day is a whole turn of the wheel, so nothing is left to undo; the hours' rests
  are taken out while it lasts, the stars keep their turn, and the shadows follow in degree steps.
- Gotcha rows: #1205 (a dev server serving a stale module after scripted edits), #1522, #1523
  (cloud shadows, heaped banks), #1759 to #1761 (the funnel, near-bed glare, the day's sweep),
  #707 (inflated thin meshes), #1105 (FXAA over a dense fan); the poplar helper's are #1612 and #1204.

## Captures

| What | Image |
|---|---|
| Living pass: before and after at four hours of light | [living-before-after.jpg](painted-ages-captures/living-before-after.jpg) |
| Living pass: the seven airs of the weather, the moon and a meteor, lightning inside a bank | [living-airs.jpg](painted-ages-captures/living-airs.jpg) |
| Living pass: lock, hard drop, clear, twist, back-to-back, four lines (tide and flood), a chain and its bow | [living-events-1.jpg](painted-ages-captures/living-events-1.jpg) |
| Living pass: level-up, the perfect clear's day at 2.2 s, 4.2 s and 9.5 s, game over, a vulture passing | [living-events-2.jpg](painted-ages-captures/living-events-2.jpg) |
| Living pass: a cumulus bank, the pennants, the valley floor and the flood, enlarged, before and after | [living-details.jpg](painted-ages-captures/living-details.jpg) |
| Living pass: Minimal, Low, WebGL2, 21:9 and the real game | [living-tiers.jpg](painted-ages-captures/living-tiers.jpg) |
| Poplar model: the right third at game size, before and after, first light, morning, afternoon, sunset | [poplar-model-game-size.jpg](painted-ages-captures/poplar-model-game-size.jpg) |
| Poplar model: the rows through a 9° lens, before and after, morning, afternoon, sunset | [poplar-model-closeup.jpg](painted-ages-captures/poplar-model-closeup.jpg) |
| Poplar model: High on WebGPU and on WebGL2, Low, Minimal, high day, blue hour | [poplar-model-tiers.jpg](painted-ages-captures/poplar-model-tiers.jpg) |
| Poplars: the valley's right third before and after, morning, noon, afternoon | [poplars-before-after.jpg](painted-ages-captures/poplars-before-after.jpg) |
| Poplars: the whole frame before and after, morning, afternoon, sunset | [poplars-hours.jpg](painted-ages-captures/poplars-hours.jpg) |
| Poplars: a close-up of the rows and their afternoon shadows (the hill's shadow over three trees) | [poplars-closeup.jpg](painted-ages-captures/poplars-closeup.jpg) |
| Poplars: Minimal, Low, WebGL2 | [poplars-tiers.jpg](painted-ages-captures/poplars-tiers.jpg) |
| Poplars: the real game, afternoon | [poplars-ingame.jpg](painted-ages-captures/poplars-ingame.jpg) |
| Atmosphere pass: before and after at five hours | [atmosphere-before-after.jpg](painted-ages-captures/atmosphere-before-after.jpg) |
| Atmosphere pass: the six hours | [atmosphere-hours.jpg](painted-ages-captures/atmosphere-hours.jpg) |
| Atmosphere pass: cumulus at high day and backlit, the sun at first light, the river, perfect clear (before / after) | [atmosphere-details.jpg](painted-ages-captures/atmosphere-details.jpg) |
| The six hours at level 1 (first light, morning, high day, afternoon, sunset, blue hour) | [hours.jpg](painted-ages-captures/hours.jpg) |
| Lock (red, teal), hard drop, clear, four lines (rainbow tide), the flood | [events-1.jpg](painted-ages-captures/events-1.jpg) |
| T-spin dust devil, a chain's shower, its rainbow, perfect clear, game-over dusk, level-up marker bed | [events-2.jpg](painted-ages-captures/events-2.jpg) |
| The flash flood's pigment pulses (2 s, 4.5 s, at sunset) | [flood.jpg](painted-ages-captures/flood.jpg) |
| Ultra, Low, Minimal, WebGL2, a long record, back-to-back | [tiers.jpg](painted-ages-captures/tiers.jpg) |
| Phone (390 × 844): morning, sunset, four lines | [phone.jpg](painted-ages-captures/phone.jpg) |
| The real game: rest, a hard drop's ribbon, game over at dusk | [ingame.jpg](painted-ages-captures/ingame.jpg) |
| The clock alone in the real game (level 1, no clears) | [clock-ingame.jpg](painted-ages-captures/clock-ingame.jpg) |
| Icon at the picker's 80 px: before, after, neighbours | [icon-picker.jpg](painted-ages-captures/icon-picker.jpg) |

The icon is my pick: `look=-120,170,-420,38&hour=1.3&event=release&peak=8&eventAge=4` at
720 × 720, cropped to a 512 px circle with a light colour lift.

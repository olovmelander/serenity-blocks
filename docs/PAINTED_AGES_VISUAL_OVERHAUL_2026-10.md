# Painted Ages — visual rebuild (2026-10-12)

The owner asked for a total visual overhaul of Painted Ages ("the mountains, the clouds, the
colours, the composition, the landscape, the stairs, the flood, the sky, the style, the assets —
everything can be improved very much"), built on three r186 and made a visual masterpiece with
amazing lock-piece and combo effects, starting from `main` (3ff50fe7). He named the rebuilt themes
he likes as the bar: Ice Temple, Void Ember, Voltage Storm, Tornado, Sakura Twilight, Moonlit
Greenhouse, Summer (Midsommar), Golden Forest, Forest, Geode, Chiral Gold and Verdant Hills.

The theme keeps its id, name, Chapter 4 reward, song and the gameplay wiring that worked (the
adapter's lifecycle, the director, the layout readers, the mineral record of cleared rows). Every
visible thing is new: the land, its bake, the strata, the light, the sky, the clouds, the
landmarks, the water, every event and the post. The first build's implementation record is in
the git history (`docs/PAINTED_AGES_VISUAL_OVERHAUL_2026-10.md` at 3ff50fe7).

To look at it: `npm run dev`, then `/playground.html?effect=painted-ages&t=10&hour=1.2&board=1`
(`hour` 0 first light … 5 blue hour; `event=lock|drop|clear|quad|tspin|perfect|levelUp|release|over`
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

## Captures

| What | Image |
|---|---|
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

# Sunbraid — the living valley (2026-11-17)

Olov asked for an audit of Sunbraid and then for it to be made "one of the most visually stunning
themes in my game: a true graphical masterpiece": review "the colored suns in the sky, the stone
pillars and monoliths, the bands of colored light and shadow they cast across the ground, the
cracked tiled plain, the hazy horizon, the sky and clouds, the birds, the drifting dust, colors,
lighting, animations, UI and every event effect", keep what works and build on it, make it "varied
over time, shifting and evolving as you play so it never looks the same for long", give "every
event ... its own distinct effect", with "the biggest moments feeling the most spectacular", and
keep it smooth and readable. Blender was offered for models.

It follows [SUNBRAID_VISUAL_OVERHAUL_2026-10.md](SUNBRAID_VISUAL_OVERHAUL_2026-10.md) (the theme),
[SUNBRAID_ATMOSPHERE_2026-10.md](SUNBRAID_ATMOSPHERE_2026-10.md) and
[SUNBRAID_CRUST_AND_RAYS_2026-10.md](SUNBRAID_CRUST_AND_RAYS_2026-10.md) (the crust and the sky
rays, both kept as they were). Iterated in the playground on a private dev server with a private
headless Chrome (RTX 5080 laptop, WebGPU, 30 fps cap), then checked in the real game.

## The audit: what held it back

Captures of rest at three clock times, every event at several ages, the tiers, the WebGL2 backend
and a phone frame (kept in the session's scratchpad as the "before" set).

- **What worked and was kept:** the fans of coloured shadow on the white tiled floor (the theme's
  image), the crust, the three glass-marble suns, the braid as the one language of play, the one
  white sun of four lines.
- **The towers were silos.** Rounded stacks of cylinders under a stucco bump: no flat face (the
  whole point under three coloured suns: a plane is one clean colour), no silhouette to tell two
  apart, a smooth concave skirt for a foot.
- **The sky was one flat lavender.** The lens sees only the lowest 18° of the dome, where the old
  gradient hardly turned, and a flat cloud deck seen that low is squashed into thin grey dashes.
  No stars at dusk, nothing in the sky that changed but the suns' slow turn.
- **The horizon was a white band** over a low, pale rim: no depth beyond the valley.
- **Nothing changed with time but the braid's colours**: one weather, one air, one dry floor.
- **No dust** (the selenite's glints were the only specks), and the gliders were few and far.
- **Most events could not be seen.** Everything was said by moving the suns a little: a lock (the
  fans swing 2.6°), a hard drop, a clear's breath, a back-to-back and a level-up were all but
  invisible; a perfect clear looked like rest three seconds in; only four lines read, and their
  held frame was a flat grey.

## What changed

### The sky (`sunbraid-tsl.js` `SKY_LOOK`, `skyColor`, `braidLight`, `sbSunSky`)

- **The dome** turns from its horizon colour to its zenith inside the frame
  (`1 − e^(−5.2·up)` instead of `up^0.38`): a pale rose rim under deep cobalt-violet.
- **Each sun** keeps its corona and horizon glow, and gains a soft disc of glow a few degrees wide
  (`venn`): the three overlap round the triple star into the sums of their colours, the same sums
  the shadows are made of. Its disc is drawn in the lens's image plane (`lensPlane`, `disc0..2`),
  so it is round wherever it stands in the frame (drawn round a direction of the sky, a sun 30°
  off the axis was an egg), with a slow grain in its white heart and a thin atmosphere of its own
  colour round the limb (`SUN_LOOK`). The moon's disc is drawn the same way.
- **The high ice cloud** (`cirrusDensity`): streets of cirrus on a deck 7.2 km up that run along
  the wind, which blows toward the suns' bearing, so from the eye they fan out over the valley
  from under the triple star. One noise read stretched a dozen to one, bent by a slow warp; each
  street takes the colour of the sun it stands before (a tight forward lobe). The noise texture
  is read with anisotropy 8 for it.
- **Cloud banks along the rim** (`bankRank`): two ranks drawn on the dome as skylines over the
  bearing: a broad smooth swell with round heads riding on it (half-circles side by side, so the
  creases between them point down), bright at the crown, dusky toward the base, lit on the flank
  that faces the suns, soft-edged. They keep off the suns' bearing.
- **Far tablelands** (`mesaRank`): two ranks of flat-topped mesas beyond the valley's rim (a noise
  stepped into benches, a riser over a slope of scree between), little more than the sky a shade
  deeper, paler toward their feet, with faint beds across their cliffs.
- Banks and tablelands take their colour from the sky as it is behind them (the dome's gradient
  and each sun's glow low along its bearing), so they hold at dusk.
- **The moon** (`sunbraid-weather.js` `moonAt`, `discCover`): a small dark moon crosses the triple
  star about every 97 s on a path that differs each pass. Where it covers a sun, that sun's light
  fails for a few seconds and the whole valley turns the colour of the other two: an eclipse here
  is a change of colour, not of brightness. It never takes the one white sun.
- **Stars** at dusk (game over), hashed in cells of the bearing and the height, behind every cloud.

### The weather (`sunbraid-weather.js` `WEATHERS`, `weatherAt`)

A second wheel beside the braid (72 s a weather, 42 % of it at rest; the braid turns in 330 s, so
the two never line up the same way twice in a sitting). The clear day is first: a sitting opens
on the look the theme was made with.

| Weather | What it is |
|---|---|
| clear | the crisp day: a few fibres of high cloud, the fans sharp |
| cirrus | the streets of ice cloud fan out over the valley, each lit in a sun's colour |
| veil | a veil of ice: a pillar of light over each sun (three pillars that cross as the suns wheel) and a ghost of a ring round each |
| banks | cloud banks tower along the rim; their shadows cross the plain three times over, once in each sun's missing colour (`cloudShade` 0.5) |
| rain | a shower hangs from the banks; the plain begins to take water |
| wet | the shower has passed: a film of water mirrors the sky, the towers and the suns; it dries as the wind rises |
| wind | streamers of gypsum dust race over the crust, the air thickens, and a twister rises far out now and then |

### The floor (`sunbraid-land.js`)

- **The film of water** (`FLOOR_WATER`): it lies in the broad lows first and the crust's ridges
  stand out of it. It mirrors the dome and the suns (the same sky function, without the cloud),
  and the towers: the mirrored sight line is tested against the same cylinders that cast the
  shadows. Fresnel keeps the crust and its coloured shadows near the lens and gives the far plain
  to the mirror; ripples (two reads of the grain crossing) break the suns' images into glitter.
  It is a real branch on the wetness, so a dry floor does not pay for it. The two leanest tiers
  mirror a lean dome (`leanSky`: the gradient, a glow and a glint a sun).
- **Dust streamers** (`FLOOR_DUST`): pale streamers the ground wind drives across the view, lit as
  the floor under them is, with a lit flank and a lee (the same field read a step toward the
  suns), brighter than the floor because the suns stand in front of the eye.
- **Pulses of light in the crust** (`FLOOR_PULSE`, `crustPulses`, `sunbraid-pulses.js`): rings on
  the ground that light whole tiles (the ring is measured at the tile's centre) and their ridges
  brightest. A lit tile gives up most of its own light first: added to a floor already near white,
  a colour changes nothing.
- **The colour's front** (`landSuns`): the land's light is mixed between the suns' colours and
  the one white sun's by where a front stands, so after four lines the colour comes back across
  the valley from under the suns instead of everywhere at once.
- At dusk the set suns' afterglow lights the crust (`afterglow`), so the floor is not a black
  field.

### The dust (`sunbraid-dust.js`)

- **Twisters**: a column of white dust on one quad (the near and the far wall of a hollow tube read
  from one streak texture, so it turns), leaning with the ground wind and walking downwind. It
  stands in three suns' light: the world writes it into the shadow rows as a cylinder that lets
  most of the light past, so it throws three faint coloured shadows.
- **Dust rings**: a low band of dust on a circle that runs out with the ripple in the tiles.
- Both are lit colour with their own cover (light plus cover), always drawn, dormant at no size.

### The gliders (`sunbraid-glide.js` `WHEEL`, `wheelAt`)

More of them (High 10, was 6; four new loops nearer the lens), and they answer play: a chain
calls them off their loops to wheel round the triple star on a ring that faces the eye, some
crossing the suns' discs with their wings alight.

## Gameplay: every event has an effect of its own

The braid's own answers (sunbraid-braid.js) are unchanged; each event now also writes something
on the valley where it can be seen beside the board.

| Event | What the valley does |
|---|---|
| Lock | A ripple of light runs along the crust's cracks beside the board in the piece's colour, on the side the piece landed, nearer the lens the lower it landed. The commonest event is the quietest: ridges only, never a flood of colour by the card. |
| Hard drop | A wider ripple along the cracks (wider the farther it fell) and a ring of dust thrown up round it; the lens dips. |
| Line clear (1–3) | A ring a line runs out from under the board across the plain, each in the colour of the pieces its row was made of; the suns breathe. |
| Four lines | The suns join into one white sun with rays turning round it; the colour drains from the whole valley and the iris closes a fifth (a white valley at full exposure was two seconds of glare round the board); on their release the colour floods back behind a front that crosses the plain from under the suns, a ring of split light riding it. |
| Chain | Each sun trails a spiral arm of its own colour (a soft sleeve round a bright thread), longer and brighter a step, gone before it reaches the board's card; the gliders gather and wheel round the suns. |
| Twist | The suns change places (the fans' colours turn) and a twister stands up on the plain beside the board, a side each in turn; a twist that clears nothing raises a small one. |
| Back-to-back | The ribbons between the suns flare and a ring runs out from each sun across the sky and is gone (a crown's rings open and stand instead). |
| Perfect clear | The crown: a ring opens round each sun (three rings that cross), a pillar of light stands over each, three great rings of split light cross the plain to the rim, and every glider is called to the wheel. |
| Level up | The towers wake: a narrow band of light climbs each from its foot, the nearer towers first, one sun's colour shading into the next as it rises, and flares on the crown. The braid winds on a sixth. |
| Game over | The suns set; the stars come out; the afterglow, from where they set, catches the crust's ridges, and the towers stand dark against it. A new run raises them. |

## The towers (`sunbraid-monoliths.js`, `sunbraid-spires.js`, `scripts/blender/sunbraid_monoliths.py`)

The old towers were a surface swept round an axis in JavaScript (`sunbraid-spire-shape.js`, now
gone). The new ones are **sculpted by script in Blender**, run headless (nothing in an open
Blender session is touched), and exported as one generated module of base64 typed arrays
(`sunbraid-monolith-models.js`, 1.1 MB, no loader and no asset file; the same script writes the
same bytes):

```
"C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --factory-startup \
    --python scripts/blender/sunbraid_monoliths.py -- --out src/themes/sunbraid [--preview <dir>]
```

Eight jointed monoliths, the same kinds in the same slots as before (0 2 4 6 towers, 1 5 buttes,
3 7 mittens), each built for its silhouette first: the Organ (the hero: six pipes on a plinth with
a cleft of sky), the Table, the Stair, the Mitten, the Hoodoo (a waisted neck under a wide cap
rock), the Citadel, the Needle and the Fork. Polygonal prisms of flat faces and crisp arrises,
split by vertical joints into columns that break off at different heights, stepped by hard and
soft beds, with angular fallen blocks at the foot. Two levels each (`hi` 3,700–7,000 triangles,
`lo` 1,500–2,100; the two leanest tiers draw `lo`), every vertex carrying its plane's exact
normal, an ambient occlusion and a "crest" (0 in a joint, ½ on a face, 1 on an arris).

- **The shadows stay analytic.** The script works each shape's flat-topped shadow cylinders out
  from its own mesh (2–4 a shape; 44 for the 14 towers, was 31), and the land's plan reads them
  from the module (`monolithProxies`). The stone sits round them looser than a swept surface did
  (a tier's corners stand 16–25 % outside its cylinder, its joints 9–20 % inside), which the eye
  does not catch on a fan a kilometre long.
- **A tower leaves its own cylinders out of its own shadows** (`sunVisibility(…, own)`,
  `casterRanges`): a face set back inside its tier's cylinder would stand in that cylinder's shade.
  Its own form is shaded by its faces and the sculpt's occlusion.
- **The stone** (`TOWER_BEDS`, `TOWER_WEAR`): the formations and beds as before, no relief bump
  (the planes are the relief); exposed arrises worn pale and joints dark from the crest bake (at a
  third on `lo`, whose crest is blotchy); the occlusion bake is deep, so a face counts as open
  from 0.6 of it; more of the floor's glare on the shaded sides, which is what shows the stone's
  own warm colour on a tower seen against the suns; the rim light kept to upright faces (on a
  ledge's top seen edge-on it drew a bright dash along every ledge).
- **The level-up's light** (`TOWER_WAKE`) is in this material.

## An independent critique, and what it changed

With everything above in, a fresh reviewer was given the before and after frames and the brief,
no code, and asked for faults only. Its scores (before → after): overall 5 → 6.5, sky 5 → 6,
towers 4 → 6, floor 7 → 7, horizon 4 → 5, variety over time 4 → 8, events 3 → 7, the biggest
moments 4 → 7, gameplay readability 7 → 6: "better, not a masterpiece". These are a reviewer's
words about frames, not the owner's. What it found and what was done about it:

- **The commonest event was the loudest** (a hard drop flooded tiles with colour against the
  card; readability fell): locks and hard drops now light the ridges alone, reach less far and
  keep a wider margin from the card; a clear's tiles are paler.
- **A back-to-back looked like four lines**: its ring is in the sky now.
- **The arms crossed between the board and its panel**: they end 3.5 braid radii out.
- **The level-up's band was an airbrushed rainbow**: narrower, less than one turn of colour.
- **The horizon and banks were cut-outs** (a ruler-flat mesa in one tone; a sawtooth bank with a
  comb of streaks): rebuilt as described above.
- **The suns were eggs near the frame's edge**, and plain: round in the lens, with a grain and an
  atmosphere.
- **The towers were plastic** (flat, untextured, another style from the grainy floor), with dotted
  white pixels down their joints: a grain in the stone's colour, an arris light on towers that
  stand against the suns (tight: a wide lobe outlined every tower in white), joints nearly dark.
- **A pale band crossed each tower's shadow** at every tier's joint: the shadow cylinders overlap
  (`TIER_OVERLAP`).
- **The white moments were glare**: the iris closes for the one white sun; the crown's rings open
  in 1.2 s, not 1.9.
- **The default sky had lost its wisps** and one stray wisp read as a scribble: the clear day has
  more cirrus, in broader patches.
- **Dusk was flat** (a featureless floor, fog-pale towers, a magenta mesa): see "game over" above.
- **The wind was scan lines over the whole floor**: strands only inside sheets of dust.
- **The wet plain had dry rectangles far out and grainy speckle for glitter**: the far plain is
  wet as one, and a ripple is some five metres long.
- **The twister showed the noise's texels as diamonds**: read blurred.

Not acted on: the single-colour blotches on the floor are the gliders' shadows (one sun hidden:
that sun's missing colour), which are the theme's own rule and were there before; the portrait
rig (the hero tower and the suns partly behind the card on a phone) is as it was.

The round after the critique was checked by the same captures but **not judged again by a
reviewer**.

## Tried and dropped

- **A flat cloud deck for the banks**: seen from the valley floor everything round on it is a grey
  dash. The banks and the tablelands are skylines on the dome instead.
- **Banks coloured by the dome's rest colours**: magenta against a jade afterglow at dusk. They
  take the sky's own colour behind them.
- **`1 − |2n − 1|` for the banks' heads**: that is peaks; the banks were a mountain range. The fold
  `|2n − 1|` gives round heads.
- **Dust lit exactly as the floor**: invisible. It needed its own glow and a lit flank.
- **Additive tile pulses**: invisible on the white floor. A lit tile gives up its own light first.
- **The spiral arms as even bands**: plastic hoops. A soft sleeve round a bright thread.
- **An arris light with a wide lobe**: every tower in the valley was outlined in white.
- **Tiers of shadow cylinders stacked edge to edge**: each is half hidden at its own flat end, so
  a pale band crossed the shadow at every joint.
- **Ripples the size of the grain** (14 cm): under a pixel at any range, a speckle in the mirror.
- **A twister placed at the point of the plain under a point of the screen**: on a phone held
  upright that point is a few dozen metres from the lens, and the column stood over the frame.

## Verification

Checked on 2026-11-17 on the RTX 5080 laptop (WebGPU, adapter "nvidia blackwell"), branch
`feature/sunbraid-masterpiece` cut from main at 5b0dd5a2, uncommitted.

- **Playground** (`?effect=sunbraid`, a private dev server and a private headless Chrome, 30 fps
  cap): rest at 20, 60, 120, 200 and 240 s; all seven weathers held; the moon mid-transit; every
  event with its age (lock, drop, clear 2 and 3, four lines at five ages, back-to-back, a chain of
  4 to 9, twist, perfect clear at two ages, level-up, game over); Ultra, Low and Minimal; the
  WebGL2 backend (wet with a twist, a perfect clear); a phone frame (430 × 932); close-ups of the
  towers and the suns. Consoles clean in every one.
- **The real game** (single player, High, events sent through the game's own bus): locks, a hard
  drop, a clear, a twist, four lines, a level-up and a perfect clear; console clean.
- **Cost**, GPU ms per frame at High, 1920 × 1080, 30 fps cap, main and branch interleaved three
  times (timestamp queries; other sessions were using the GPU, single readings swung twofold, so
  only interleaved runs count): main 1.59, 1.59, 1.59; branch dry 1.93, 1.95, 1.93; branch wet
  2.29, 2.47, 2.30. About a fifth dearer dry, about half dearer wet.
- **Tests**: `tests/unit/sunbraid-living.test.js` (new: the weather wheel, the moon, the pulse
  table, the gliders' wheel, and what each event writes on the valley); the tower tests rewritten
  for the monoliths in `sunbraid-core.test.js`; all eleven Sunbraid files, 347 tests; the shader
  gate builds every material (the dust's too) in WGSL and GLSL under its size budget.
- **Gates**, on the finished tree: typecheck, the lint, TS and fitness ratchets at baseline,
  dependency boundaries, the theme lifecycle audit, the skill audit and mirror, a production build
  with the boot-closure check, the IP-string gate over the tree and the built bundle, the palette
  gate, the perf-budgets gate and the release gates.
- **Related tests** (`vitest run --changed`, 172 files, 4,229 tests): all pass but two files that
  timed out under load and pass alone (`breath-safety-gate`, `display-settings-apply`; neither
  touches the theme).

## Not measured, and known limits

- **The integrated GPU**: no cost number at all. The wet plain is the dear part (its mirror reads
  the sky and loops the shadow cylinders once more); the two leanest tiers mirror a lean dome.
- **Frame rate** uncapped, and the start-up cost of the two new dust pipelines.
- The whole test suite was not run (the 172 files related to the change were).
- **Local multiplayer, Infinity and online layouts** were not captured (lanes are chosen from the
  layout's rects, with a fallback under the card).
- The shadow cylinders fit the sculpted stone looser than they fitted the swept surface (see
  "The towers").
- `docs/theme-screenshots` was not refreshed; the picker icon was (a 34° lens on the hero tower
  at 60 s, baked to a 512 px disc).

## Open calls for the owner

These are the author's doubts, not the owner's words:

- **The towers' style.** Jointed, faceted monoliths are a clear step from natural buttes toward
  something monumental. If they read as too built, the script's joints and caps can be softened.
- **Rain** is a mood (banks, a duller light, a wet plain after), with no falling rain drawn.
- **The moon** recolours the whole valley every minute and a half for a few seconds. If that is
  too often, `MOON.period` is the one number.
- **The one white sun** still drains the valley's colour for about 1.7 s; the reviewer would
  rather it kept more colour. It is the theme's original signature, so it was kept and dimmed.
- **The gliders' shadows** read as stray blotches of one colour to a fresh eye.
- **How loud** the clear's tile rings should be beside the board.

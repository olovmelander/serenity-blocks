# Odyssey — the journey into space (2026-10-24)

**A plan in five steps, and the record of each as it lands.** Olov: *"I am still not happy with
the transition from the clouds into the space, are we not supposed to get over the clouds, not
having the clouds fade away right in front of us? And how can we improve the reveal of the planet,
and other space things and also really make the Aurora to fit into all of this. I think there is
potential to really improve this visually to make it become a visually perfect journey into
space."*

## What the player saw

The journey's own idle drift from late chapter 5 (p 0.64) into chapter 6, live, a frame every
5 s. Chapters 5 and 6 drift at 4.2 × 0.55 ≈ 2.3 u/s, halved within 0.03 of the boundary
(p 0.7543), so the passage takes about four minutes.

- **0:00–1:50, the clouds.** The rail rises only ~150 u through this stretch (the eye from
  y ~990 to ~1140), while the cumulus stand from ~830 to ~2030. The eye stays among them. As the
  sky went black the departure first thinned their paint (from p 0.59), then shrank each mass
  toward its own centre until it was gone (p 0.695–0.73). So the clouds dissolved in front of the
  eye and never sank below it. Only past the boundary, when everything was already the void's
  colour, did the world shrink away beneath the eye.
- **~1:50, the aurora.** It rose as a wall of curtains across the horizon, just beyond a flat,
  dark band of cloud (the cloud bank's horizon band). It was still up on the left when the black
  hole arrived at ~2:40.
- **~1:50, the planet.** It faded in at a fixed seat, low right, in front of the aurora and on top
  of the cloud band. Nothing said it was huge and far away.
- **2:30–3:00, the rest of space.** The Milky Way, the nebula and the black hole faded in one
  after another while the aurora was still up.

![Before: the drift from ~1:55 to ~4:05 (p 0.742–0.84), every 5–20 s: the aurora wall over the dark cloud band, the planet low right in front of it, then the Milky Way, the nebula and the black hole](images/odyssey-into-space-2026-10-24/ch5-ch6-space-before.jpg)

## The plan

1. **Climb above the clouds.** *Done (§1).*
2. **A round Earth below.** One curved planet replaces the flat dark band, the straight limb line
   and the shrinking flat world: the cloud sea on it, a thin glowing atmosphere at its edge, and
   an orbital sunset along that edge. As the eye climbs, the limb curves and drops, and the Earth
   sinks out of the bottom of the frame instead of vanishing. The dusk light on the cloud tops
   belongs here too (see §1, *Moved to step 2*). *Done (§2).*
3. **The aurora on Earth's night side, seen from above.** Green ribbons lying on the curved night
   side, curtains rising toward the eye, following the curve; it slides away with the Earth and is
   gone before the black hole arrives. One aurora: the airglow line and the green light on the
   clouds come from it. *Done (§3).*
4. **The planet rises over Earth's edge.** No fade: a thin sunlit crescent and the tips of the
   rings first, then the whole ringed body clears the curved horizon over ~20–30 s of drift.
   *Done (§4).*
5. **Then deep space, one thing at a time.** As the Earth falls away, the stars, the Milky Way and
   the nebula come up, then the black hole grows, each in clear sky. *Done (§5).*

Step 1 stands alone; step 2 is the backbone of steps 3 and 4. Each is iterated in the playground
first and checked on the live drift (`scratchpad odyssey-drift.cjs` + `sky-probe.js` in the
2026-10-24 session; the recipe is the ch2 drift probe's).

## §1. The climb above the clouds (2026-10-24)

**What changed.**

- **The eye climbs.** From late chapter 5 the world shrinks toward the sea-level point beneath the
  eye. A world shrunk by `s` about that point looks exactly like the same world seen from `1/s`
  times as high, since a perspective view has no scale. So the near cumulus sink below first, the
  far ones after, the island falls away and the horizon drops
  (`world/odyssey-world-act-gate.js` `worldClimbScale`, driven by the board through
  `setClimb`). The climb opens 0.22 of the sky chapter before the act edge (p 0.665, after the orb
  at 0.653) and runs to the visibility gate (p 0.7765), where the world is a speck straight down,
  as the old post-boundary recession left it. It is even in the logarithm of the height (a
  smoothstep of it): each doubling takes about as long as the last. It replaces the recession
  (`worldDepartureRecede`, `worldRecedeScale`).
- **Every world material shades in the climb's frame.** The materials were written for an
  identity group, and their haze, detail and fades all measure distances. A shrunken world shaded
  on its shrunken distances looks like a model, with crisp distance and little haze. So inside
  `createOdysseyWorld`, `positionWorld` and `cameraPosition` are three's nodes taken into the
  group's own frame (`inClimbFrame`): there the world keeps its size and the eye stands as high as
  the climb has taken it. Outside the climb the frame is the world frame. The ground lattice
  centres on the rail's track in the same frame.
- **The sky dome keeps its size.** It is in the world group and only looks along directions, so
  `setClimb` counter-scales it; shrunk with the rest it would come into view as a ball below the
  eye.
- **The world ends in the sky.** The sea is drawn out to the camera's far plane (a straight cut)
  or, high in the climb, to the clipmap's square, and the dome shows the sky below the horizon
  past it. Through the departure the far sea fades with the world and the dome with the horizon,
  so in the climb the sea read as a grey slab with a pale band beyond it. Over the last stretch
  before the drawn edge the sea and the ground now take the dome's own colour for their
  direction (`meltIntoSky`), so the cut and the square's corners vanish into the haze and the
  limb glow sits just above. It runs in a uniform branch only while the departure runs, so the
  rest of Act II pays nothing for it and keeps its horizon.
- **Removed:** the atmospheric thinning (`worldAtmosphericThin`, `setAtmosphericThin`, the field's
  paint collapse and its shrink) and the departure's shrink of each mass to nothing
  (`uFieldGone`). The masses keep their size and their sculpted paint, and fade with the horizon
  as before.
- **The playground follows the game:** `?effect=odyssey-world&p=0.70` pins the rail and runs the
  board's departure (the colour fade and the climb) from the same functions; `&climb=0` leaves it
  out for an A/B.

**Measured.** The eye's height over the sea, against the tallest cumulus top (1,743 over the sea), eye heights from the live drift:

| p | eye over the sea | the climb (×) | as seen from |
|---|---|---|---|
| 0.665 (climb opens) | 743 | 1 | 743 |
| 0.69 | 774 | 1.6 | 1,274 |
| 0.7037 (orb 34) | 793 | 3.0 | 2,342 |
| 0.7238 | 826 | 8.3 | 6,835 |
| 0.7543 (the boundary) | 875 | 33 | 29,192 |
| 0.7765 (the gate) | 909 | 50 | 45,435 |

On the live drift the cumulus are seen sinking below the horizon from ~0:40 to ~1:20
(p 0.677–0.715). The frame's mean brightness follows the old curve to within ~4 luma at every
station (the climb is a touch brighter at p 0.714–0.718, where the far sea now melts into the lit
horizon), so the departure's smooth darkening and the 5→6 seam are as they were. Console clean
(WebGPU, RTX 5080 Laptop).

![Before (top) and after (bottom) at 0:40, 0:51, 1:01, 1:11 and 1:21 of the drift (p 0.677–0.714)](images/odyssey-into-space-2026-10-24/ch5-climb-before-after.jpg)

**Not changed (steps 2–5).** The cloud bank's horizon band, the aurora, the airglow line, the
planet's reveal and the rest of space are as they were. From ~1:25 the frame looks as before.

**Moved to step 2: the dusk light.** Gold, then rose light on the cloud tops as the eye rises
needs a keyframe between the colour script's `cloud-deck` and `edge-of-space`, and that breaks two
of the script's tested rules: every air horizon converges on one blue hue, and only the two
declared seams may turn the hue fast. It belongs with the orbital sunset, where the light is
designed with the Earth.

**Tests.** `odyssey-world-act-gate` (the climb: full size until it opens, which is after the sky
begins to deepen; above every cumulus top by orb 34 on the real camera; even in the logarithm of the
height with no step; a speck at the gate; fractions survive a re-layout; driven by the board).
`odyssey-world-climb` (new: the point beneath the eye holds still while the rest draws in; the sky
dome keeps its size; identity outside the climb; the ground, the sea, the sky and the cloud field
build on WGSL and GLSL with nothing said, nothing stringified, and no var read before it is
assigned). `odyssey-world-lints` (every material reads positions and the eye in the climb's frame;
the cloud field's offset is the drift and the breath). `odyssey-ground-lever` follows the melt.

**Cost.** No new draws, pipelines or textures. A few multiply-adds per world fragment for the
climb's frame; the melt only while the departure runs.

## §2. The round Earth below (2026-10-24)

**What changed.**

- **One planet below the eye** (`composition/odyssey-orbit-earth.js`, `createOrbitEarth`). It is
  one exact sphere, solved per view direction in Earth radii with the eye at the origin, and drawn
  on a backdrop sphere round the camera. A ray meets it where `(k d.y)² > h(2 + h)`. The altitude
  of the ray's closest approach is negative exactly inside the disc, and that one number
  anti-aliases the limb and drives the rim.
  - **The surface** is a sea of cloud: broad weather systems, clear ocean between them, and detail
    octaves that fade where they fall under a pixel. It is white in sunlight, orange then red
    along the terminator, dim slate at night, and it sinks into the air toward the limb.
  - **The rim** is a thin band of air just outside the limb: blue on the day side, red under blue
    where the sunset meets the limb, deep blue at night, with a faint airglow line.
- **Its schedule** is `orbitEarthAt(p)`, in fractions of chapter 6's span, so a re-layout carries
  it.
  - It arrives over the world from the horizon down (p 0.690–0.712), its limb at the flat
    world's own horizon dip (5.4°). See *The seam, reworked* below.
  - The eye keeps climbing: the limb dips to ~12° by the boundary and ~45° as the Earth sinks out
    (p 0.807–0.818).
  - The sun sets at the eye (it crosses the horizon at p ≈ 0.735, is −7° at the boundary and −18°
    later), so the terminator comes in over the horizon ahead and passes under the eye. The
    journey flies into the night.
  - The view leans down 26° on a lens 8° wider (`resolveJourneyFraming`), so the Earth and the
    next orbs both fit. It is held to p 0.766 and back on the rail by p 0.799.
- **This is the dusk light moved from §1.** The gold, then rose, light lands on the Earth's cloud
  sea (p 0.70–0.736), designed with the sunset, not as a colour-script keyframe. The script's
  horizon and seam rules are untouched.
- **It replaces three things:**
  - the cloud bank (`odyssey-cloud-bank.js`, a flat dark band painted above the horizon);
  - the world dome's straight limb line, whose glow and airglow now yield to the Earth's rim
    (`setEarth`);
  - the flat world under the planet. The world's surfaces show the Earth in place and its clouds
    go into it (see *The seam, reworked*); once they have (p 0.722), the board switches the world's
    surfaces, cumulus, heroes and forest off, and nothing on screen changes.
- **Draw order.** The Earth is the nearest thing in the sky: in front of everything in space,
  behind the journey.
  - It draws at renderOrder −0.5: after the sky domes, before every transparent thing at 0 or
    above.
  - While the world shows it, its backdrop sits at 1,650 u, behind the world (it shows only past
    the world's drawn edge; the world shows the Earth on its own surfaces).
  - Once it covers the world it comes in to 320 u, inside every far hero (every part of the giant
    is ≥ ~600 u away while the Earth shows) and outside any orb seen over its disc.
  - A depth-only twin (`occluder`) marks the disc in the depth buffer. So the star shells, the
    nebula, the giant's rings and the black hole are hidden behind the planet by depth, whatever
    their own draw order.
  - **Found on the way:** at renderOrder 0.5 the Earth was drawn after the orb glass (transparent,
    renderOrder 0), so an orb passing over the disc lost its glass shell. That happens when orb 36
    passes at p 0.775. Drawn at −0.5, the orbs and the rail's glow stay in front.
- **Playground:** `?effect=odyssey-orbit-earth&p=0.755` shows the game's own height, sun and aurora
  at that progress, looking along the rail's bearing. `alt`, `sunEl`, `aurora`, `pitch` and `yaw`
  override them.

### The seam, reworked (2026-10-24, same day)

Olov, on the first version: *"now the earth just pops in and does not feel connected to the world
with the clouds … feel totally disconnected to the world with mountains ocean and clouds."*

**What the player saw** (the drift, p 0.689–0.718, top row below):

- The climbed world had become a grey slab. Its sea was one hazy grey-blue plane with a straight,
  kinked drawn edge under the horizon glow, and the shrunken cumulus read like rocks lying on it.
- At p 0.712 the Earth appeared whole, in one frame: a saturated blue planet with large white
  weather. It had faded in behind the world's sea, hidden by depth, and showed only when the world's
  surfaces were switched off.

**What changed.** There is no switch any more. The world becomes the Earth in place:

- **The Earth's look is one function of the view direction** (`earthLook` in
  `odyssey-orbit-earth.js`), on one shared state. Its backdrop draws it, and while it arrives the
  world's own materials draw it too (`orbitEarthOver`).
- **It comes in from the horizon down.** A front sweeps from its limb to the nadir as it arrives
  (`frontSin`, p 0.690–0.712, eased so it crosses the frame's lower half by ~0.700). Behind the
  front, and a little ahead of it, the world's sea and ground show what the Earth shows in that
  direction (`meltIntoSky`): the world's own air just ahead of the front, the planet behind it.
- **It arrives in the world's air.** Just behind its front it wears exactly the colour the world
  gives its far sea and sky there (`hazeFor`, the world's own shader expression), and clears
  within a few degrees behind the edge (`veil`). The planet comes up out of the haze line as the
  line rolls toward the eye.
- **The cumulus stay real clouds.** They are not melted by the front. They stay in front of the
  Earth and lit over it (the departing world's fade toward the void no longer greys them while the
  Earth is there), and the climb takes them down below the eye. Only once they are small
  (p 0.703–0.722, `cloudsAway`) do they go into the Earth, melting into what it shows behind
  them, never into the sky in front of the eye.
- **Only then is the world switched off** (`covers`, p 0.722), under a planet that already looks
  exactly as it does. Only then does the Earth come in to 320 u with its disc in depth, before the
  ringed giant's reveal at 0.725.

**Measured.**

- The frame's mean brightness runs smoothly through the seam: 115, 122, 98, 89, 83 at
  p 0.689, 0.699, 0.706, 0.711, 0.717.
- The largest step left in 0.68–0.735 is the sunset darkening the Earth's day side around
  p 0.73: −79 luma per 0.01 p, over ~15 s. The pop version measured −150 there.
- The world's materials build clean on WGSL and GLSL with the Earth's look inside them
  (`odyssey-world-climb`).
- The Earth's look runs only in a uniform branch while the Earth is there, so the rest of Act II
  pays nothing for it.

![Before (top) and after (bottom), the live drift at p 0.689, 0.699, 0.706, 0.711 and 0.717](images/odyssey-into-space-2026-10-24/ch5-earth-seam-before-after.jpg)

**Tests.** `odyssey-orbit-earth` pins the new contract:

- it arrives from the horizon down, wearing the world's air until its front has crossed the
  frame's lower half;
- it takes the world's clouds into it only after that;
- it covers the world only once they have gone and it has fully arrived, before the giant shows;
- it stays behind the world while the world shows it, and comes near with its disc in depth once
  it covers.

## §3. The aurora on the night side (2026-10-24)

**What changed.**

- **One aurora.** It is the Earth's: an oval round a pole that lies toward the night (opposite the
  sun's bearing). Its near arc passes ~3.4° of arc ahead of the eye and curves away to the limb on
  both sides. There are three folded sheets, the poleward ones fainter and each with its own folds.
  The old chapter-6 aurora bridge (`cosmic-expanse-aurora.js`) is removed.
- **The sheets are surfaces, not a fog.**
  - Each view ray is walked through the shell where the curtains stand (28 steps), and each sheet
    is crossed where its signed distance changes sign.
  - Each crossing is lit by its height: a sharp green foot, a body dying upward, a faint crimson
    top.
  - Its rays run along the oval, so a curtain seen side-on shows them upright, field-aligned.
  - It is lit over the path the ray spends inside a sheet of the given width, so a curtain seen
    edge-on brightens.
  - A faint glow gives the sheets their thickness (the ray just past a fold's silhouette still
    passes through the curtain's edge), and a soft shoulder holds the hue.
  - The aurora also greens the cloud under it.
- **Timing.** It lights at dusk (p 0.731), is whole from 0.745 to 0.761, and is gone by 0.773, as
  the black hole grows.
- **First live pass, and what fixed it.** The near arc ran under the eye, just above the curtain
  tops, so the curtains smeared into screen-tall green streaks: a wall over the lower half of the
  frame, its far arc burning white. Four changes fixed it:
  - the arc moved ahead of the eye (`poleArc` 0.375 → 0.41);
  - each sheet is crossed instead of marched as a volume (16 steps had widened every thin sheet
    over a whole step);
  - the screen-column streaks were dropped;
  - the light gets a lower ceiling (`shoulder` 0.65 → 1.4, `gain` 520 → 170).
- **Cost control.** A ray whose stretch through the shell never comes within the oval's reach of
  its mean radius skips the march. The shell is thin, so the stretch's two ends and its middle
  bound it.

## §4. The planetrise (2026-10-24)

**What changed.**

- **The geometry.** The Earth's limb always lies below the level line, and the ringed giant's seat
  lies above it (+4–7° through the passage). A giant that never moved could therefore never be
  behind the Earth.
- **Its one move.** Before its rise it hangs at ONE point 27° straight below its seat, as seen from
  the rail at the rise's middle, at the same distance, behind the limb (`planetBelow`).
  - It rises on one arc about that rail point to its seat over p 0.742–0.772
    (`orbitEarthAt().planetRise`, `resolvePlanetRisePlace`).
  - It is turned with the arc (`resolvePlanetRiseTurn`, its pole and its light), so it rises
    looking as it will hang.
  - It moves by progress alone, so an orb close-up never moves it.
  - Then it holds its one place, as Olov asked on 2026-10-20 ("placed in space on 1 place").
- **The summit fade** (p 0.725–0.75) now runs while the giant is behind the Earth, so no fade is
  ever seen.
- **The Earth is in front of it.** Its air rim and the aurora's curtains draw over the rising giant
  (§2's draw order).

**Measured** (the real camera leaning over the Earth, `odyssey-planetrise.test.js`, and the live
drift):

| p | what the player sees |
|---|---|
| 0.725–0.748 | the giant is hidden, its top ≥ 2° below the limb |
| ~0.748 | its top and the tips of its rings come over the edge, behind the aurora's curtains (aurora at full) |
| ~0.760 | its body is clear of the limb |
| 0.772 | it is in its seat, 13° clear |

The emergence takes ~24 s of the live drift; the whole rise ~57 s.

![After: the live drift at p 0.735, 0.745, 0.750, 0.753, 0.756, 0.760, 0.768 and 0.785: sunset on the cloud sea, the aurora at the limb, the giant rising behind its curtains, then the black hole growing as the Earth falls away](images/odyssey-into-space-2026-10-24/ch5-ch6-earth-after.jpg)

**Then (§5).** The Milky Way, the gas and the black hole's light used to arrive on the space gate
(p 0.754–0.773), under the aurora and the planetrise; they now come up after them, one at a time.

**Tests.**

- `odyssey-orbit-earth` (new) pins:
  - the schedule: the Earth arrives and leaves with no step, the limb only dips, the sun sets
    before the boundary, the aurora is lit at dusk and whole after sunset, and the giant rises
    once while the aurora is up;
  - the draw order: before the orb glass, at its backdrop radius while the world shows, in front
    of the far heroes with its disc in depth once it covers;
  - the planet and its depth twin building on WGSL and GLSL with nothing said and no unassigned
    reads.
- `odyssey-planetrise` (new) checks, on the real camera and the real chapter 6:
  - the giant is hidden behind the limb from its reveal to its rise;
  - it comes over the edge while the aurora is at full, and is clear when the rise ends;
  - it is always farther than the Earth's front radius, and every orb seen over the disc nearer.
- `odyssey-ch6-hero-framing`: the giant hangs at one point below the limb, rises on one arc only
  upward, by progress alone, then holds one place and one pole.
- `odyssey-seam-camera-continuity`: the seams' framings carry the Earth's lean.
- The cloud bank's and the aurora bridge's tests went with them.

**Cost.**

- The Earth is one transparent draw (fragment ~27 KB WGSL) plus a depth-only twin while it covers
  the world.
- The aurora's march runs only while it is lit, and only for rays near the oval.
- Gone: the cloud bank's draws and the aurora bridge.

## §5. Deep space, one thing at a time (2026-10-24)

**What the player saw.** On the real camera, the Milky Way (painted into the void dome, so it came
up with the dome), the black hole's light, its debris and the gas all began in the same 0.005 of
progress, p ~0.755–0.760, under the aurora at its height and the rising planet.

**What changed.** `DEEP_SPACE_BEATS` (in `cosmic-expanse.js`), in fractions of chapter 6's span
past the boundary, stages what is in space after the Earth's beats:

| Beat | p | What comes up |
|---|---|---|
| The Milky Way | 0.772–0.788 | the dome's painted cosmos (a new `uGlow` on the dome raises it out of its floor, so the dome still owns the background, near-black, from the boundary) and the far star tier, a share of which is seated in its band |
| The gas | 0.782–0.801 | the nebula field and sprites, and the disk light that paints them |
| The black hole | 0.789–0.822 | its disk, rings and halo (`uReveal`) and its debris, which glittered alone in the dark before |

- The hole's shadow and its lens are there from the boundary, as before: a void at the rail's end
  that bends the stars before it lights.
- It all starts after the aurora is out (0.773) and the planet has risen (0.772), as the Earth
  falls away.
- Between the aurora and the Milky Way the sky is clear and dark: stars, the risen giant and the
  sinking Earth.
- Headless callers (a chapter-local progress) still see the chapter whole.
- Chapter 7 seats the same baked sky with its glow at 1.

**Measured** (the live drift, before and after, from p 0.745):

- Brightness is the same to p 0.756.
- Space then stays darker while it waits: luma ~11–18 against ~17–24 before.
- The two converge by ~0.815.
- No step is added. The largest step in both runs is the same near orb leaving the frame at
  0.769.

![After: the live drift at p 0.767, 0.776, 0.782, 0.792, 0.803 and 0.826: the aurora goes out; a clear dark pause; the Milky Way; then the gas and the black hole's light](images/odyssey-into-space-2026-10-24/ch6-deep-space-after.jpg)

**Tests.** `odyssey-deep-space-beats` (new) pins:

- the beats by progress: whole without a layout, monotone, starting after the aurora and the
  planetrise, each once the one before is under way;
- the real chapter 6 on the game's camera: dark and clear before the Milky Way (the dome opaque,
  its glow 0, no far stars, no gas, the hole unlit, no debris); the Milky Way before the gas, the
  gas before the hole's light; the whole sky up after;
- the dome's glow building on both backends.


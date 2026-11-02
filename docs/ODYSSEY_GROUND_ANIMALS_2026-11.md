# Odyssey: animals on the island's ground (2026-11-01)

Nothing living walked on the island in chapters 3-5. Now a small herd of red deer grazes the glade
on the rise above the chapter-3 shore: three hinds, a yearling and a calf at its mother's side.

![Before and after, at L11, L14, L15 and L17](images/odyssey-animals-2026-11-01/before-after.jpg)

Left: before (`?odysseyNoDeer=1`). Right: after. Rows, top to bottom: L11, L14, L15, L17 (crops of
1600x900 shots, enlarged 2.5x).

## Choosing the place (the scouting numbers)

The rail camera flies high over the island: 63-172 m above the ground under it in chapters 3-4, and
170-350 m from L27 on. So the nearest open ground it ever sees is 120-200 m away, and always in the
lower part of the frame. Measured on the real rail camera with the real terrain and both forest tiers
(`tests/unit/helpers/odyssey-camera-rig.js`, `odysseyWorldHeight`, the forest scatter):

| Candidate | Seen from | Distance | Withers height at 1440p, 1x / 2x / 3x |
|---|---|---|---|
| Red deer, the glade above the chapter-3 shore | L11-L15 without a break, L17 | 120-240 m | 8-17 / 16-34 / 24-51 px |
| Red deer, the open ground at the massif's foot (z -430..-470) | only the L17-L19 glide, at the frame's bottom edge | 160-210 m | 6-11 / 12-22 / 18-33 px |
| Ibex on the massif's wall (L22-L26) | L22-L26, bottom edge of the frame | 130-170 m | 10-15 / 20-30 / 30-45 px (for a 1.3 m animal) |
| Ibex or chamois on the climb (L27-L28) | L27 only | 190-330 m | 5-9 / 10-18 / 15-27 px |

(The first row is the hind's withers, 1.16 m; the others are for a 1.3 m-shoulder animal.) The glade
wins: it is in view the longest (five
orbs, from the breach to L15, then again at L17), it is open grass on a gentle slope (under 0.4), it
faces the camera as the camera comes in from the sea, and the sun is behind the camera's shoulder.
The climb was ruled out: from L26 on the camera rises away from the rock, so ibex there would be
specks.

The deer are drawn at three times life, like the act's other life (the gulls, the butterflies). Their
withers are then 24-27 px tall at 1440p from the sea-side parks (L11-L14), 40 px at L15 and 51 px
at L17. From the sea some of them stand behind trees; at L15 and L17 most of the herd shows.

![Full frames at L11, L15 and L17, and a close crop at L17](images/odyssey-animals-2026-11-01/full-frames.jpg)

## The model

`scripts/blender/odyssey/red_deer.py`, headless Blender, rebuilds `assets/chapter-03/deer/red-deer.glb`
byte for byte. A red deer hind at real size: 1.16 m at the withers, built from rounded shapes,
1,786 triangles (1,798 after the polish below), skinned to 25 bones (spine, neck, head, ears,
four-bone legs, tail). The legs are a little thicker than life so they stay solid lines when drawn
small. The coat is painted into the vertex colours: red-brown body, greyer neck and legs, a pale
rump patch and belly, dark hooves and nose.

![The model's poses: alert, grazing, walking, looking round](images/odyssey-animals-2026-11-01/model-poses.jpg)

## Their life

- Every deer has its own clock (a seeded schedule that repeats every ~5 minutes). Their places come
  from the clock alone; the camera passes them.
- A hind keeps to her own two or three spots in the glade. She grazes with her head down, takes a
  step or two between bites, lifts her head to look round now and then, and every minute and a half
  or so walks a few paces to her next spot (turning on the spot first).
- The calf stays at its mother's flank, a quarter of a second behind her.
- The walk is a four-beat walk whose rhythm follows the distance walked, so the hooves do not slide.
- Feet on the ground: the body tilts with the slope, the legs hang plumb, the body is set down until
  its highest standing hoof touches the ground, and every other standing leg bends just enough to
  bring its hoof onto the ground too. The tests measure the result: standing hooves within 14 cm of
  the ground on a 3x hind (under half a pixel at these distances), and no hoof ever digs in.

![Six frames, 1.5 s apart, at L17: the hind grazes and steps, the calf beside her](images/odyssey-animals-2026-11-01/motion-l17.jpg)

## Light and shadow

The act's light: the world's low sun, the sky from above (softened toward warm air so a red coat in
shade stays brown, not purple), the green of the meadow from below, a little sky on the outline,
and the air between them and the eye. A soft shadow lies under each deer on the slope.

## No popping, no hitch

- They are drawn from p 0.08 (deep in chapter 2, under the sea) to p 0.26 (after L17, when the glade
  has left the frame). The test checks that the eye is far under water at the start and that every
  deer is out of the frame at the end, at every clock phase.
- The eagle's lifecycle: the model is fetched as chapter 2 begins, compiled while the board is idle,
  and only then drawn. If it fails to load, the island is exactly as it was.
- Turn it off with `?odysseyNoDeer=1`.

## Cost

- 2 draws: the whole herd is one instanced draw (5 x 1,786 = 8,930 triangles), plus one draw of 5
  soft shadows.
- Posing the herd costs about 0.05 ms a frame on the CPU; a 17 KB table goes to the GPU each frame.
- No new pipelines after the first compile.

## Tests

`tests/unit/odyssey-ground-animals.test.js`: the model and its skin; both shader backends (WGSL and
GLSL) build cleanly; hidden until ready; every deer on dry grass under 0.45 slope, clear of trunks
and low crowns in both forest tiers; hooves on the ground; the deer keep apart; a grazing muzzle
reaches the grass; the herd in view at L11-L17 with the pixel sizes above; never appearing or
leaving in view.

## Left for later

- A stag (antlers would be one or two pixels thick at this size and would flicker).
- Ibex on the massif: only worth it if the camera ever comes close to the rock. (Done lower down,
  2026-11-02: "Ibex on the rock band" below.)

## Polish (2026-11-01 evening)

The owner, up close: "The deer's head looks a bit horse-like. A slimmer muzzle, bigger ears and the
pale rump patch would fix it." Changed in the Blender builder (the rebuild is still byte for byte):

- **The head** is a deer's wedge now, not a horse's box: 0.34 m from the poll to the nose instead of
  0.40, deep at the cheek and the eye and narrowing to a fine nose, with a forehead and brows over
  large eyes (the eye line). It is a little smaller against the neck (the top of the neck is a touch
  thicker).
- **The ears** are bigger broad ovals with a rounded tip (21.5 cm long, 11 cm wide), set high on the
  poll and angled well out to the sides.
- **The rump patch**: everything on the buttocks that faces back, from just above the tail down toward
  the hocks, is a pale cream, with a slightly darker edge round its top and sides; the short tail on
  it is cream with a thin dark stripe along its top. A pale chin too. In the game the pale is creamier
  than before (it was a tan).
- Because the face is shorter, the grazing pose swings the neck a little lower (so the muzzle still
  reaches the grass); everything else (rig, weights, poses, herd, places) is as it was.
- 1,798 triangles (was 1,786). All the deer tests pass unchanged (hooves, places, sizes, no pop).
- Not done: spots on the calf. By September a red deer calf has mostly lost them, and at 15-25 px
  they would only read as noise.

![The model before (top) and after (bottom): side, three-quarter front, behind, the head](images/odyssey-animals-2026-11-01/polish-model-before-after.jpg)

In the game, before (left) and after (right), the same moments (the clock pinned): L17 three times,
then L15 (2560x1440, crops enlarged 2x):

![In the game, before and after](images/odyssey-animals-2026-11-01/polish-game-before-after.jpg)

Closer (L17, enlarged 4x): the rump patch now shows round the tail, the heads are finer.

![Close crop at L17, before and after](images/odyssey-animals-2026-11-01/polish-game-close.jpg)

### The orb card and the herd (lead, 2026-11-01 evening)

Checked with the screen as the owner sees it: 2560x1600 at 150 %, Odyssey started the way a click
starts it, the map reached with its Map button, the UI left on.
- The orb card sits on the right of the screen. On the rail at orb 15 the herd is at the lower left;
  at orb 17 it is near the bottom middle. The card never covers it.
- After clicking orb 15 or 17, the camera frames the orb close-up and the herd is out of frame to the
  left, so nothing covers it there either.

![The rail at orb 15 and orb 17 with the UI on: the card on the right, the herd lower left and bottom middle](images/odyssey-animals-2026-11-01/orb-card-l15-l17.jpg)

## GPU timing (lead, 2026-11-01 evening)

Timed with the birds, deer and fish together on the RTX at full speed (2560x1440, High, two rounds,
main against this work at the same stations: p 0.095 and 0.11 the fish, 0.168, 0.194 and 0.22 the
deer, gulls and swallows, 0.31 the swallows and geese, 0.62 the summit kettle). GPU time per frame
was within 0.07 ms of main at every station (for example 2.10 ms both at L15, 1.18 against 1.11-1.18
ms at the kettle), so the new animals cost nothing measurable there.

## Design and motion pass (2026-11-02)

The owner: "We really need to improve the look and design and animation and movement of the deer! I
want it to move in a more natural and smooth way when eating, walking, turning, looking etc."

### The audit (before)

Watched at game size (30 fps clips at L15 and L17 with the board clock pinned, so the same moments
can be compared) and measured on the game's own CPU twin of the herd over every deer's whole loop:

1. **Hooves slid while bearing weight.** The legs were swung by angles, not planted: a standing hoof
   moved up to 0.7-1.3 of the deer's drawn size over a stance (2-4 m on a 3x hind), most at the
   start and end of every walk.
2. **Pops.** A leg fix-up that switched on and off made joints jump: 285-744 frames a loop where a
   joint turned faster than 6 rad/s, the hooves up to 41 rad/s in single frames.
3. **Turning on the spot like a turntable.** 10-17 s a loop of the body turning while hardly
   moving, up to 4.3 rad/s; at L15 a hind spun about 180 degrees in place before walking off (top row
   of the L15 image below).
4. **The calf** hung at a fixed place beside its mother and was swung round her when she turned, at
   up to 12 m/s.
5. **A hinge for a neck.** Two neck bones: the head went down to graze and came up like a lever; no
   jaw, no breathing; grazing was a held pose with a small nod; ears and tail barely moved.
6. **The body.** Thick legs (to stay visible), a straight barrel with no waist, small eyes, little
   shading on the coat.

What a red deer does (and what the new motion follows): a four-beat walk, the hooves lifting left
hind, left fore, right hind, right fore, each on the ground about 60 % of the stride and planted
while it bears weight; the head nods with the fore feet; it turns by walking a curve with the body
following the head, or, for a sharp turn, by stepping the forehand round its hind legs; the head goes
down to graze over a second or two, crops in small nods and sways and chews; it looks up ears first,
then the head, then the neck; the tail and ears flick.

### What changed

**The model** (`scripts/blender/odyssey/red_deer.py`, still rebuilt byte for byte): 27 bones (three
neck bones and a jaw), a deeper chest, a tucked-up waist, rounder quarters, longer, slimmer legs with
clearer knees and hocks, larger eyes in a dark rim, a darker back line, a paler belly and darker lower
legs. 2,098 triangles (was 1,798). The neck's root blends into the chest over a longer band so the
bend down to graze is a curve over the withers.

![The model before (top) and after (bottom): side, three-quarter front, behind, the head](images/odyssey-animals-2026-11-02/model-before-after.jpg)

**The motion** (`composition/odyssey-deer-herd.js`, rewritten). Procedural, not baked Blender
cycles: the deer walk on a sloping glade along curves of any length and turn by any angle, so baked
cycles would have to be stretched, blended and corrected for the ground anyway (that is where foot
sliding comes from). Instead:
- **Paths.** Walks are curves that leave the way the deer faces, with a smooth start and stop (no
  instant start or stop); a turn too sharp for a curve is first made on the spot by pivoting round the
  hind legs, never faster than 0.7 rad/s. Grazing steps are short, slow curves.
- **Feet.** A footstep planner walks each deer through its loop once when the herd loads (about 10 ms
  a deer, one deer per task so it never holds a frame) and records every hoof's steps. While the deer
  moves, the hooves lift in the four-beat order as the ground goes by (shorter, quicker steps when
  it moves slowly); where each one lands is where it should stand half a stance later; when it stops,
  the hooves settle under it with a step or two. A planted hoof never moves.
- **Legs** reach their hooves with a two-segment solve each (the knees fold back, the hocks forward,
  each never past about 110 degrees), the hoof flat on the ground while planted and flicked back in
  the swing.
- **Body** rides on the feet: height, pitch and roll from the ground under them, carried a little
  lower in a walk, hips and shoulders rolling with each step, breathing, a slow shift of weight while
  it stands.
- **Head and neck** move through the three neck bones; every change (head down to graze, up to look)
  is eased over 1-2 s on a curve that cannot jump, however short the segments. Grazing crops with
  small nods and sways and the jaw chews; it chews the cud now and then with the head up. A look turns
  the ears first, then the head, then the neck down its length. Ears swivel and flick, the tail
  flicks.
- The calf has its own spots next to its mother's (a fixed slot at her side swung it round her).

![Blender close-ups of the game's own motion, 0.6 s apart: grazing, the head comes up, a turn stepped round, the walk](images/odyssey-animals-2026-11-02/blender-turn-walk.jpg)

![Grazing: the head going down over 1.8 s, a step, cropping](images/odyssey-animals-2026-11-02/blender-graze.jpg)

![A look: the head comes up from grazing, ears and head lead, the neck follows](images/odyssey-animals-2026-11-02/blender-look.jpg)

In the game, before (top row) and after (bottom row), one frame a second, the same moments of the
board clock (2560x1440, crops enlarged):

![L17: a turn and the walk after it](images/odyssey-animals-2026-11-02/game-l17-turn-walk.jpg)

![L17: grazing and a look-up](images/odyssey-animals-2026-11-02/game-l17-graze-look.jpg)

![L15: before, a spin on the spot; after, a stepped turn and a walk along a curve](images/odyssey-animals-2026-11-02/game-l15-turn-walk.jpg)

### Numbers (after, every deer's whole loop at 30 fps)

| | before | after |
|---|---|---|
| A weight-bearing hoof's slide (share of the drawn size) | 0.7-1.3 | under 0.05 in 99 % of frames, 0.16 at worst |
| Fastest leg joint | 38-41 rad/s (pops) | 10-14 rad/s (a walk's swing) |
| Fastest spine, neck or head joint | (part of the pops) | about 3 rad/s (the head going down to graze) |
| Turning on the spot | up to 4.3 rad/s, spun | at most 0.64 rad/s, stepped round |
| Turning in a walk | | at most 0.23 rad/s (curves) |
| Body acceleration | | at most 2.7 m/s^2 |
| Walk order kept | | 89-100 % of lifts |
| CPU per frame (whole herd) | ~0.05 ms | ~0.03 ms |

Still two draws (5 x 2,098 = 10,490 triangles plus the shadows), no new pipelines after the first
compile, the same places, sizes and no-pop windows, `?odysseyNoDeer=1` as before. New tests in
`tests/unit/odyssey-ground-animals.test.js`: no hoof slides, every joint smooth through every change
of state, smooth starts and stops, turns walked or stepped round (never spun), the four-beat order,
the loop's seam, walks leaving the way the deer faces.

## Life at the pond (2026-11-02)

The owner agreed to: "Life at the pond. It's on screen from orbs 20 to 23. A pair of white swans
glides across it, leaving V-shaped wakes ... A grey heron stands in the shallows, stalks slowly and
now and then strikes. A hind and her calf from the herd sometimes come down to drink at the bank."

![Before (left, `?odysseyNoPondLife=1`) and after (right): the L18 -> L19 glide (p 0.25), L22 and L23 (crops of 1280x720 shots, enlarged 3x)](images/odyssey-animals-2026-11-02/pond-before-after.jpg)

### Where, with numbers

Scored on the real rail camera (`odyssey-camera-rig.js`, the terrain, the forest's crowns as
spheres):

- **When it is in view.** Nearly the whole tarn is in frame and unblocked while the rail glides
  from L18 to L19 (p 0.23-0.267). It leaves the frame at the L19-L21 parks (p 0.269-0.272). It comes
  back at L22 and L23 (p 0.278-0.30), but only its west lobe.
- **So everything lives on the west side:**
  - the swans' route runs through the west and middle lobes;
  - the heron keeps to the west lobe's south-west shallows;
  - the drinkers come down to the west lobe's bank.
- **Why that bank.** The bowl's rim is steep (0.5-0.9) almost all round. Its gentlest crossing is
  on the west side, about 0.6.

At 1440p, drawn at three times life:

| | Distance | Size at 1440p |
|---|---|---|
| A swan (3.4 u long) | 190-320 u | 13-22 px long |
| The heron (3.1 u tall) | 190-310 u | 12-20 px tall |
| The hind (withers 3.5 u) | 200-325 u | 13-22 px |

They are smaller than the glade's deer (24-51 px), but white on turquoise, a grey stroke on the
bank and a red-brown pair over the water all read.

![Full frames at p 0.25 and L22, before and after](images/odyssey-animals-2026-11-02/pond-full-frames.jpg)

### The models

`scripts/blender/odyssey/pond_birds.py`, headless Blender, writes `assets/chapter-03/pond/swan.glb`
and `heron.glb`. It uses the red deer's method: a distance field of ellipsoids, round cones and
tubes, its left half meshed, decimated and mirrored, then painted and skinned.

- **The mute swan:**
  - 1,300 triangles, 6 bones (the root, four neck bones, the head);
  - the hull cut at the waterline, the arched wings and raised tail;
  - the neck in an S, an orange bill with its black knob.
- **The grey heron:**
  - 1,150 triangles, 11 bones (the root, three neck bones, the head, and each leg's thigh, shin and
    foot);
  - the body tilted up at the front, a white neck, a black crest and eye stripe, a yellow dagger
    bill;
  - long yellow legs, 1.9x thicker than life so they stay lines when drawn small.

![The swan and the heron (Blender previews, life size)](images/odyssey-animals-2026-11-02/pond-birds-model.jpg)

### Their life (`composition/odyssey-pond-life-motion.js`)

Everything follows the board clock and is fixed in the world. The camera only passes them.

- **The swans** glide round one closed, smooth route through the deep water at ~0.95 u/s, the speed
  breathing slowly. The second swims 8.5 s behind the first and 2.6 u to its left. On their own
  loops each:
  - looks round;
  - dips its head under to feed;
  - or turns its neck back over the wing to preen.

  The neck sways a little all the time. The hull sits 0.2 u under the water, and the water hides
  the cut.
- **The heron:**
  - Stands mostly still, as herons do, its head turning slowly.
  - Leans into a slow stalk now and then, and sometimes strikes: a crouch, the neck shot out and
    down in 0.18 s, held, drawn back over 1.5 s.
  - Every 40-70 s walks a few slow steps to its next spot. Each foot is planted where it lands
    while the body passes over it, and a two-segment leg solve reaches it; the heel bends back.
    The body turns from the way it stood to the way it walks over the first step. It stands
    facing the way it came.
- **The drinkers** are a second, small herd (`ODYSSEY_TARN_DEER`): the glade's deer model, rig,
  paths and footsteps, created again (`createOdysseyDeer({ herd })`). A hind and her calf keep to
  the ground west of the tarn. A third of their five-minute loop they stand at the bank grazing,
  which here is drinking: the head down to the water at the waterline. The calf keeps spots beside
  its mother's and walks a little slower, so it follows her down a few seconds behind.

![L22, six frames 1.6 s apart: the swans move on, their wakes behind; the heron in the shallows; the drinkers at the bank](images/odyssey-animals-2026-11-02/pond-clip-l22.jpg)

### The wakes and the swans in the water

The tarn's own water draws them (`TARN_WAKE` in the world renderer). Each frame the swans' places
and velocities go to the world (`setTarnSwans`).

- **The wake.** Behind each swan is a soft V at the Kelvin angle (~19.5°). Its arms are a few short
  crests that travel outward, widening and fading over ~34 u, with a small bow wave round the
  breast. They tilt the water, so they show in its reflection and glints, and they lift it a little
  toward white.
- **The swans in the water.** The reflected ray's nearest pass to each swan's body and neck gives
  a soft white shape under it, broken by the pond's ripple.
- **The tarn stays the turquoise pool it is.** With no swans the water is unchanged.

### No popping, no hitch

- **Drawn from p 0.09 to 0.34.** The eye is far under the sea when the window opens. As it closes,
  every swan, the heron and the drinkers' spots are out of frame (tested at every clock phase).
- **The deer's lifecycle.** The models are fetched as chapter 2 begins, compiled while the board is
  idle, and only then drawn. If they fail to load, the act is as it was.
- **Turn it off** with `?odysseyNoPondLife=1`.

### Cost

| | Triangles | Draws |
|---|---|---|
| The swans | 2 x 1,300 | 1 |
| The heron | 1,150 | 1 |
| The drinkers | 2 x 2,098 | 2 (the herd's draw and its shadows) |

- **Pipelines.** Two new: the birds' material, built per species. The drinkers reuse the deer's.
- **The tarn.** Its water gains the wake and the mirror term for two swans, on its own pixels only.
- **CPU.** Posing three birds and two deer each frame. The tables are written in place: no new
  per-frame allocation.

### Tests (`tests/unit/odyssey-pond-life.test.js`)

- **The models:** the skeletons, the skins (weights sum to 1, every index in the skeleton), and
  both shader backends (WGSL and GLSL) building the birds' draw cleanly.
- **The draw:** hidden until ready, drawn only in the window, the wakes sent to the world and
  withdrawn.
- **The swans:**
  - never leave the water: the whole hull over water 0.6 u deep or more, all the loop;
  - keep apart;
  - turn and change speed calmly;
  - the head under water only when dipping.
- **The heron:**
  - its feet in the shallows;
  - a planted foot never slides;
  - its legs reach their feet.
- **The drinkers:**
  - reach the water's edge, never deeper than the fetlocks;
  - cross the gentlest stretch of the rim (under 0.75);
  - their standing hooves on the ground;
  - clear of trees and the boulders.
- **The camera:**
  - swans in frame for most of the L18 -> L19 glide and a quarter of the time at L22-L23;
  - the heron and the bank in frame there;
  - the sizes above;
  - never appearing or leaving in view.

### Left for later

- **The drinkers' timing** follows their own five-minute loop, so a given pass may find them on the
  ground above the bank rather than at the water.
- **The heron does not catch anything.** Its strike comes back empty.

## Ibex on the rock band (2026-11-02)

The owner, on the animals pass: ibex, "but further down, not at the snowy top". A buck, two nannies
and a kid now live on the shelf at the top of the grey rock band at the massif's foot, east of
where the rail climbs the face. They graze, look round, walk short curves and, now and then, leap.

### Not at the top: why

The first scout looked at the summit's rock from the chapter-5 climb, with the new climb views.
I measured every rock point the climb can see, on the real rail camera with the real terrain:

| | Biggest 3x buck at 1440p (shoulder) | Distance | Where in the frame |
|---|---|---|---|
| L27-L28 | 10-14 px | 280-390 m | middle |
| L29-L30 | 15-19 px | 245-285 m | bottom edge |
| L31 | 21 px | 224 m | bottom edge |
| L32-L33 | 25-30 px | 171-188 m | bottom-left corner |

- No ledge reads from more than one orb: none is 18 px or more from two parks.
- The 25-30 px figures come from the frame's edge, where the lens stretches things.
- Nothing is against the sky from any climb park. The camera rises away from the rock.

![The climb's best ledges (red rings), with a 3x buck's body to scale (dark boxes), at L30-L33](images/odyssey-animals-2026-11-02/ibex-summit-scout.jpg)

### Choosing the place

The second scout covered the lower rocky ground: the boulder outcrops on the slopes, the massif's
foot wall, and the rock bands between the forest and the snow.
- **The boulders** are 300-700 u from the rail at every park, so 5-15 px.
- **The foot wall** is the only place in view for several orbs. Its rock band (slope 1.0-1.2,
  which the ground paints grey) runs along the massif's foot at about (-150, -560). Above it lies a
  shelf of gentler ground (slope 0.3-0.5) that can hold an animal's feet.
- **The trees.** The shelf has a few. The spots keep clear of their trunks and low crowns, in both
  forest tiers.

| Park | Buck (3x, 0.93 m shoulder) at 1440p | Where in the frame |
|---|---|---|
| L17-L18 | ~11 px | right of the middle |
| L19-L21 | 13 px | the middle, low |
| L22 | 19 px | right |
| L23 | out (the view turns west) | |
| L24 | 25 px | lower right |
| L25 | 28 px | lower right |

The nannies are about four fifths of the buck's size; the kid a little under half. That is short of
the hope (25 px or more, mid-frame, for several orbs): they read at 25-28 px from two orbs and are
smaller from the others. They are drawn from p 0.179 to 0.348. At both ends they are out of the
frame at every clock phase.

### The model

`scripts/blender/odyssey/alpine_ibex.py` (headless Blender, rebuilt byte for byte) makes
`assets/chapter-04/ibex/alpine-ibex.glb`. It uses the red deer's method and meshing:
- **Body.** A stocky, deep-chested goat on short, sturdy legs, with a short thick neck and a short,
  broad head carried steep. It is built at a nanny's size: 0.79 m at the withers.
- **Horns.** One model serves all four. Every horn vertex carries its root (`_horn`), and the game
  scales each horn about its root per animal:
  - the buck's great backward sweep, about 0.85 m along the curve;
  - a nanny's short horns;
  - the kid's buds.
- **Skeleton.** The deer's own 27 bones, so the deer's herd code poses the ibex unchanged.
- **Coat.** A grey-brown summer coat, darker down the fronts of the legs, along the back and on the
  chest; a pale belly; dark hooves, nose and eyes.
- **Size.** 2,192 triangles.

![The model: the buck, a nanny and the kid, the buck grazing, a nanny looking round; the buck's side](images/odyssey-animals-2026-11-02/ibex-model.jpg)

### Their life, and the leap

Each ibex keeps to two or three spots on the shelf, with the deer's life between them:
- planned footfalls, so a planted hoof never slides;
- walked curves and stepped turns;
- grazing with small nods and a chewing jaw;
- looks that turn the ears, then the head, then the neck.

The new thing is **the leap** (in `odyssey-deer-herd.js`; deer never leap):
- **Before:** the ibex looks to where it will land and turns to face it on the spot.
- **Crouch:** the body sinks, then springs.
- **Flight:** a straight line at a steady speed, on an arc whose height grows with the distance.
  - The hooves leave together, the fores a moment first, and ride the arc folded up.
  - The body tips nose up off the rock and nose down to land, held to about 17°.
- **Landing:** the fores first, on the spots the planner chose; every hoof stays planted. The body
  gives with the landing.

The buck and each nanny leap between two of their spots once a loop (5-9 u at three times life),
and the kid hops twice near its mother.

![The buck turns to the landing and leaps (L25, 0.2 s apart, 2560x1440 crops)](images/odyssey-animals-2026-11-02/ibex-leap.jpg)

![On the shelf above the grey band at L24, 0.7 s apart: grazing, a look, the kid's hop](images/odyssey-animals-2026-11-02/ibex-on-the-shelf.jpg)

![Before and after at L21, L22, L24 and L25 (2560x1440 crops, the board clock pinned)](images/odyssey-animals-2026-11-02/ibex-before-after.jpg)

### Light, popping, cost

- **Light and shadow:** the deer's, with a contact shadow under each animal that fades while it is
  in the air.
- **No popping, no hitch:** they come in the deer's way. They are fetched as their window nears,
  compiled while the board is idle, and only then drawn. The ibex runs that lifecycle itself
  (`tick`), so the board edit is an import, a create, a tick and a dispose.
  - Turn them off with `?odysseyNoIbex=1`.
- **Cost:** two draws (4 x 2,192 = 8,768 triangles, plus the shadows), no new pipelines after the
  first compile.
  - Posing the group takes about 0.06 ms a frame on the CPU (measured with the full height
    function; the game reads the faster height mirror).
  - Planning the footfalls takes about 11 ms an animal, once, one animal per task.

### Tests

`tests/unit/odyssey-ibex.test.js` checks:
- **The model:** the deer's skeleton, the horns riding the head, and the triangle budget.
- **The shaders:** both backends build cleanly.
- **Lifecycle:** hidden until ready.
- **The ground:** every animal on the standable shelf by the rock band, clear of the trees.
- **The feet:** the hooves bearing weight where the plan put them (99 % within 0.07 of the drawn
  size). In the air the hooves stay out of the rock (under 0.2).
- **Spacing:** the animals keep apart.
- **The leaps:** all four hooves leave, the arc rises, and all four land planted near the landing.
- **The camera:** in view at L19-L25 (but L23) at the sizes above, and never appearing or leaving in
  view.

The deer's tests pass unchanged: the leap only runs for a member that asks for one.

### Left for later

- **Rock under their feet.** The shelf is grass, just above the grey band. The rock that the ground
  paints grey is the band itself, at slope 1.0-1.2. That is too steep for the leg solver to stand
  on without the hooves sliding or sinking. A few perch slabs on the shelf (the boulders' rocks)
  would give the classic picture of an ibex on a rock, and something to leap between.
- **A dark buck.** In late autumn the buck's coat darkens almost to black. At these sizes, darker
  would read as a hole in the grass.

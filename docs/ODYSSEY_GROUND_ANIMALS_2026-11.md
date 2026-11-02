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
- Ibex on the massif: only worth it if the camera ever comes close to the rock.

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

### Design and motion pass (2026-11-02)

The owner asked: "are the animals designed so they are visually stunning and animates so that the
animation and movements feels natural and smooth?" They were not yet. The first swan read as a pool
float with a straight neck, and the heron as a grey blob on yellow stilts. Nobody had watched them
move up close.

**A way to watch them.** The playground effect `odyssey-pond-life` shows the game's own poses with a
camera that follows one animal:

- `animal=swan0|swan1|heron|hind|calf`;
- `view=34|side|front|back|top|game`;
- `t0=` sets where on the animal's clock to start, and `?t=` gives phase-locked frames.

All the clips below are its frames.

**The models** (`pond_birds.py`), rebuilt from reference proportions:

- **The mute swan.** The body is long, low and tapers to both ends, with the tail lifted to a point.
  The neck is a deep S that arches forward at the top, the head held with the bill angled down. The
  orange bill is black at its base and carries the black knob. The wings are raised and arched over
  the back ("busking"): the two humps of the fluffed scapulars make the heart-shaped back seen from
  behind. The wings are their own bones (9 bones, 1,598 triangles).
- **The grey heron.** It is slender and upright, the body held up at ~35°. The neck is folded into an
  S and hunched into the shoulders. It has a dagger bill, a white face with the black stripe from the
  eye to the long crest plumes, a grey back with black shoulder patches, dark primaries, a streaked
  pale front and hanging breast plumes. The legs are thinner than before but still 1.55x life, so
  they read (12 bones, 1,338 triangles).

![Before: the first models (Blender, life size)](images/odyssey-animals-2026-11-02/pond-models-before.jpg)

![After: the swan and the heron from the front, side, behind, above and three-quarter](images/odyssey-animals-2026-11-02/pond-models-after.jpg)

![In the game's own light (the playground), before and after: front, side, behind, above, three-quarter, game distance](images/odyssey-animals-2026-11-02/pond-models-ingame-before.jpg)

![...after](images/odyssey-animals-2026-11-02/pond-models-ingame-after.jpg)

At game size (L22 and L23, 4x crops, before left, after right), the swans show their S necks and
raised backs, and their V wakes trail behind:

![Game size, before and after](images/odyssey-animals-2026-11-02/pond-game-size.jpg)

**The motion** (`odyssey-pond-life-motion.js`):

- **Necks are posed by segment angles.** Each pose (rest, a swan's dip or stretch, a heron's stalk,
  coil and shot) gives every neck segment its angle in the bird's plane. Each bone takes the change
  less what its parents already turned, so the chain always bends as one curve. The head keeps its
  own pitch whatever the neck does: level while the heron stalks, the bill down to feed or strike.
- **The swans:**
  - The paddle strokes give a slight surge, bob and rock, at each swan's own rate.
  - They lean into turns.
  - The neck sways, the motion travelling down it.
  - A look is a turn, a hold and a turn back, each eased.
  - Feeding reaches the neck forward and down until the head is under, the body tipping forward.
  - Preening swings the neck back over the wing.
  - Once a loop each swan sits back, opens its neck upright, and lifts and beats its wings twice.
  - Every event is eased in and out, and each swan has its own timing.
- **The heron:**
  - It breathes, and turns its head in small, quick, eased steps between holds, settling to the
    front before and after a walk.
  - It stalks one deliberate step at a time: it lifts a foot, carries the body over it, sets it
    down and pauses (0.7-1.9 s, different every time). The trailing foot comes up beside the other
    at the end.
  - While the body moves under it, its head stays still in the air. A few iterative steps on the
    neck angles hold the head back by exactly what the body has moved; the head glides on in the
    pause. In the tests the head moves less than a fifth as far as the body during a step.
  - The strike leans in, draws the neck into a tight coil, shoots it out and down in 0.2 s (eased at
    both ends), holds, and draws back.
  - Some strikes are followed by a quick, dying head shake.
- **The drinking deer.** The head comes down to the water over ~2 s on the herd's own eased curves.
  It was already smooth, and was left as it was.

Before (top) and after (bottom), the same moments of each clock:

![A swan feeding, before](images/odyssey-animals-2026-11-02/pond-motion-swan-dip-before.jpg)

![A swan feeding, after: the neck reaches forward and down, the head goes under](images/odyssey-animals-2026-11-02/pond-motion-swan-dip.jpg)

![The heron's strike, before](images/odyssey-animals-2026-11-02/pond-motion-heron-strike-before.jpg)

![The heron's strike, after: the coil, the shot, the hold and the slow return](images/odyssey-animals-2026-11-02/pond-motion-heron-strike.jpg)

![The heron walking, before: a continuous gait](images/odyssey-animals-2026-11-02/pond-motion-heron-walk-before.jpg)

![The heron stalking, after: one step at a time, the head held level and still](images/odyssey-animals-2026-11-02/pond-motion-heron-stalk.jpg)

The other behaviours, after:

![The swans gliding (paddle bob and rock, 0.25 s apart)](images/odyssey-animals-2026-11-02/pond-motion-swan-glide.jpg)

![Preening](images/odyssey-animals-2026-11-02/pond-motion-swan-preen.jpg)

![The wing stretch](images/odyssey-animals-2026-11-02/pond-motion-swan-stretch.jpg)

![The heron standing: breathing, small head turns](images/odyssey-animals-2026-11-02/pond-motion-heron-stand.jpg)

![A shake after a strike](images/odyssey-animals-2026-11-02/pond-motion-heron-shake.jpg)

![The hind lowering her head to drink](images/odyssey-animals-2026-11-02/pond-motion-deer-drink.jpg)

**Tests** (added to `tests/unit/odyssey-pond-life.test.js`):

- the new skeletons;
- a dipping swan's head goes under the water;
- no swan bone turns faster than 6 rad/s at 30 fps (the wing beat is the fastest);
- the heron's head stays still during its steps (it moves under 0.2 of the body's travel);
- no heron bone turns faster than 12 rad/s outside the strike's shot, nor 30 rad/s in it (eased,
  never a jump).

The paddle surge is allowed in the calm-speed test (under 0.5 u/s²).

### Left for later

- **The drinkers' timing** follows their own five-minute loop, so a given pass may find them on the
  ground above the bank rather than at the water.
- **The heron does not catch anything.** Its strike comes back empty.
- **The swans' paddling feet** are not drawn: under the turquoise they would not show.

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

## Wild horses on the meadow (2026-11-02)

The owner agreed to: "A band of wild horses on the open meadows (chapters 3-4). Most of the time they
graze and wander, with a foal beside its mother. Now and then they run in a wide arc across the
meadow with a little dust, a moment you catch from the path."

### Choosing the place (the scouting numbers)

Measured on the real rail camera (`tests/unit/helpers/odyssey-camera-rig.js`), the real terrain and
both forest tiers, every 10 m over the island, for every orb park of chapters 3-4 and the glides
between them. A cell counts as open meadow when it is dry, its slope is under 0.3, it is clear of the
boulders, the tarn and the rail's ground track, and it is more than 3 m outside the inner 60 % of every
crown. The withers of a 3x mare are 4.1 m tall.

| Open ground | Seen from (withers at 1440p) | Room for a run |
|---|---|---|
| East of the rail: a long band of grass at z -350..-315, x -145..+10, and a corridor at z -430..-415 south of a copse | L11-L12 (21-25 px), L13 (26), L15-L16 (29-36), L17-L18 (39-49), the L18-L19 glide | yes: an oval round the copse, ~400 m |
| Round the tarn (its kept-open clearing) and west of it | L17-L18 (29-42 px), L22-L24 (34-37) | yes, but the pond animals live there |

The east meadow wins: it is in view at seven chapter-3 parks, and it leaves the tarn to the pond's
animals. L14 does not see it, and chapter 4's parks (L19-L26) do not either. So in practice the
horses are a chapter-3 sight (the band's window runs to p 0.29, just past L21).

**The catch, seen in the game:** the "open meadow" is a glade among scattered trees. From the rail
(63-172 m up, looking across), the crowns in front hide much of the grass. The horses show in the gaps
(L16, L17, L18 best; at L15 one or two), not as a herd on open grass. The scouting counted the ground,
not the crowns between it and the eye.

### The model

`scripts/blender/odyssey/wild_horse.py` (headless Blender, rebuilt byte for byte) builds
`assets/chapter-03/horses/wild-horses.glb`. It holds two meshes on the deer's pipeline (a signed
distance field polygonised, decimated and mirrored):
- A stocky wild mare of the Przewalski / Konik type: 1.38 m at the withers, a big straight head, a
  short upright mane, a full tail. 2,396 triangles.
- A leggy foal: 1.04 m at the withers. 1,796 triangles.

Each has its own 29-bone skeleton (the deer's bones, plus a three-bone tail). The vertex colours are
masks (pale, points, black, sky seen), and the coat is a tint per horse: bay, dun or grey.

![The mare and foal at game size, three coats](images/odyssey-animals-2026-11-02/horses-model-game-size.png)

### Their life (`composition/odyssey-horse-band.js`)

- **Five adults and two foals.** The lead mare (dun, with a dun foal), a grey mare, a bay mare (with a
  bay foal), a dun mare and a bay stallion.
- **Two grazing places:** the west and the east end of the open band. Each horse has its own two spots
  in each. It grazes there like the deer: head down, slow steps along short curves, a look round, a
  walk to its other spot.
- **The foals** keep to spots at their mothers' sides. About every minute or two a foal trots out to
  its own open playground, sometimes bucks (both hinds kicked up and back), looks round and trots back.
- **The runs.** Twice in the 300 s loop the band runs.
  - At 118 s the heads come up, each horse turns toward the way out, and the band sets off in a loose
    file behind the lead mare. The foals run at their mothers' flanks. They go the long way round the
    copse: down the west side, along the south corridor, up the east side, to the east place
    (~400 m, 22-26 s).
  - At 262 s they canter straight back along the band to the west place (9-12 s).
  - The horses keep one west-to-east order in both places and set off in that order, so no one
    overtakes another.
- **Speed.** A run speeds up over 4.6 s and slows over 4.6 s. The gait follows the speed: walk, trot,
  canter, gallop. The top speed is a slow gallop, 7 m/s at life size (21 m/s drawn).
- **Gaits** (`ODYSSEY_HORSES.gaits`): a four-beat walk, a two-beat trot (diagonal pairs), a three-beat
  canter and a four-beat gallop, both leading with the left fore. Their footfall timings, stride rates
  and stance shares blend smoothly with the speed.
- **The feet.** A footstep planner like the deer's walks each horse through its loop once at load
  (60 steps a second). It lifts each hoof when its timing comes round and lands it where it should
  stand half a stance later. A planted hoof never moves. The plan also keeps the stride phase, which
  the pose reads.
- **The pose** is the deer's (two-segment legs, the body riding on its feet, three neck bones), plus
  the gaits' own motion:
  - the trot's bounce;
  - the canter's rocking and the neck's pump;
  - the body carried lower at speed, and the neck stretched;
  - the tail streaming in a run and swished at flies while grazing (a wave down its three bones);
  - a grazing foal splays its fores a little.

![Before (left, `?odysseyNoHorses=1`) and after (right), the clock pinned to a grazing moment: L15, L16, L17, L18 (crops of 1280x720, enlarged 3x)](images/odyssey-animals-2026-11-02/horses-before-after.jpg)

![The run at L17, 3.6 s apart: the band moving off, then a dun and a bay in full gallop through the gap (crops enlarged 1.5x)](images/odyssey-animals-2026-11-02/horses-gallop-l17.jpg)

### Light, shadow, no popping

- The deer's light (the world sun, the sky softened toward the warm air, the meadow's green from
  below, a little sky on the edges, the air), and a soft shadow on the slope under each horse.
- Drawn from p 0.08 (deep under the sea) to p 0.29. The test checks that the eye is under water at the
  start and that every horse, at every moment of the loop, is out of the frame round the end.
- The deer's lifecycle (`driveOdysseyHorses`): fetched and planned as chapter 2 begins, compiled while
  the board is idle, then drawn; a failure leaves the act as it was. Off: `?odysseyNoHorses=1`.

### Cost

- 3 draws: the mares (5 x 2,396), the foals (2 x 1,796) and the shadows. 15,572 triangles.
- One instanced attribute a draw (the coat is an index picked in the shader). WebGPU allows 8 vertex
  buffers a draw, and three colour attributes went over it on the first try.
- CPU: posing the band costs about 0.1 ms a frame. Planning the feet takes ~120 ms in all, one horse a
  task (12-28 ms each), so it never holds a frame. A 6.8 KB table goes to the GPU each frame.
- The bake-loader ratio test, the perf-budgets gate, the entry-hold and async-build budgets still pass.

### Tests (`tests/unit/odyssey-wild-horses.test.js`)

- **The models:** two meshes, 29 bones, within their triangle budgets.
- **The shaders:** all three build for WGSL and GLSL, in at most eight vertex buffers.
- **The clock:** every loop exactly 300 s (so the band's runs stay together), two runs minutes apart.
- **The gait maths:** a four-beat walk, diagonal pairs in the trot, rate and stance share moving
  smoothly with the speed.
- **The ground,** every horse at every moment of its loop, runs included:
  - dry grass under 0.36 slope;
  - clear of trunks and low crowns in both forest tiers, of the boulders, of the tarn
    (distance > 1.5) and of the rail's track (> 30 m);
  - hooves that bear weight planted (99 % within 0.08 of the drawn size), never dug in;
  - the horses apart, each foal within 40 m of its mother;
  - every horse, the foals too, reaching the band's speed.
- **The camera:** in the frame at L11, L15-L18 at the sizes above; never appearing or leaving in view.

### Left for later / owner decisions

- **The crowns hide the band** much of the time (see above). Options:
  - (a) thin the forest scatter over the meadow band (a clearing like the tarn's), so the grass is
    really open from the rail;
  - (b) move the band to the tarn's clearing, shared with the pond's animals (seen from L17-L18 and
    L22-L24);
  - (c) keep it as a glimpse through the trees.
- **Dust.** The runs have no dust trail yet (the brief's "a little dust"). It would be a small additive
  puff per hoof landing at gallop speed, fed from the plan's footfalls.
- **The mother and foal** graze on their own spots side by side, not tied to each other. A foal
  following its mother step by step would read better up close.
- The runs are scheduled in the loop (every ~2.5 minutes). They are not timed to the rail's
  arrivals.

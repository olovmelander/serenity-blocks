# Neon District — the people in the shops (2026-10-26)

The ask: "in neon district theme, is there any way we can make the people in the stores, gyms,
restaurants etc to feel more real. they are just flat now! we can use Blender mcp for design and
animation if needed and if that is a good idea", and then "I guess we want them stylized as
different cyberpunk characters."

Before this pass the people were signed-distance pictograms (`ndFigure`): a circle head, a
rounded-box body and straight capsule limbs, one dark fill with a rim. They stood on cards
parallel to the glass, and the game's camera sees every shop 45–85° off its window, so from the
street they were squeezed to a third of their width: a faint line.

![Before and after: a noodle bar, the gym, a mart and a bar, seen straight on](neon-district-captures/people-before-after.webp)

## What is there now

**A cast of twelve cyberpunk characters**, one per clip, recoloured per person:

| Clip | Character | Where |
|---|---|---|
| `walkA` | a fixer: long coat, collar up, an undercut, a lit visor, lit cuffs | crossing any room |
| `walkB` | a netrunner: hood up with a lit edge, a respirator, cargo trousers, lit soles | crossing any room |
| `idleA` | a punk: mohawk, bomber with a lit zip, a chrome right arm | standing in the arcade, looking round |
| `idleB` | a corp worker: sharp bob, a cyber eye, lit cuffs, on her phone | waiting in the laundromat and the office |
| `work` | a street cook: headband, a cyber eye, a chrome arm on the pan | behind the noodle counter, the bar, the office counter |
| `run` | a runner: lit stripes down the leggings, lit soles | on the gym's treadmills |
| `arcade` | a gamer in headphones, lit stripes down the back of the hoodie | at the cabinets |
| `lotus` | a shaven monk with glowing implants, breathing with the game's breath | Hale's calm room |
| `sitEat` | a courier on a stool, bomber with lit back stripes, eating | at the noodle counter |
| `lean` | a long coat at the bar, a glass now and then | at the bar |
| `lift` | a cyborg: chrome arm, cyber eye, dumbbell curls | by the gym's window |
| `browse` | a scavenger with a lit pack, reaching for a shelf, reading a label | at the mart's and the boutique's shelves |

![The cast as baked, lit in Blender for review](neon-district-captures/people-cast.webp)

Each person gets their own skin tone, hair (about a third dyed in the street's neon), clothes and
glow colour from their seed; staff wear their trade's colours (a cook's white, a bartender's black).

**Authored in Blender, procedurally** (`scripts/blender/neon_district_people.py`, package
`neon_people/`):

- `rig.py`: rest skeletons for two builds (a man of about 1.77 m, a woman of about 1.66 m),
  forward kinematics for the spine, head and limbs, and two-bone IK for planted feet and hands on
  a counter.
- `body.py`: the body as ellipsoids and round cones fixed to the bones (the Grainfields horse's
  distance-field kit), rebuilt from the posed skeleton for every frame, so joints stay whole.
  Garments are the body regions they cover, inflated and cut at hems and cuffs (a coat's skirt
  hangs from the hips and splits as the legs swing); hair styles, head gear (visor, respirator,
  hood, collar, headphones, implants), a chrome arm with glowing joint rings, a pack, glowing trims
  cut out of the garment's own surface (zips, back stripes, cuffs, leg stripes, soles), props (a
  phone, dumbbells, a stool).
- `clips.py`: the motion. The walk rolls each foot from heel strike to toe-off and back about the
  heel and the ball, plants it while it slides back at exactly the walking speed, and moves the
  pelvis (bob, sway, hip drop, twist) against counter-rotating shoulders and opposed arms. The run
  has a flight phase and a kicked-up heel. The loops (stirring a pot and tossing a pan, eating
  with chopsticks, sipping at the bar, curls, reaching for a shelf, a glance up from a phone,
  looking round a room, an arcade stick and buttons, breathing) are keyed with periodic splines,
  and hands that must reach the mouth aim at the posed head.
- `bake.py`: every frame meshed by surface nets (normals and class weights from the field,
  occlusion from the field), laid out as a grid of frames by views under an orthographic camera
  and rendered three times as data with Cycles: the view-space normal and occlusion, then the class
  weights. Packed into the sheets:
  - `people.webp` (2048 × 2048, cells 64 × 128 px = 1 × 2 m): normal x, y (6 bits), coverage,
    0.5 + 0.5 × occlusion (5 bits);
  - `people-masks.webp` (half size, two halves): skin, hair, top, 1 − 0.5 × bottom | chrome, glow.
  Alpha never drops below 0.5, so neither the WebP encoder nor a browser can drop the data of a
  transparent texel. Glow keeps its peak when halved, so a thin trim stays lit.

Views: front-facing clips from 0, 35 and 70° round the person, back-facing ones from 110, 145 and
180°, the walks from 20, 55, 90, 125 and 160° (mirrored for the other side). 496 cells; the walks
have 16 frames, the loops 8–16.

**In the shop shader** (`neon-district-people.js`, used by `shopInterior` in
`neon-district-shops.js`):

- A person stands on a card through their place in the room, square to the camera's line to
  them; the card hides what is behind it where the person is nearer than the room surface the ray
  hit, so the counter hides the legs of the staff behind it.
- The camera's bearing on the person (constant over the figure, so no seam) picks the view; the
  clock picks the frame (the distance walked for the walks, so the feet stay planted; the breath
  for the monk). The slow loops cross-fade between frames; walks and runs read the nearest frame.
- Light: the room's lamps from above, its back wall as a rim behind, the street's neon through
  the window in front, the room's occlusion; skin takes a warm wrap; chrome mirrors the room
  (lamps above, the shop's accent at the horizon, the street below); glow is light of its own and
  blooms. A soft shadow lies on the floor round the feet.
- Walkers cross the room and turn on the spot toward the street at each end, stepping as they
  turn; a loop is always a whole number of strides. Staff sidestep between two spots behind the
  counter.
- One `Loop` over the four slots (the counter is composited at the third) and one uniform array
  of table rows (roles, clips, palettes) keep the shop fragment at 97 KB of WGSL against 93 KB
  before (the first, unrolled version was 391 KB).
- The sheets are loaded only on the tiers that trace rooms (Medium and up); before they arrive
  the shops are simply empty.

## Verified

- Playground on WebGPU (RTX 5080 Laptop, Electron 38), every trade straight on and from a
  game-like 60°, with a new `shop=<trade>` inspection camera that follows a shop as the street
  scrolls; the game's own camera, before and after at the same moments. Consoles clean.
- `tests/unit/neon-district-shops-shaders.test.js`: the shop material built through the WGSL and
  GLSL node builders at High and Low (no throw or warning, no undeclared binding, no equal-edge
  smoothstep, budget), the people read once in a loop at High and absent at Low.
- `tests/unit/neon-district-people.test.js`: the shader's table agrees with the sheet (every role
  a real clip with matching views, back roles behind the counter, front roles in front, clip rows,
  palettes, cells inside the sheet, both images shipped).

![The game's camera: the same 24-hour shop before (a faint edge-on pictogram) and after](neon-district-captures/people-game.webp)

## Traps found

- **An atlas read with `.grad()` needs a filterable placeholder.** The swappable texture nodes
  started on a `DataTexture` (nearest filtering by default), which three treats as unfilterable:
  no sampler declared, yet the gradient read emits one, and WebGPU rejects the pipeline. And three
  merges bindings by texture object, so two nodes on one placeholder became one binding (the masks
  would have read the normal sheet). Each sheet now has its own linear placeholder; recorded in the
  TSL skill notes.
- **Four unrolled figures quadrupled the shader**, and every per-role or per-clip lookup written
  as a select chain multiplied it again: one loop and one table instead.
- **A hand aimed at the mouth from the rest pose** went over the head of a seated or leaning
  person: aim at the posed head.
- **The coat's skirt as thigh tubes** read as puffy bloomers; it is a flared panel hanging from
  the hips, with smaller leg panels so the leading knee still pushes it.

## Rebuilding

```
"C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe" --background --factory-startup ^
    --python scripts/blender/neon_district_people.py -- [--preview <dir>] [--only walkA,work]
```

About 12 minutes for the whole sheet; `--only` bakes a subset into a scratch folder without
touching the shipped files. It writes `public/textures/neon-district/people*.webp` and
`src/themes/neon-district/neon-district-people-atlas.js`.

## Not done

- No GPU timing (other sessions share both GPUs); by construction the people add, per pixel of a
  shop room, four texture reads and a short lighting term inside the figure's card only.
- The sheets add 3.4 MB to the theme's download (3.0 MB + 0.4 MB, lossless; the normals were
  quantised to 6 bits to get there from 4.2 MB), fetched only on the tiers that trace rooms.
- People do not enter or leave through the shop door, and they do not talk to each other.
- No phone or integrated-GPU capture of the final pass.

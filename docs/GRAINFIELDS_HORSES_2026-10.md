# Grainfields — the horses (2026-10-25)

The ask: "improve the look of the horses, how they move, walk, run, gallop, eat, and really improve
the animation on everything around the horses". Before this pass the band was a static, rigid-limbed
mesh slid across the field with a few hand-keyed bends. Now each horse is a skinned, procedurally
animated animal, and the field answers it.

## What is there now

**The horse** (`scripts/blender/grainfields/horse.py`, SDF meshing in `horse_sdf.py`): a Dosanko-like
pony rebuilt as signed-distance shapes, meshed by surface nets, decimated and mirrored in Blender
(8 982 triangles, 4 493 vertices, 179 KB GLB). A pony's head (flat forehead, heavy jowl, square soft
muzzle, cupped ears, lips), a mane and forelock laid on the skin in locks, a tail that falls in locks
clear of the buttocks. Thirty-eight bones (spine, three neck bones, head, jaw, ears, each leg to the
hoof, six down the tail), four smoothed skin weights a vertex, ray-traced occlusion, masks for the
hooves, dark skin, inner ears and the hair's freedom. Landmarks (muzzle, eyes, nostrils) ride in the
GLB's extras.

**The rig** (`grainfields-horse-rig.js`): poses the skeleton on the CPU and writes a uniform table
(a quaternion and a translation + scale per bone, two vec4 rows, fits WebGL2's 16 KB block for nine
horses); the vertex stage blends four bones. `shapeRig` gives the same skin other proportions: the
foals (`FOAL_SHAPE`) have nearly a grown horse's legs on a short slim body, a short neck, a big head
and ears, a short tail. The rig keeps where the skin rests (`rest`) apart from where its joints are
(`heads`); each bone's flesh is scaled with its length (`sizes`), so joints stay whole.

**The motion** (`grainfields-horse-motion.js`, gait tables in `grainfields-gait.js`):

- Walk, trot, canter and gallop by their real footfalls, on a continuous gait coordinate, so a
  horse breaks from one to the next over a stride. Froude-scaled for a pony's (and a foal's) legs;
  within a gait the stride rate quickens with speed as well as the stride lengthening (pace^0.7,
  0.8–1.3×), so a follower catching up never over-reaches.
- Each hoof stays where it strikes; the leg is solved to it (shoulder/elbow and stifle/hock as one
  flexion plus an aim), the fetlock sinks under the weight, the heel breaks over the toe as the leg
  leaves. In the air a leg travels from lift-off to its predicted touchdown, folding to the gait's
  own flexion. Standing, legs step one at a time when the body has moved or turned off them.
- The body rides its feet over the ground, pitches when it brakes, banks into turns, rounds its back
  at a canter and gallop. The neck is a boom with the face held at its own angle; head, neck, ears,
  jaw are critically damped springs. The tail is a spring chain swung by the body's acceleration.
- Grazing is reach → bite → tear (a tug) → chew, at the barley's ears or the verge's grass, the
  muzzle height solved by the neck's bend. Quiet business: creeping on while grazing, looking up,
  dozing on a cocked hind, swatting flies, shaking the head and neck (the mane thrown), stamping a
  fore, yawning. Foals nurse and frolic round their mothers (bucking as they set off); a lively
  horse bucks into a canter.

**The band** (`grainfields-herd-sim.js`): grazing grounds, walks, canters and gallops out of the
picture and back, wheels at a T-spin, runs at a chain. A grazing horse creeps along a slowly
wandering line. A nursing foal stands alongside its mother the other way round, beside her girth,
comes round her side (not through her) and reaches its head back under her belly to the udder; the
band gives it the udder's place and the neck turns and lowers onto it in closed loop (within a few
centimetres); she stands still for it and looks round at it now and then.

**Around the horses:**

- Dust from hoof strikes at a trot and faster, chaff thrown off the chest breasting the ears at a
  canter or gallop, awns scattered by a grazing tug (`grainfields-herd-dust.js`, a ring of
  closed-form records fed by the motion's own events).
- Shadows on the barley (`grainfields-herd-shadow.js`): the posed horses as capsules cast along the
  sun onto the plane of the ears, painted each frame into a 64 m window that follows the band.
- The barley answers (`grainfields-trample.js`): trampled stalks are damped springs that lean after
  a push a moment late and sway back past upright; grazing lips gather the ears toward the muzzle
  as it reaches, bites and tugs (`u.muzzles`, read only inside a bounding circle).
- Coats: five coats (bay, chestnut flaxen, dun with a dorsal stripe, dappled grey, black-bay),
  broad shade variation in the horse's own frame, wrapped Lambert, occlusion, hair rim light and
  flutter, eyes and nostrils from the rest position.

CPU cost: about 0.11 ms a frame for nine horses' motion on the dev laptop.

## Traps found on the way

- A leg's aim must be wrapped to (−π, π] or a swing spins the leg round.
- A neck solved as a chain was not monotonic (the head curled under); the boom neck with a held face
  angle is. The verge's grass needs the bend range up to 2.1 rad.
- Grazing's wander measured from the horse's own heading never settles: horses pirouetted at up to
  65°/s. Hold the line from where the creep began; a horse nudged off it re-aims rather than turning
  back round (a 400° pivot otherwise).
- Lowering a foal's neck to udder height stretches its reach to ~0.9 m; the foal has to stand
  beside the girth, not the flank, or its muzzle comes out through the mare.
- Clear per-business state (teat, creep line) when the band sets off; the graze loop no longer runs.
- A per-bone size changes both the joint offsets (scale the PARENT's length) and the flesh; anything
  that maps a skin point through a bone (`boneToWorld`, the shadow casters, the muzzle solver) must
  use the rest skin and the bone's size, not the joints.
- Tail welded to the buttocks tore under skinning: hang it clear, widen the dock blend, split seam
  chords at the mirror plane.
- Seeks replay the band at the live step (1/30 s), and the herd resets its dust random stream and
  grazing pulls, or a capture by time drifts.

## Verification

- Unit tests (411 in `tests/unit/grainfields-*`): planted hooves never slide or sink and clear the
  ground in the air at every gait; a gallop has a moment in the air; no joint jerks from a stand to a
  gallop; legs step round when turning; foals stand level, walk, trot and canter without slipping;
  shaped rigs keep the skin whole at every joint; a settled foal's muzzle stays within 12 cm of the
  udder while its mother stands; grazing turns are steps aside that end within a half-turn; the
  asset's weights, stretch and mirror bounds; seek determinism.
- Playground captures (`effect=grainfields`, `herdCam=i,d,az,h,fov`, `herdLook`, `herdShadow=0`,
  `?t=` seeks) of every gait, grazing, nursing from several angles, foals frolicking and galloping.
- The real game (Electron, Single Player on Grainfields, High): the band runs through the barley with
  its dust, no WebGPU or TSL errors in the console.

## Not done

- A foal cannot reach the verge's grass (its long legs, short neck); real foals splay their forelegs.
  The leg solver is planar, so a splay needs a roll at the shoulder and wider stance footholds.
- Swallows hunting over the grazing band, birds flushed by a gallop, breath at dawn.

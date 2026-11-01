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

## GPU timing (lead, 2026-11-01 evening)

Timed with the birds, deer and fish together on the RTX at full speed (2560x1440, High, two rounds,
main against this work at the same stations: p 0.095 and 0.11 the fish, 0.168, 0.194 and 0.22 the
deer, gulls and swallows, 0.31 the swallows and geese, 0.62 the summit kettle). GPU time per frame
was within 0.07 ms of main at every station (for example 2.10 ms both at L15, 1.18 against 1.11-1.18
ms at the kettle), so the new animals cost nothing measurable there.

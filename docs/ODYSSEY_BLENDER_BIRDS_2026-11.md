# Odyssey — Blender birds over the island (2026-11-01)

Asked for by Olov: Blender-made birds for the island's flocks (chapters 3-4). Before, the gulls,
swallows and geese were one flat paper shape of 9 triangles, stretched per kind. Far away they
read as specks, but the gulls and swallows come close to the orbs, and next to the Blender eagle
they looked like cut-outs. The kettle beside the summit (chapter 5) was the same paper shape in
flat slate grey, and it turned out to be the biggest of all on screen, so it got the same
treatment: griffon vultures.

![Before (left) and after (right), crops of the real game at 2560 x 1440: a gull close by, a gull
banking below the eye, swallows, the skein of geese on the wall, the skein far off against the
sky](images/odyssey-birds-2026-11-01/before-after.jpg)

## How big they are

Measured on the real camera at 2560 x 1440 (wingtip to wingtip):

| Bird | Biggest | Typical | Where |
|---|---|---|---|
| Gull | 54 px | 20-40 px | L11-L17 (biggest at L16, p 0.207) |
| Swallow | 36 px | 7-25 px | L16-L24 (biggest at L24, p 0.310) |
| Goose | 35 px | 9-21 px | L11-L27 (biggest at L27, p 0.394) |
| Summit kettle | 80 px | 20-50 px | L27-L34 (biggest near p 0.62) |

That size decides the detail: enough triangles for the outline (a real wing with a wrist, a
body with volume, the bill, the tail) and the colours you can still see at 30 px. More would not
show.

## The birds

`scripts/blender/odyssey/odyssey_birds.py` builds all four in headless Blender (about a second)
and writes `src/rendering/odyssey/composition/odyssey-bird-models.js`: plain arrays in
the code, no download, no loader. The same script run again writes the same file.

![The four birds from the Blender previews: from above gliding, the downstroke, the upstroke
from below, and from the front](images/odyssey-birds-2026-11-01/models.jpg)

- **Herring gull**: 296 triangles. White head, body and tail; pale grey back and wings with a
  white trailing edge; black wingtips with white spots; a white underwing; a yellow bill. Long,
  narrow wings.
- **Barn swallow**: 196 triangles. Blue-black back, rust-red forehead and throat, a dark band on
  the breast, pale belly; swept, pointed wings; a deeply forked tail with long streamers.
- **Greylag goose**: 326 triangles. A heavy grey-brown body with a barred back and flanks, a long
  neck, an orange bill, white under the tail; the pale grey forewing against dark flight feathers.
- **Griffon vulture** (the summit kettle): 328 triangles. Long, broad wings ending in six splayed
  primaries ("fingers"), a short square dark tail, a small pale head on a pale ruff; sandy brown
  body and coverts against blackish flight feathers.

Bodies, heads and bills are closed shapes. Wings and tails are single sheets, drawn from both
sides: each side has its own colours (the gull's white underwing, the swallow's buff, the goose's
grey).

## The wings move like wings

There is no skeleton. Each point of a wing knows how much the shoulder, the wrist and the wingtip
move it, and the game bends the wing at those two joints every frame. The shading turns with the
wing, so the light runs over it as it beats.

- **Gulls** glide most of the time with the wing bowed (arm up, hand down), and now and then beat
  a few slow strokes (2.6 a second).
- **Swallows** beat in fast bursts (6.5 a second) and glide between them with the hands swept back.
- **Geese** beat steadily and deeply (2.8 a second), each bird at its own pace.
- **Vultures** soar on held wings in a shallow V with the fingers curled up, and now and then give
  a slow beat or two (1.3 a second), as the old kettle did.

The outer wing always follows the inner a little later, as a real wing does. Where a joint bends,
the change is spread over a band that widens toward the back edge of the wing, so the skin bends
instead of tearing. A test checks every pose a bird flies: no edge stretches more than 1.13x, and
no part of a wing turns inside out.

## The light

The act's light, as on the eagle: the sun from behind the camera on the backs and the near wings,
the sky from above, the ground below bounced up under the wings (sea and sand under the gulls,
meadow under the swallows), a thin rim of sky on the edges, and the haze with distance as before.

A far bird needs to be darker than the sky behind it to be seen. The first try lit the geese's
pale bellies and underwings in full sun, and the far skein against the sky almost vanished (the
old dark cut-outs had read). So when a bird shrinks under about 14 px it slowly darkens toward its
outline (the geese most, the gulls least) and loses its rim. Close birds keep their full colours.
The far skein now reads as well as before.

## The summit kettle

![The summit kettle before (left) and after (right): far off against the sky (p 0.42), wheeling
under the cloud (p 0.55), and close by (p 0.60)](images/odyssey-birds-2026-11-01/summit-before-after.jpg)

The same thermal, lanes, bank, window and flag (`?odysseyNoBirds=1`); the same wingspan (11.4
units). The birds now take the act's light like the others: the sun on their sandy backs, dark
flight feathers, the fingers showing against the sky and the cloud. Far off they read better than
the old flat grey shapes did.

## What stayed the same

The flight paths, the windows, where the flocks fly, the bank into turns and the flag
`?odysseyNoFlights=1` are unchanged. The gulls and geese are drawn a little larger (wingspan 4.6
and 6.6 units, were 4.2 x 1.12 and 6.0) so the slimmer, real shapes cover about the same pixels.

## Smoothness

Still no hitch: all three flocks are built when the board is made and compiled with it. They are
three draws (one per flock), but all share one material, so there is one shader and one pipeline.
Checked in the game: the pipeline count stays the same as each flock appears (gulls at p 0.14,
geese at 0.155, swallows at 0.21).

- Draws: 3 (was 1), one pipeline (as before). The summit kettle: 1 draw, 1 pipeline (as before).
- Triangles: 12 gulls x 296 + 12 swallows x 196 + 9 geese x 326 = 8,838 (was 297); the kettle 12 x
  328 = 3,936 (was 108). Each flock is only drawn while its window is open.
- Code: the models add about 30 KB to the bundle.

## Tests

- `tests/unit/odyssey-blender-birds.test.js` (new): the models' sizes and triangle budgets, shapes
  facing outward and wings facing up, the joint weights, the colours each bird is known by, every
  pose without tearing or turning inside out, the outer wing lagging, each kind's rhythm, the
  shared material and vertex-buffer limit, the vultures' soaring, and both materials (the
  flights' and the kettle's) built for WebGPU and for the WebGL2 fallback without warnings.
- `src/rendering/odyssey/composition/odyssey-summit-birds.test.js`: unchanged, passes.
- `tests/unit/odyssey-act2-life.test.js` and `odyssey-act2-fade-out-of-view.test.js`: unchanged
  checks, updated for the three draws.

## Not done

- No legs (tucked in flight), no calls.

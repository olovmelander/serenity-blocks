# Synthwave Sunset — asset attribution

Every file in this folder is a project-owned original, authored procedurally in
Blender 5.2.2 LTS for this repository: the gull on 2026-10-26 by `scripts/blender/synthwave_gull.py`,
the people on 2026-11-17 by `scripts/blender/synthwave_strollers.py`.
It contains no third-party geometry, texture, scan, photograph or generative-model output,
and the generator fetches nothing from the network. Licence: the same as the project
(proprietary, all rights reserved).

`asset-manifest.json` (each script writes its own entry and keeps the others) records each
file's size and SHA-256, the rig the theme folds the gull's wings with, and the people's
skeleton; `tests/unit/synthwave-sunset-gull-asset.test.js` and
`tests/unit/synthwave-sunset-strollers.test.js` check the files against it.

| File | What it is |
| --- | --- |
| `gull.glb` | A herring gull at real size (1.40 m span): a white body with a round head, a heavy yellow bill with its red spot, a short square tail, long narrow wings bent at the wrist, pale grey above with black tips and a white mirror, white below. About 1,650 triangles, no textures, no skeleton. |
| `strollers.glb` | The people on the pier: eight stylised figures on three builds (a woman, a man, a child), each its own outfit — a sundress and a wide sun hat, a blouse and a midi skirt with a bun, slacks and a ponytail, shorts and a cap, chinos, a light jacket and a boater, a boy, a girl in a dress with pigtails. 1,400–2,100 triangles each, no textures, no faces. |

## How it is made

- **Shape.** Lofted rings in the bird's own frame (x to its left, y up, z forward): the body
  and head as one spindle, the bill as its own taper, the tail as a thin square fan, each wing
  as cambered airfoil sections along twenty stations, dense at the shoulder and the wrist.
- **Vertex colour.** Scene-linear plumage in RGB; alpha marks thin feather (1) against body (0),
  which the theme lets the sun shine through.
- **`_wing`.** Per vertex, how much the shoulder, the wrist and the wingtip move it (0..1, eased
  across a band either side of each joint). The theme's vertex stage folds the wings about the
  two hinges whose pivots the manifest records, into the glide or the wingbeat built from the
  manifest's poses.
- **Run it.**
  `blender --background --factory-startup --python scripts/blender/synthwave_gull.py -- --out src/themes/synthwave-sunset/assets/gull.glb [--preview <dir>]`
  rewrites the model and the manifest (the same script writes the same file); `--preview`
  renders every pose from six views, lit and as game-sized silhouettes.

### The people (`strollers.glb`)

- **Shape.** Lofted rings in each person's frame (x to their left, y up, z forward; soles on
  y = 0): one torso from the crotch to the neck, limbs tapered from the shoulder and the hip,
  an egg of a head with a jaw, shoes, flat hands; hair, skirts and hats as shells over them.
  Each outfit's hems are cut into the rings, so a sleeve or a hem ends on a clean edge.
- **`_bones`.** Per vertex, two of the thirteen bones (the hips, the chest, the head, a thigh,
  shin and foot a leg, an upper arm and forearm an arm) and the second one's weight, eased
  across a band at each joint; a skirt follows the thighs toward its hem.
- **`_paint`.** Per vertex, what it is (skin, hair, top, bottom, shoes, hat, hat band: the theme
  dresses each person in colours of their own) and how much of the sky it sees (ray casts
  against the figure itself: inside the arms, under a brim).
- **Extras.** Each figure carries its build's rest joints (`joints`), its height and foot
  length; the theme poses the skeleton about them.
- **Run it.**
  `blender --background --factory-startup --python scripts/blender/synthwave_strollers.py -- --out src/themes/synthwave-sunset/assets/strollers.glb [--preview <dir>]`
  rewrites the model and its manifest entry (the same script writes the same file); `--preview`
  renders the cast from four sides in a studio light and as silhouettes at game size.

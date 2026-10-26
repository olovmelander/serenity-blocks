# Synthwave Sunset — asset attribution

Every file in this folder is a project-owned original, authored procedurally in
Blender 5.2.2 LTS on 2026-10-26 for this repository by `scripts/blender/synthwave_gull.py`.
It contains no third-party geometry, texture, scan, photograph or generative-model output,
and the generator fetches nothing from the network. Licence: the same as the project
(proprietary, all rights reserved).

`asset-manifest.json` (written by the same script) records the file's size and SHA-256 and
the rig the theme folds the wings with; `tests/unit/synthwave-sunset-gull-asset.test.js`
checks the file against it.

| File | What it is |
| --- | --- |
| `gull.glb` | A herring gull at real size (1.40 m span): a white body with a round head, a heavy yellow bill with its red spot, a short square tail, long narrow wings bent at the wrist, pale grey above with black tips and a white mirror, white below. About 1,650 triangles, no textures, no skeleton. |

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

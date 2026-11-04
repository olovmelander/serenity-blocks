# Chapter 2 (Deep Ocean) — sea-creature GLB assets

Project-owned original assets. License: proprietary-original. No third-party attribution required.

| file | role | made by |
| --- | --- | --- |
| `humpback-swim.glb` | the humpback mother and calf of the whale pass (`composition/odyssey-whale-pass.js`) | `scripts/blender/odyssey/odyssey_whales.py` |

## humpback-swim.glb (2026-11-03)

Built, rigged and animated in headless Blender from numbers. Nothing is downloaded or scanned:

    blender -b --factory-startup --python scripts/blender/odyssey/odyssey_whales.py -- \
        [--out <glb>] [--review <dir>] [--blend <review .blend>]

- The body is a signed distance field of smooth masses and fins (the generic SDF library in
  `scripts/blender/ocean_creatures/sdf.py`), meshed by Blender's bundled openvdb and decimated
  mirror-symmetric to 6,000 triangles. Normals come from the field.
- A 13-bone rig and one keyed action, "Swim": one stroke of 4 s at 24 fps, cyclic.
- COLOR_0 carries the white of the fins (r), the belly's (g) and the ambient occlusion (b).
- The script writes the same file every run.

It replaced `whale-glide.glb`, a photo-to-3D (TRELLIS) mesh with a 9-bone auto-rig whose swim
nodded the head and left the flukes still.

## Removed

- `manta-glide.glb` (removed 2026-11-03, owner's call): the diorama's hero manta, a photo-to-3D
  (TRELLIS) mesh whose wings curled down with two lumps hanging below. The diorama's billboard
  manta trio carries the mantas on the recovery path.

> ⚠️ Odyssey GLB assets are **not** auto-tracked — `git add` the `.glb` explicitly or it vanishes
> on clean checkouts / CI.

# Odyssey chapter 4 asset attribution: the massif's ibex

## Alpine ibex (`alpine-ibex.glb`)

Generated, not captured: `scripts/blender/odyssey/alpine_ibex.py` builds it in headless Blender (a signed
distance field of ellipsoids, round cones and tubes, polygonised and decimated to about 2,200 triangles,
skinned to the red deer's own 27-bone skeleton through `_bones`/`_weights` attributes, its coat painted
into the vertex colours, every horn vertex marked with its horn's root in `_horn`). The meshing reuses
the Grainfields horse's helpers (`scripts/blender/grainfields/horse_sdf.py`) and the deer builder
(`scripts/blender/odyssey/red_deer.py`). No photograph, scan or third-party model is involved, so there
is nothing to attribute.

Rebuild (byte-identical output):

    blender -b --factory-startup --python scripts/blender/odyssey/alpine_ibex.py -- \
        --out src/rendering/odyssey/assets/chapter-04/ibex/alpine-ibex.glb [--preview <dir>]

Odyssey poses it with the deer's herd code (`src/rendering/odyssey/composition/odyssey-deer-herd.js`,
the group in `odyssey-ibex-herd.js`) and draws the group in one instanced draw (`odyssey-ibex.js`): a
buck, two nannies and a kid on the shelf above the rock band at the massif's foot.

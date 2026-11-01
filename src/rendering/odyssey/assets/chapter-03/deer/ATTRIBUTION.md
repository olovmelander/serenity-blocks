# Odyssey chapter 3 asset attribution: the glade's deer

## Red deer hind (`red-deer.glb`)

Generated, not captured: `scripts/blender/odyssey/red_deer.py` builds it in headless Blender (a signed
distance field of ellipsoids and round cones, polygonised and decimated to about 1,800 triangles,
skinned to its own 25-bone skeleton through `_bones`/`_weights` attributes, its coat painted into the
vertex colours). The meshing reuses the Grainfields horse's helpers
(`scripts/blender/grainfields/horse_sdf.py`). No photograph, scan or third-party model is involved,
so there is nothing to attribute.

Rebuild (byte-identical output):

    blender -b --factory-startup --python scripts/blender/odyssey/red_deer.py -- \
        --out src/rendering/odyssey/assets/chapter-03/deer/red-deer.glb [--preview <dir>]

Odyssey poses it in code (`src/rendering/odyssey/composition/odyssey-deer-herd.js`) and draws the
herd in one instanced draw (`odyssey-deer.js`): hinds, a yearling and a calf grazing the glade above
the chapter-3 shore.

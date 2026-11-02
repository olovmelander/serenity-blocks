# Odyssey chapter 3 asset attribution: the meadows' wild horses

## Wild horse mare and foal (`wild-horses.glb`)

Generated, not captured: `scripts/blender/odyssey/wild_horse.py` builds it in headless Blender (a signed
distance field of ellipsoids and round cones, polygonised and decimated to about 2,400 triangles for the
mare and 1,800 for the foal, each skinned to its own 29-bone skeleton through `_bones`/`_weights`
attributes, the coat's masks painted into the vertex colours). The proportions follow the Grainfields
horse (`scripts/blender/grainfields/horse.py`) and the meshing reuses its helpers
(`scripts/blender/grainfields/horse_sdf.py`). No photograph, scan or third-party model is involved, so
there is nothing to attribute.

Rebuild (byte-identical output):

    blender -b --factory-startup --python scripts/blender/odyssey/wild_horse.py -- \
        --out src/rendering/odyssey/assets/chapter-03/horses/wild-horses.glb [--preview <dir>]

The file holds two meshes, `horse` and `foal`; the scene's extras carry both skeletons (`skeletons`),
their measures (`records`) and landmarks. The game tints the masks by coat (bay, dun, grey).

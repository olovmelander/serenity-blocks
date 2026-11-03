# Odyssey chapter 3 asset attribution: the pond birds

## Mute swan (`swan.glb`) and grey heron (`heron.glb`)

Generated, not captured: `scripts/blender/odyssey/pond_birds.py` builds both in headless Blender, the
red deer's way (`red_deer.py`, after the Grainfields horse): a signed distance field of ellipsoids,
round cones and tubes in smooth unions, polygonised with surface nets, decimated, mirrored, skinned
through `_BONES`/`_WEIGHTS` attributes and painted into the vertex colours. No photograph, scan or
third-party model is involved, so there is nothing to attribute.

Rebuild:

    blender -b --factory-startup --python scripts/blender/odyssey/pond_birds.py -- \
        --out-dir src/rendering/odyssey/assets/chapter-03/pond [--preview <dir>]

Odyssey poses them in code at the chapter-3 tarn (docs/ODYSSEY_GROUND_ANIMALS_2026-11.md, "Life at
the pond").

> ⚠️ Odyssey GLB assets are **not** auto-tracked — `git add` the `.glb` explicitly.

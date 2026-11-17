# Waves Asset Attribution

## The sea life (`sea-life.glb`)

Six animals in one file: a bottlenose dolphin (also drawn small as a calf), a spinner dolphin, a
humpback, an oceanic manta, a green turtle and a shearwater. They are generated,
not captured: `scripts/blender/waves_sea_life_assets.py` draws each one in headless Blender from
numbers (`scripts/blender/waves_sea_life/cast.py`: a body as a chain of ellipsoids along a
profile, fins as planforms given an airfoil's thickness, eyes, mouth lines; the humpback, the
manta and the turtle are the Ocean theme's own designs, `scripts/blender/ocean_creatures/cast.py`),
meshes the signed distance field with Blender's bundled openvdb, decimates it, and writes for
every vertex what it is (along the body, which part, how far out along its fin, where that fin
turns from, ambient occlusion and two pattern masks) for the theme's shaders, which swim and
paint them (`src/themes/waves/waves-fauna.js`). There is no skin, no texture and no animation
clip in the file. No photograph, scan or third-party model is involved, so there is nothing to
attribute. Regenerate (about a minute and a half) with

    blender --background --factory-startup --python scripts/blender/waves_sea_life_assets.py -- \
        [--out src/themes/waves/assets/sea-life.glb] [--only bottlenose,spinner] [--review <dir>]

_Built with Blender 5.2 on 2026-11-17 (the flying fish of the 2026-11-16 pack was taken out; the
manta and the turtle, seen closest, were given more triangles). It replaced a dolphin grown in
code at run time (a lofted body and five flat fins)._

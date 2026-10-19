# Ocean Asset Attribution

## The large animals (`creatures.glb`)

Nine animals in one file: a humpback (also drawn small as her calf), a blue whale, a bottlenose
dolphin, a whale shark, a scalloped hammerhead, an oceanic manta, a spotted eagle ray, a green
turtle (also a hawksbill, by colour) and an ocean sunfish. They are generated, not captured:
`scripts/blender/ocean_creatures_assets.py` draws each one in headless Blender from numbers
(`scripts/blender/ocean_creatures/cast.py`: a body as a chain of ellipsoids along a profile, fins
as planforms given an airfoil's thickness, eyes, mouth lines), meshes the signed distance field
with Blender's bundled openvdb, decimates it, and writes for every vertex what it is (along the
body, which part, how far out along its fin, where that fin turns from, ambient occlusion and a
few pattern masks) for the theme's shaders, which swim and paint them
(`src/themes/ocean/ocean-giants.js`). There is no skin, no texture and no animation clip in the
file. No photograph, scan or third-party model is involved, so there is nothing to attribute.
Regenerate (about 6 to 20 minutes on a busy machine) with

    blender --background --factory-startup --python scripts/blender/ocean_creatures_assets.py -- \
        [--out src/themes/ocean/assets/creatures.glb] [--review <dir>]

_It replaced (2026-10-19) three animals grown in code at run time (a humpback, a manta and a
green turtle as lofted rings and flat fin sheets)._

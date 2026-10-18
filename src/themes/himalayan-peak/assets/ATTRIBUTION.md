# Himalayan Peak Asset Attribution

## Golden eagle (`eagle.glb`) — the bird

The soaring adult golden eagle is generated, not captured: `scripts/blender/himalayan_eagle.py`
builds it in headless Blender from the theme's own measurements (a lofted body and hooked bill,
cambered wings with an S-curved trailing edge, seven fingered primaries, a twelve-feather tail),
paints its plumage into vertex colours (alpha marks thin feather for the light that shines
through it), skins it to 26 axis-aligned bones and writes a 2,300-triangle GLB with no animation:
`himalayan-peak-eagle-flight.js` poses every joint in code. No photograph, scan or third-party
model is involved, so there is nothing to attribute. Regenerate with

    blender --background --factory-startup --python scripts/blender/himalayan_eagle.py -- \
        --out src/themes/himalayan-peak/assets/eagle.glb [--preview <dir>]

_It replaced (2026-10-18) a TRELLIS.2 reconstruction of a photographed eagle: a 30k-triangle
mesh in the photo's wings-raised pose with one looping flap clip. Before that the scene flew a
code-built eagle and a recoloured three.js "Stork"._

## The amphitheatre (`massif.png`, `massif-manifest.json`)

The mountains are generated, not surveyed: `scripts/himalayan-peak/bake-massif.mjs` evaluates
the theme's own plan of ridges (`himalayan-peak-massif.js`), runs droplet erosion over it,
measures how much sky each point sees and writes the result as a 1024 × 1024 PNG (red × 256 +
green = height over a 4,400 m range, blue = sky visibility). No elevation data, photograph or
third-party model is involved, so there is nothing to attribute. Regenerate with

    node scripts/himalayan-peak/bake-massif.mjs

which rewrites both files; `tests/unit/himalayan-peak-field.test.js` pins the manifest's hash to
the image.

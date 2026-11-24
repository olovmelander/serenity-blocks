# Odyssey forest asset attribution

Both pictures are generated, not captured. No photograph, scan, third-party model or texture is involved,
so there is nothing to attribute. They hold data, never colour: the game paints every tree its own colours.

## The leaves (`leaves.png`, 1024 x 1152 RGBA)

`scripts/blender/odyssey/forest/sprays.py` models every spray leaf by leaf (an oak's lobes, a maple's
fingers, a birch's rhombs, five-petalled blossom, spruce boughs, pine brushes, a willow's whips);
`bake.py` photographs each straight on with Cycles, 128 px a tile (61 tiles, three of bark, and the floor's
seven: fern and bracken fronds, moss). R coverage,
G and B the surface's facing, A the light it keeps, in bands: wood, leaf, white flower.

## The far trees (`far.png`, 2560 x 1600 RGBA)

Each of the 40 specimens that stand far away, grown by `trees.py` with its real leaves and photographed
from 8 sides at 2 heights, 80 px a tile, in the same channels.

Rebuild (headless; `leaves` takes about two minutes on an RTX, `far` about six; the pictures are
renders, so they come back the same to the eye, not byte for byte):

    blender -b --factory-startup -P scripts/blender/odyssey/odyssey_forest.py -- leaves far models

The shaders that read them: `src/rendering/odyssey/world/odyssey-forest-material.js`.

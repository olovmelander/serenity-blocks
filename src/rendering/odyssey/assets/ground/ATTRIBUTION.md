# Odyssey ground asset attribution: the meadow and the forest's floor

## The meadow (`meadow.png`)

Generated, not captured: `scripts/blender/odyssey/odyssey_meadow.py` models a 16 m square of turf in
headless Blender (Poisson-spaced tussocks of curved, tapering blades, seed stalks, and clumps of
buttercup, ox-eye daisy, red clover and harebell on stalks), repeats everything near an edge one tile
over so it tiles, and photographs it from straight above with Cycles: once lit by an even white sky
(the turf's value), once with each flower emitting its own key colour (where each flower shows). The
two renders are packed into one 256 x 256 RGB PNG of data, not colour: R the turf's value, G flower
coverage, B which flower. No photograph, scan or third-party texture is involved, so there is nothing
to attribute.

Rebuild (the same scene and the same renders from the same seed):

    blender -b --factory-startup --python scripts/blender/odyssey/odyssey_meadow.py -- \
        --out src/rendering/odyssey/assets/ground/meadow.png

The ground shader reads it as `MEADOW` in `src/rendering/odyssey/world/odyssey-world-renderer.js`:
the turf over the painted grass, the flowers in drifts, the wind's bands through it.

## The forest's floor (`floor.png`)

Generated the same way: `scripts/blender/odyssey/odyssey_floor.py` models a 16 m square of a wood's floor (46,000
fallen leaves in drifts, sticks, moss cushions, seedlings) and photographs it from straight above. One 512 x 512
RGB PNG of data: R the litter's light, G moss and seedlings, B leaves newly fallen. No photograph, scan or
third-party texture is involved, so there is nothing to attribute.

    blender -b --factory-startup --python scripts/blender/odyssey/odyssey_floor.py -- \
        --out src/rendering/odyssey/assets/ground/floor.png

The ground shader reads it as `FLOOR` in `src/rendering/odyssey/world/odyssey-world-renderer.js`.

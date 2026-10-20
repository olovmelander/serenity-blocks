# Odyssey chapter 4 asset attribution

## Golden eagle (`eagle.glb`)

A byte-for-byte copy of the Himalayan Peak theme's eagle (`src/themes/himalayan-peak/assets/eagle.glb`),
copied rather than imported because Odyssey may not import theme modules. It is generated, not
captured: `scripts/blender/himalayan_eagle.py` builds it in headless Blender (a 2,300-triangle,
26-bone skinned soaring adult with its plumage in vertex colours) and no photograph, scan or
third-party model is involved, so there is nothing to attribute. Regenerate the theme's copy with
the script (see `src/themes/himalayan-peak/assets/ATTRIBUTION.md`) and copy it here.

Odyssey poses it in code (`src/rendering/odyssey/composition/odyssey-eagle-flight.js`): it
thermals off the hero massif's south flank over chapters 4-5.

# Chapter 2 (deep ocean) — the visitors

`ocean-visitors.glb` holds the **manta** and the **whale shark** of the Ocean theme's creature pack
(`src/themes/ocean/assets/creatures.glb`), copied byte for byte (only those two nodes, their meshes
and the ranges they read) by `scripts/odyssey-extract-ocean-visitors.mjs`. The pack is generated,
not captured: `scripts/blender/ocean_creatures_assets.py` draws each animal in headless Blender from
numbers and meshes the signed distance field with Blender's bundled openvdb (see the Ocean theme's
`assets/ATTRIBUTION.md`). No photograph, scan or third-party model is involved, so there is nothing
to attribute.

Re-copy after the pack is re-baked:

    node scripts/odyssey-extract-ocean-visitors.mjs [--kinds=manta,whaleShark]

> ⚠️ Odyssey GLB assets are **not** auto-tracked — `git add` the `.glb` explicitly.

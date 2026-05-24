# Showcase Reef Canyon GLBs

Drop Blender-authored stylized AAA reef wall, shelf, arch, and distant stack
anchors here. Files are discovered by `ocean-reef-assets.js` and loaded by
`OceanAtmosphereSystem`.

## Export Contract

- Format: glTF Binary `.glb`
- Origin: seabed anchor for predictable canyon placement
- Axes: Y up, meters
- Transforms: apply all transforms before export
- Naming: `reef-wall-left-01.glb`, `reef-shelf-right-01.glb`, etc.
- Materials: 1-3 simple PBR materials; baked/painted colors are preferred
- Budget: 4k-12k triangles and under 1 MB per GLB

The runtime keeps procedural reef silhouettes active behind these anchors, so
this folder can be empty during development without breaking the ocean theme.

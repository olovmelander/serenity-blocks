# Hero Kelp GLBs

Drop stylized AAA kelp grove anchors here. Files are discovered at build time by
`ocean-kelp-assets.js` and loaded by `OceanAtmosphereSystem`. Project-authored
GLBs and vetted Poly Pizza CC0/CC-BY GLBs are allowed.

## Export Contract

- Format: glTF Binary `.glb`
- Origin: seabed anchor at the base of the grove
- Axes: Y up, meters
- Transforms: apply all transforms before export
- Naming: `kelp-grove-01.glb`, `kelp-grove-02.glb`, etc.
- Materials: simple PBR/vertex color materials; runtime replaces them with the
  underwater sway material
- Licenses: MIT project-local, CC0, or CC-BY with attribution in
  `../ATTRIBUTION.md`
- Budget: 1k-4k triangles and under 600 KB per GLB

Runtime code injects normalized mesh-local height attributes and applies shader
sway, so authored kelp silhouettes remain animated in the current.

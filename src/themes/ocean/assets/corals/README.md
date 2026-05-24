# Hero Coral GLBs

Drop stylized AAA coral colonies here. Files are discovered at build time by
`ocean-coral-assets.js` and loaded by `OceanAtmosphereSystem`. Project-authored
GLBs and vetted Poly Pizza CC0/CC-BY GLBs are allowed.

## Export Contract

- Format: glTF Binary `.glb`
- Origin: seabed anchor at the base of the colony
- Axes: Y up, meters
- Transforms: apply all transforms before export
- Naming: `coral-branch-01.glb`, `coral-fan-01.glb`, etc.
- Materials: 1-2 PBR materials per asset, texture maps allowed
- Licenses: MIT project-local, CC0, or CC-BY with attribution in
  `../ATTRIBUTION.md`
- Budget: 3k-8k triangles and under 1 MB per GLB

The runtime keeps procedural hero coral placeholders visible until matching GLBs
load, so this folder can be empty during development.

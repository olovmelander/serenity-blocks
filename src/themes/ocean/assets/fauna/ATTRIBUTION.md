# Ocean Fauna Asset Attribution

## Rare Shark

`rare-shark-v2.glb` and `rare-shark.glb` are project-authored Blender MCP exports generated from `tools/assetgen/generate_ocean_fauna_premium.py`.

Sketchfab import was attempted for the planned CC-BY great-white source asset, but the active Blender MCP connection reported Sketchfab integration disabled because no API key was configured. No external CC-BY shark mesh is redistributed in these committed GLB files.

Selected CC-BY source candidates for a future replacement pass:

- Great White Shark by Sealife Fan 3: https://sketchfab.com/3d-models/great-white-shark-bf81b64f0121443da38112f706b7356f
- Shark by jwg15f: https://sketchfab.com/3d-models/shark-3794246d9021403aa7cc9377466cc526

## Self-Generated TripoSR Assets

`reef-seahorse-triposr.glb` — Seahorse reef-dweller, generated from `artifacts/triposr/seahorse-source.png` using the TripoSR image-to-3D pipeline (`scripts/triposr-gen.sh`, mc-resolution 96, chunk-size 4096). Vertex-color output, no texture baking. License: MIT-project-local.

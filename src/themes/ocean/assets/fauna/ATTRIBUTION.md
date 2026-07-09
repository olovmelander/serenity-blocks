# Ocean Fauna Asset Attribution

## Rare Shark

`rare-shark-v2.glb` and `rare-shark.glb` are project-authored Blender MCP exports generated from `tools/assetgen/generate_ocean_fauna_premium.py`.

Sketchfab import was attempted for the planned CC-BY great-white source asset, but the active Blender MCP connection reported Sketchfab integration disabled because no API key was configured. No external CC-BY shark mesh is redistributed in these committed GLB files.

Selected CC-BY source candidates for a future replacement pass:

- Great White Shark by Sealife Fan 3: https://sketchfab.com/3d-models/great-white-shark-bf81b64f0121443da38112f706b7356f
- Shark by jwg15f: https://sketchfab.com/3d-models/shark-3794246d9021403aa7cc9377466cc526

## Self-Generated TRELLIS.2 Assets

- `rare-mantaray-self.glb` — Manta ray, generated from `artifacts/manta-whale/manta-source.png` using the TRELLIS.2-4B pipeline via ComfyUI. Auto-rigged in Blender with centerline spine, cephalic stubs, and a 3-bone pectoral fin chain per wing, with a custom distance-based skinning weight assignment and a 48-frame traveling-wave wingbeat undulation animation. License: MIT-project-local.
- `rare-whale-self.glb` — Blue/humpback whale, generated from `artifacts/manta-whale/whale-source.png` using the TRELLIS.2-4B pipeline via ComfyUI. Auto-rigged in Blender with a 5-bone spine chain and 2-bone pectoral fin chains, with custom distance-based skinning weights and a 60-frame vertical tail fluke undulation animation. License: MIT-project-local.

## Self-Generated TripoSR Assets

`reef-seahorse-triposr.glb` — Seahorse reef-dweller, generated from `artifacts/triposr/seahorse-source.png` using the TripoSR image-to-3D pipeline (`scripts/triposr-gen.sh`, mc-resolution 96, chunk-size 4096). Vertex-color output, no texture baking. License: MIT-project-local.

## UniRig Auto-Rigged Assets

`reef-seahorse-triposr-rigged.glb` — Same mesh as `reef-seahorse-triposr.glb`, auto-rigged with [UniRig](https://github.com/VAST-AI-Research/UniRig) (SIGGRAPH 2025) via `scripts/unirig-gen.sh`. The skeleton and skinning weights are predicted; no animation clips are embedded. Spine/tail bones are driven procedurally at runtime by `OceanReefDwellerSystem.updateSeahorses()` (phase-offset sin waves down the chain). Inspect the bone hierarchy with `python artifacts/triposr/inspect_rig.py <file.glb>`. License: MIT-project-local (derived from a self-generated mesh).

## Self-Generated TripoSR Coral Library

The following GLBs in `src/themes/ocean/assets/corals/triposr/` were generated from Nano Banana 2–rendered painterly reference images (1024×1024, plain grey background, painterly Studio Ghibli / Abzu style). Source images live in `artifacts/triposr/coral-*-source.png`. Generated via `scripts/triposr-gen.sh` with `mc-resolution 128 chunk-size 4096 foreground-ratio 0.85` (sea-fan used `mc-resolution 192 foreground-ratio 0.9` for its fine branching detail). Vertex-color output, no baked textures. Registered in `src/themes/ocean/ocean-coral-assets.js` (hero coral manifest) and placed by `OceanAtmosphereSystem.upgradeHeroCoralsFromGLB()`. The existing TSL `createHeroCoralNodeMaterial` provides procedural breathing, FBm pattern, painterly rim, and tip-glow. License: MIT-project-local.

- `coral-brain-triposr-01.glb` — brain coral, teal/jade with cream maze ridges. Source: `artifacts/triposr/coral-brain-source.png`.
- `coral-staghorn-triposr-01.glb` — staghorn coral, cream/pink branching antlers. Source: `artifacts/triposr/coral-staghorn-source.png`.
- `coral-sea-fan-triposr-01.glb` — magenta/violet sea fan. Source: `artifacts/triposr/coral-sea-fan-source.png`. Also rigged: `coral-sea-fan-triposr-01-rigged.glb` (6-bone chain via UniRig; not registered in manifest, see below).
- `coral-anemone-triposr-01.glb` — orange anemone with turquoise tentacle tips. Source: `artifacts/triposr/coral-anemone-source.png`. Also rigged: `coral-anemone-triposr-01-rigged.glb` (34-bone branching skeleton via UniRig; not registered in manifest, see below).
- `coral-tube-sponge-triposr-01.glb` — indigo/cobalt tube sponge cluster. Source: `artifacts/triposr/coral-tube-sponge-source.png`.
- `coral-mushroom-triposr-01.glb` — sunset orange/pink disk (mushroom) coral. Source: `artifacts/triposr/coral-mushroom-source.png`.

**Rigged variants are present on disk but unregistered.** `coral-sea-fan-triposr-01-rigged.glb` and `coral-anemone-triposr-01-rigged.glb` are kept alongside the unrigged GLBs as future-work assets. Enabling bone-driven sway requires bypassing `mergeMeshesByMaterial` in `OceanAtmosphereSystem.prepareHeroCoralAsset` for SkinnedMesh children and adding an animator loop (the seahorse pattern in `OceanReefDwellerSystem.updateSeahorses` is a starting point — the sea-fan can reuse `findLongestBoneChain` directly; the anemone needs a multi-chain walker for its 7 tentacle subtrees).

# Winter theme — 3D asset attribution

## arctic-fox.glb — project original (no third-party attribution required)

A white arctic fox that trots across the winter snow/ice. Produced with the
project-owned local asset pipeline (`C:\AI\TRELLIS2-ComfyUI`):

1. **Concept**: a stylized low-poly arctic-fox reference image (`arctic_fox.png`).
2. **Image → 3D**: TRELLIS.2-4B (GGUF Q8_0, `1024_cascade` pipeline) reconstructs a
   vertex-coloured mesh from the photo — `generate_arctic_fox.py`.
3. **Rig + animate**: headless Blender (`blender_rig_arctic_fox.py`) — decimate to
   ~50k tris, smooth-shade, clean the coat to white while keeping the photo's dark
   eyes/nose, build an 18-bone quadruped skeleton (spine/neck/head + 3-bone tail +
   4 legs), inverse-square distance skin weights, and a baked looping diagonal
   trot/run clip ("Run"). Exported `export_yup` / `export_animations`.

Loaded by `src/themes/winter/rendering/arctic-fox.js` (GLTFLoader + AnimationMixer),
re-shaded with a small cool TSL `MeshBasicNodeMaterial` so the coat reads snow-white
under the scene's warm fill light. License: proprietary project original.

## spruce.glb / pine.glb / fir.glb (+ *_lod.glb) — project original

Low-poly winter conifers from the same local TRELLIS.2 + Blender pipeline
(flat-shaded, vertex-coloured, baked wind-sway clip). License: proprietary project
original.

# Chapter 2 (Deep Ocean) — sea-creature GLB assets

Project-owned original assets, produced by the local `C:\AI` photo→3D→rig pipeline
(the same one that authored the Chapter 3 songbirds):

1. **Concept image** — Flux.2 Klein (or Gemini) renders a clean top-down dorsal
   manta on a seamless white background, wings spread flat & symmetric.
2. **Photo → 3D** — TRELLIS.2-4B (Q8_0 GGUF) on ComfyUI, with vertex-colour baking.
3. **Rig & animate** — headless Blender auto-rig (centerline spine + cephalic fins +
   a 3-bone chain per pectoral wing) with distance-based weights and a slow glide/
   flap cycle (one clip).

## Expected files

| file | role | notes |
| --- | --- | --- |
| `manta-glide.glb` | hero manta | dark body + cyan ventral bioluminescence; the escort hero |

Export as **glTF binary (.glb)**, +Z forward, Y up, real-ish proportions (wingspan
wider than body). The loader auto-scales by the largest bound (`targetSize` in
`shared/chapter-02-creature-assets.js`) and replaces the GLB's materials with the
chapter's TSL bioluminescent silhouette, so only geometry + skeleton + the baked
vertex colours + the animation clip need to be correct.

> ⚠️ Odyssey GLB assets are **not** auto-tracked — `git add` the `.glb` explicitly
> or it vanishes on clean checkouts / CI.

License: proprietary-original (project-owned). No third-party attribution required.

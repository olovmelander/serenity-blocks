# Himalayan Peak Asset Attribution

## Golden eagle (`eagle.glb`) — the bird

The lone soaring bird is a real golden eagle reconstructed from a single photo
(`eagle-source.png`) with **TRELLIS.2-4B** (Microsoft, MIT) run locally on an
RTX 5080, then auto-rigged with a hand-authored flap cycle in **Blender** (skinned
glTF, `Flap` clip; ~30k tris). It's rendered as a dark, cool-toned silhouette with
a warm alpenglow rim that tracks the live sun, so it reads against the sky and
sits in the scene's palette. Self-generated asset — TRELLIS.2 is MIT-licensed, so
no third-party attribution is required.

> An earlier **TripoSR** pass on the same photo came out as a volumetric blob (no
> thin spread wings). **TRELLIS.2**'s multi-stage sparse-voxel reconstruction
> resolved the full spread wings + fanned tail.

_Previously this scene also flew a procedural code-built eagle and a recolored
three.js "Stork" model; both were removed in favour of the single TRELLIS.2 eagle._

## The amphitheatre (`massif.png`, `massif-manifest.json`)

The mountains are generated, not surveyed: `scripts/himalayan-peak/bake-massif.mjs` evaluates
the theme's own plan of ridges (`himalayan-peak-massif.js`), runs droplet erosion over it,
measures how much sky each point sees and writes the result as a 1024 × 1024 PNG (red × 256 +
green = height over a 4,400 m range, blue = sky visibility). No elevation data, photograph or
third-party model is involved, so there is nothing to attribute. Regenerate with

    node scripts/himalayan-peak/bake-massif.mjs

which rewrites both files; `tests/unit/himalayan-peak-field.test.js` pins the manifest's hash to
the image.

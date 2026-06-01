# Himalayan Peak Asset Attribution

## Eagle — procedural (no asset)

The hero bird is a **procedural articulated eagle** built in code
([rendering/peak-eagles.js](../rendering/peak-eagles.js), `buildEagleGeometry`):
broad swept wings, fanned tail, small head, thin cambered profile. Its flap is a
research-correct shader articulation — shoulder-arc rotation + tip-lag flex +
downstroke twist + resting dihedral. No external asset, no attribution needed.

> A TripoSR pass (`scripts/triposr-gen.sh` from `artifacts/triposr/eagle-source.png`)
> was tried but the single-image reconstruction came out as a volumetric blob
> (no thin spread wings), so it was dropped in favour of the procedural eagle.

## Bird model (`Stork.glb`) — secondary

Animated morph-target flying-bird from the **three.js** example assets
(`examples/models/gltf/`), by **mirada** for the Google Data Arts "ro.me"
project, distributed with three.js. Recolored to a dark silhouette and flown as
a second, less-frequent bird for variety (its built-in `storkFly_B_` clip drives
the flap).

- Source: https://github.com/mrdoob/three.js/tree/dev/examples/models/gltf

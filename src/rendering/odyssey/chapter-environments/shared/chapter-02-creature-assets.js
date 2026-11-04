/* eslint-disable import/no-unresolved */

/**
 * @fileoverview Chapter 2 (Deep Ocean) GLB sea-creature assets.
 *
 * Skinned, vertex-coloured creature GLBs that swim the Deep Ocean:
 *   - `humpback-swim.glb` (2026-11-03): the humpback mother and calf of the whale pass
 *     (composition/odyssey-whale-pass.js), built, rigged and keyed in headless Blender by
 *     scripts/blender/odyssey/odyssey_whales.py. It replaced `whale-glide.glb`, a photo-to-3D
 *     mesh whose auto-rig was backwards.
 *
 * IMPORTANT: this module is intentionally tolerant of an EMPTY asset directory.
 * `import.meta.glob` returns `{}` when no .glb is present, so the chapter builds and renders
 * normally without it. A GLB dropped into assets/chapter-02/creatures/ must be `git add`ed
 * (Odyssey GLB assets are NOT auto-tracked — they vanish on clean checkouts/CI otherwise).
 */

export const CH2_CREATURE_ASSET_VERSION = 'chapter-02-creatures-v3'; // glob: humpback-swim.glb

export const CH2_CREATURE_ASSET_CONTRACT = Object.freeze({
    author: 'Serenity Blocks asset pipeline',
    source: 'Headless Blender, built from numbers (scripts/blender/odyssey/)',
    license: 'Project-owned original asset',
    licenseCode: 'proprietary-original',
    runtimeUse: 'Chapter 2 Deep Ocean sea creatures (skinned, vertex-coloured)',
});

// Glob every .glb in the creatures dir. Eager + ?url so each value is a hashed
// asset URL. Returns {} when the dir is empty (pre-asset) — never a build error.
let ASSET_MODULES = typeof import.meta.glob === 'function'
    ? import.meta.glob('../../assets/chapter-02/creatures/*.glb', {
        eager: true,
        query: '?url',
        import: 'default',
    })
    : {};

if (Object.keys(ASSET_MODULES).length === 0) {
    ASSET_MODULES = {
        '../../assets/chapter-02/creatures/humpback-swim.glb': new URL(
            '../../assets/chapter-02/creatures/humpback-swim.glb',
            import.meta.url,
        ).href,
    };
}

// Per-file runtime metadata. `targetSize` is the final world size of the model's largest
// bound (the loader auto-scales to it), not a raw multiplier.
const METADATA_BY_FILE = Object.freeze({
    'humpback-swim.glb': {
        id: 'humpback-swim',
        title: 'Humpback',
        role: 'whale',
        targetSize: 42, // world units, largest dimension (length); the whale pass sets its own
        vertexColors: true, // r its white (flippers, flukes below, belly), g the throat, b ao
        skinnedAnimated: true,
        animationClips: 1, // "Swim": one keyed stroke of 4 s, cyclic
        source: 'scripts/blender/odyssey/odyssey_whales.py (headless Blender, built from numbers)',
        artDirection: 'a humpback: long white flippers, wide notched flukes; the mother and calf',
    },
});

function fileNameFromKey(key) {
    return key.split('/').pop();
}

function makeAssetRecord(key) {
    const fileName = fileNameFromKey(key);
    const metadata = METADATA_BY_FILE[fileName] || {};
    return {
        ...CH2_CREATURE_ASSET_CONTRACT,
        ...metadata,
        fileName,
        id: metadata.id || fileName.replace(/\.glb$/i, ''),
        url: ASSET_MODULES[key],
        assetVersion: CH2_CREATURE_ASSET_VERSION,
        attributionRequired: false,
        commercialUse: true,
    };
}

export function getChapter2CreatureAssetRecords() {
    return Object.keys(ASSET_MODULES).sort().map(makeAssetRecord);
}

export function getChapter2CreatureAssetById(id) {
    return getChapter2CreatureAssetRecords().find((record) => record.id === id) || null;
}

export function hasChapter2CreatureAssets() {
    return Object.keys(ASSET_MODULES).length > 0;
}

/* eslint-disable import/no-unresolved */

/**
 * @fileoverview Chapter 2 (Deep Ocean) GLB sea-creature assets.
 *
 * Skinned, vertex-coloured creature GLBs (the hero manta) that swim the Deep
 * Ocean corridor. Authored in the project's own local asset pipeline — the same
 * one that produced the Chapter 3 songbirds (chapter-03-bird-assets.js):
 *   Gemini concept photo → TRELLIS.2-4B (Q8_0 GGUF) photo→3D with vertex-colour
 *   baking → headless-Blender auto-rig (spine + cephalic + per-wing bone chains)
 *   + a natural glide/flap cycle.
 *
 * IMPORTANT: this module is intentionally tolerant of an EMPTY asset directory.
 * `import.meta.glob` returns `{}` when no .glb is present, so the chapter builds
 * and renders normally (the billboard impostors carry it) until `manta-glide.glb`
 * is dropped into assets/chapter-02/creatures/. Drop the GLB in, `git add` it
 * (Odyssey GLB assets are NOT auto-tracked — they vanish on clean checkouts/CI
 * otherwise), and the deep-ocean chapter picks it up automatically.
 */

export const CH2_CREATURE_ASSET_VERSION = 'chapter-02-creatures-v1'; // glob: manta-glide.glb

export const CH2_CREATURE_ASSET_CONTRACT = Object.freeze({
    author: 'Serenity Blocks asset pipeline',
    source: 'Local C:\\AI photo→3D→rig pipeline (TRELLIS.2-4B + Blender auto-rig)',
    license: 'Project-owned original asset',
    licenseCode: 'proprietary-original',
    runtimeUse: 'Chapter 2 Deep Ocean hero sea creatures (skinned, vertex-coloured)',
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
        '../../assets/chapter-02/creatures/manta-glide.glb': new URL(
            '../../assets/chapter-02/creatures/manta-glide.glb',
            import.meta.url,
        ).href,
        '../../assets/chapter-02/creatures/whale-glide.glb': new URL(
            '../../assets/chapter-02/creatures/whale-glide.glb',
            import.meta.url,
        ).href,
    };
}

// Per-file runtime metadata. `runtimeScale` targets an on-screen wingspan of
// ~28u (a hero manta that fills a third of frame at the escort pass); the loader
// auto-scales by the model's largest bound, so this is the final world size, not
// a raw multiplier. Tune after the first capture.
const METADATA_BY_FILE = Object.freeze({
    'manta-glide.glb': {
        id: 'manta-glide',
        title: 'Hero Manta',
        role: 'manta',
        targetSize: 28, // world units, largest dimension (wingspan)
        vertexColors: true,
        skinnedAnimated: true,
        animationClips: 1, // the baked glide/flap cycle
        artDirection: 'dark charcoal-indigo body, electric-cyan ventral bioluminescent rim; the escort hero',
    },
    'whale-glide.glb': {
        id: 'whale-glide',
        title: 'Hero Whale',
        role: 'whale',
        targetSize: 42, // world units, largest dimension (length)
        vertexColors: true,
        skinnedAnimated: true,
        animationClips: 1, // the baked swim cycle
        artDirection: 'dark teal-indigo body with faint bioluminescent lines; the companion giant',
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

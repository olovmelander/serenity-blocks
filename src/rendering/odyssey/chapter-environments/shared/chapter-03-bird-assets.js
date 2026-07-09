/* eslint-disable import/no-unresolved */

/**
 * @fileoverview Chapter 3 flying-bird assets.
 *
 * Skinned, vertex-coloured songbird GLBs (goldfinch + swallow) that fly the
 * Surface World corridor. Unlike the Quaternius CC0 nature kit
 * (chapter-03-quaternius-assets.js), these are authored in the project's own
 * local asset pipeline, so they keep their baked vertex colours and their
 * skeletal "Flap" animation instead of being flattened to role colours.
 *
 * Native model width is ~1.0 unit; runtimeScale ~4.4 reproduces the on-screen
 * wingspan of the previous bird-jay flights (bird-jay rendered ~0.765 wide at
 * its own runtimeScale of 5.8 → ~4.4 units; 1.0 × 4.4 matches that).
 */

export const CH3_FLYING_BIRD_ASSET_VERSION = 'chapter-03-flying-birds-v1';

export const CH3_FLYING_BIRD_ASSET_CONTRACT = Object.freeze({
    author: 'Serenity Blocks asset pipeline',
    source: 'Local C:\\AI photo→3D→rig pipeline',
    license: 'Project-owned original asset',
    licenseCode: 'proprietary-original',
    downloadedOn: '2026-06-14',
    runtimeUse: 'Chapter 3 Surface World flying songbirds (skinned, vertex-coloured)',
});

const ASSET_MODULES = typeof import.meta.glob === 'function'
    ? import.meta.glob('../../assets/chapter-03/birds/*.glb', {
        eager: true,
        query: '?url',
        import: 'default',
    })
    : {
        '../../assets/chapter-03/birds/goldfinch-flying.glb': new URL(
            '../../assets/chapter-03/birds/goldfinch-flying.glb',
            import.meta.url,
        ).href,
        '../../assets/chapter-03/birds/swallow-flying.glb': new URL(
            '../../assets/chapter-03/birds/swallow-flying.glb',
            import.meta.url,
        ).href,
    };

const METADATA_BY_FILE = Object.freeze({
    'goldfinch-flying.glb': {
        id: 'goldfinch-flying',
        title: 'Goldfinch',
        role: 'bird',
        runtimeScale: 4.4,
        vertexColors: true,
        skinnedAnimated: true,
        animationClips: 1,
        artDirection: 'colourful near/mid songbird; keeps its own yellow-black vertex colours',
    },
    'swallow-flying.glb': {
        id: 'swallow-flying',
        title: 'Swallow',
        role: 'bird',
        runtimeScale: 4.4,
        vertexColors: true,
        skinnedAnimated: true,
        animationClips: 1,
        artDirection: 'fast low corridor crosser; keeps its own blue-white vertex colours',
    },
});

function fileNameFromKey(key) {
    return key.split('/').pop();
}

function makeAssetRecord(key) {
    const fileName = fileNameFromKey(key);
    const metadata = METADATA_BY_FILE[fileName] || {};
    return {
        ...CH3_FLYING_BIRD_ASSET_CONTRACT,
        ...metadata,
        fileName,
        id: metadata.id || fileName.replace(/\.glb$/i, ''),
        url: ASSET_MODULES[key],
        assetVersion: CH3_FLYING_BIRD_ASSET_VERSION,
        attributionRequired: false,
        commercialUse: true,
    };
}

export function getChapter3FlyingBirdAssetRecords() {
    return Object.keys(ASSET_MODULES).sort().map(makeAssetRecord);
}

export function getChapter3FlyingBirdAssetById(id) {
    return getChapter3FlyingBirdAssetRecords().find((record) => record.id === id) || null;
}

export function hasChapter3FlyingBirdAssets() {
    return Object.keys(ASSET_MODULES).length > 0;
}

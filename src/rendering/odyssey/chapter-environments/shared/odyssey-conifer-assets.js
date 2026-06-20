/* eslint-disable import/no-unresolved */

/**
 * @fileoverview Shared snow-conifer assets for the Ch3→Ch4 alpine ecotone.
 *
 * Vertex-coloured snow-laden conifers (fir / pine / spruce) used to bridge the asset
 * vocabulary across the Surface World → Mountains seam: the SAME tree-line species appear
 * on both sides, snow-dusted, thinning to the tree line. Sourced from the winter theme's
 * pipeline GLBs (`src/themes/winter/assets/*_lod.glb`), single-mesh + COLOR_0 vertex colours
 * (snow baked in: fir ~23% / pine ~10% / spruce ~4% white) + normals, no textures — the same
 * load path as the Chapter 3 birds. ~1.6u tall, Y-up, instanceable LODs.
 */

export const ODYSSEY_CONIFER_ASSET_VERSION = 'odyssey-snow-conifers-v1';

const ASSET_MODULES = typeof import.meta.glob === 'function'
    ? import.meta.glob('../../assets/shared/conifers/*.glb', {
        eager: true,
        query: '?url',
        import: 'default',
    })
    : ['fir_lod', 'pine_lod', 'spruce_lod'].reduce((acc, n) => {
        const rel = `../../assets/shared/conifers/${n}.glb`;
        acc[rel] = new URL(rel, import.meta.url).href;
        return acc;
    }, {});

// runtimeScale brings the ~1.6u native models to a readable tree height (~13–16u, matching
// the procedural Ch3 trees). snowiness orders the species up the slope (spruce low/green →
// fir high/white). upAxisYOffsetFrac seats the base after measuring bounds at load.
const METADATA_BY_FILE = Object.freeze({
    'spruce_lod.glb': {
        id: 'spruce', title: 'Spruce', runtimeScale: 7.5, snowiness: 0.25, vertexColors: true,
    },
    'pine_lod.glb': {
        id: 'pine', title: 'Pine', runtimeScale: 7.5, snowiness: 0.5, vertexColors: true,
    },
    'fir_lod.glb': {
        id: 'fir', title: 'Fir', runtimeScale: 8.0, snowiness: 0.85, vertexColors: true,
    },
});

function fileNameFromKey(key) {
    return key.split('/').pop();
}

function makeRecord(key) {
    const fileName = fileNameFromKey(key);
    const metadata = METADATA_BY_FILE[fileName] || {};
    return {
        ...metadata,
        fileName,
        id: metadata.id || fileName.replace(/\.glb$/i, ''),
        url: ASSET_MODULES[key],
        assetVersion: ODYSSEY_CONIFER_ASSET_VERSION,
    };
}

export function getOdysseyConiferAssetRecords() {
    return Object.keys(ASSET_MODULES).sort().map(makeRecord);
}

export function getOdysseyConiferAssetById(id) {
    return getOdysseyConiferAssetRecords().find((record) => record.id === id) || null;
}

export function hasOdysseyConiferAssets() {
    return Object.keys(ASSET_MODULES).length > 0;
}

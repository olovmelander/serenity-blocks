/* eslint-disable import/no-unresolved */
/**
 * Ocean Theme — Hero Rock Asset Loader
 *
 * Discovers any `.glb` files dropped into ./assets/rocks/ at build time and
 * exposes their URLs to the atmosphere system. If the folder is empty the
 * foreground rocks fall back to procedural displaced geometry.
 *
 * See ./assets/rocks/README.md for the Blender authoring workflow.
 */

export const OCEAN_ROCK_ASSET_VERSION = 'v1-poly-pizza-cc0-rock-details';

export const OCEAN_ROCK_AUTHORING_CONTRACT = {
    sourcePolicy: 'CC0-preferred-tiny-shape-only',
    coordinateForward: '+Z decorative / Y up',
    yUp: true,
    origin: 'seabed-anchor',
    allowedLicenses: ['CC0'],
    polyPizzaPrimary: true,
    noPaidMarketplaceAssets: true,
    noProprietaryArtwork: true,
    targetTriangleBudget: { min: 50, max: 600 },
    targetMaxBytes: 256 * 1024,
    materialMode: 'runtime-rock-material-override',
};

const ROCK_MODULES = typeof import.meta.glob === 'function'
    ? import.meta.glob('./assets/rocks/*.glb', {
        eager: true,
        query: '?url',
        import: 'default',
    })
    : {
        './assets/rocks/rock-1-quaternius-large-cc0.glb': new URL(
            './assets/rocks/rock-1-quaternius-large-cc0.glb',
            import.meta.url,
        ).href,
        './assets/rocks/rock-2-kenney-cc0.glb': new URL(
            './assets/rocks/rock-2-kenney-cc0.glb',
            import.meta.url,
        ).href,
    };

const ROCK_METADATA = {
    'rock-1-quaternius-large-cc0.glb': {
        id: 'rock-1-quaternius-large-cc0',
        kind: 'foreground-rock',
        triangleCount: 222,
        byteSize: 18608,
        textureCount: 1,
        runtimeScale: 1.0,
        sourceMode: 'third-party-cc0',
        license: 'CC0',
        author: 'Quaternius',
        sourceUrl: 'https://poly.pizza/m/54jZKTAt5p',
        attributionRequired: false,
    },
    'rock-2-kenney-cc0.glb': {
        id: 'rock-2-kenney-cc0',
        kind: 'foreground-rock',
        triangleCount: 120,
        byteSize: 8380,
        textureCount: 0,
        runtimeScale: 1.0,
        sourceMode: 'third-party-cc0',
        license: 'CC0',
        author: 'Kenney',
        sourceUrl: 'https://poly.pizza/m/cBqdRdLDDL',
        attributionRequired: false,
    },
};

function fileNameFromKey(key) {
    return key.split('/').pop();
}

function makeRockRecord(key) {
    const fileName = fileNameFromKey(key);
    const metadata = ROCK_METADATA[fileName] || {};
    return {
        id: metadata.id || fileName.replace(/\.glb$/i, ''),
        kind: metadata.kind || 'foreground-rock',
        fileName,
        url: ROCK_MODULES[key],
        modelVersion: OCEAN_ROCK_ASSET_VERSION,
        sourceMode: metadata.sourceMode || 'third-party-cc0',
        license: metadata.license || 'CC0',
        author: metadata.author || null,
        sourceUrl: metadata.sourceUrl || null,
        attributionRequired: metadata.attributionRequired ?? false,
        coordinateForward: OCEAN_ROCK_AUTHORING_CONTRACT.coordinateForward,
        yUp: OCEAN_ROCK_AUTHORING_CONTRACT.yUp,
        triangleCount: metadata.triangleCount ?? null,
        triangleBudget: OCEAN_ROCK_AUTHORING_CONTRACT.targetTriangleBudget,
        byteSize: metadata.byteSize ?? null,
        maxBytes: OCEAN_ROCK_AUTHORING_CONTRACT.targetMaxBytes,
        textureCount: metadata.textureCount ?? null,
        textureBudget: 1,
        runtimeScale: metadata.runtimeScale ?? 1,
        materialMode: OCEAN_ROCK_AUTHORING_CONTRACT.materialMode,
    };
}

export function getHeroRockAssetRecords() {
    return Object.keys(ROCK_MODULES)
        .sort()
        .map(makeRockRecord);
}

/**
 * Returns hero rock GLB URLs sorted alphabetically by filename. Empty array
 * when no GLBs are present — callers should fall back to procedural rocks.
 */
export function getHeroRockAssetUrls() {
    return getHeroRockAssetRecords()
        .map((record) => record.url);
}

export function hasHeroRockAssets() {
    return Object.keys(ROCK_MODULES).length > 0;
}

export function summarizeRockAssetManifest() {
    return {
        version: OCEAN_ROCK_ASSET_VERSION,
        contract: { ...OCEAN_ROCK_AUTHORING_CONTRACT },
        heroRocks: getHeroRockAssetRecords().map(({ url, ...record }) => record),
    };
}

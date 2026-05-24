/* eslint-disable import/no-unresolved */
/**
 * Ocean Theme — Hero Kelp Asset Manifest
 *
 * Blender-authored GLBs dropped into ./assets/kelp/ are loaded as tall hero
 * grove anchors. Runtime materials inject vertex sway from mesh-local height,
 * so the authored silhouettes remain dynamic.
 */

export const OCEAN_KELP_ASSET_VERSION = 'v2-poly-pizza-environment-assets';

export const OCEAN_KELP_AUTHORING_CONTRACT = {
    sourcePolicy: 'CC0-preferred-CC-BY-with-attribution',
    coordinateForward: '+Z decorative / Y up',
    yUp: true,
    origin: 'seabed-anchor',
    defaultSourceMode: 'blender-only-project-authored',
    defaultLicense: 'MIT-project-local',
    defaultAuthor: 'Serenity Blocks Blender asset pipeline',
    allowedLicenses: ['MIT-project-local', 'CC0', 'CC-BY-4.0'],
    polyPizzaPrimary: true,
    freeAssetFallbackPolicy: 'CC0-preferred-CC-BY-with-attribution',
    noPaidMarketplaceAssets: true,
    noProprietaryArtwork: true,
    targetTriangleBudget: { min: 100, max: 4000 },
    targetMaxBytes: 600 * 1024,
};

const KELP_MODULES = typeof import.meta.glob === 'function'
    ? import.meta.glob('./assets/kelp/*.glb', {
        eager: true,
        query: '?url',
        import: 'default',
    })
    : {
        './assets/kelp/kelp-grove-01.glb': new URL('./assets/kelp/kelp-grove-01.glb', import.meta.url).href,
        './assets/kelp/kelp-grove-02.glb': new URL('./assets/kelp/kelp-grove-02.glb', import.meta.url).href,
        './assets/kelp/kelp-grove-03.glb': new URL('./assets/kelp/kelp-grove-03.glb', import.meta.url).href,
        './assets/kelp/kelp-grove-04.glb': new URL('./assets/kelp/kelp-grove-04.glb', import.meta.url).href,
        './assets/kelp/kelp-christopher-ccby.glb': new URL('./assets/kelp/kelp-christopher-ccby.glb', import.meta.url).href,
        './assets/kelp/kelp-google-ccby.glb': new URL('./assets/kelp/kelp-google-ccby.glb', import.meta.url).href,
        './assets/kelp/seagrass-quaternius-01-cc0.glb': new URL('./assets/kelp/seagrass-quaternius-01-cc0.glb', import.meta.url).href,
        './assets/kelp/seagrass-quaternius-tall-cc0.glb': new URL(
            './assets/kelp/seagrass-quaternius-tall-cc0.glb',
            import.meta.url,
        ).href,
        './assets/kelp/seagrass-quaternius-wispy-cc0.glb': new URL(
            './assets/kelp/seagrass-quaternius-wispy-cc0.glb',
            import.meta.url,
        ).href,
        './assets/kelp/seaweed-laney-01-ccby.glb': new URL('./assets/kelp/seaweed-laney-01-ccby.glb', import.meta.url).href,
        './assets/kelp/seaweed-laney-02-ccby.glb': new URL('./assets/kelp/seaweed-laney-02-ccby.glb', import.meta.url).href,
        './assets/kelp/seaweed-laney-03-ccby.glb': new URL('./assets/kelp/seaweed-laney-03-ccby.glb', import.meta.url).href,
    };

const KELP_METADATA = {
    'kelp-grove-01.glb': {
        id: 'kelp-grove-01',
        kind: 'ribbon-kelp-grove',
        triangleCount: 1280,
        byteSize: 51112,
        runtimeScale: 1.0,
        materialMode: 'runtime-height-sway',
    },
    'kelp-grove-02.glb': {
        id: 'kelp-grove-02',
        kind: 'split-ribbon-kelp-grove',
        triangleCount: 1408,
        byteSize: 56088,
        runtimeScale: 1.0,
        materialMode: 'runtime-height-sway',
    },
    'kelp-grove-03.glb': {
        id: 'kelp-grove-03',
        kind: 'fan-ribbon-kelp-grove',
        triangleCount: 1664,
        byteSize: 66020,
        runtimeScale: 1.0,
        materialMode: 'runtime-height-sway',
    },
    'kelp-grove-04.glb': {
        id: 'kelp-grove-04',
        kind: 'tall-silhouette-kelp-grove',
        triangleCount: 1536,
        byteSize: 61040,
        runtimeScale: 1.0,
        materialMode: 'runtime-height-sway',
    },
    'kelp-google-ccby.glb': {
        id: 'kelp-google-ccby',
        kind: 'poly-pizza-kelp',
        triangleCount: 784,
        byteSize: 267024,
        textureCount: 1,
        runtimeScale: 2.75,
        placementRole: 'hero-kelp',
        materialMode: 'runtime-height-sway',
        sourceMode: 'third-party-cc-by',
        license: 'CC-BY-4.0',
        author: 'Poly by Google',
        sourceUrl: 'https://poly.pizza/m/4cFllH6Iazk',
        attributionRequired: true,
        sourcePriority: 44,
    },
    'kelp-christopher-ccby.glb': {
        id: 'kelp-christopher-ccby',
        kind: 'poly-pizza-kelp',
        triangleCount: 3440,
        byteSize: 326520,
        textureCount: 0,
        runtimeScale: 4.2,
        placementRole: 'hero-kelp',
        materialMode: 'runtime-height-sway',
        sourceMode: 'third-party-cc-by',
        license: 'CC-BY-4.0',
        author: 'Christopher F',
        sourceUrl: 'https://poly.pizza/m/3VhttTFyADO',
        attributionRequired: true,
        sourcePriority: 42,
    },
    'seaweed-laney-03-ccby.glb': {
        id: 'seaweed-laney-03-ccby',
        kind: 'poly-pizza-seaweed',
        triangleCount: 1832,
        byteSize: 104560,
        textureCount: 0,
        runtimeScale: 5.6,
        placementRole: 'hero-kelp',
        materialMode: 'runtime-height-sway',
        sourceMode: 'third-party-cc-by',
        license: 'CC-BY-4.0',
        author: 'Laney XR Labs',
        sourceUrl: 'https://poly.pizza/m/f_gXhnf06Oc',
        attributionRequired: true,
        sourcePriority: 40,
    },
    'seaweed-laney-02-ccby.glb': {
        id: 'seaweed-laney-02-ccby',
        kind: 'poly-pizza-seaweed',
        triangleCount: 1424,
        byteSize: 80216,
        textureCount: 0,
        runtimeScale: 5.4,
        placementRole: 'hero-kelp',
        materialMode: 'runtime-height-sway',
        sourceMode: 'third-party-cc-by',
        license: 'CC-BY-4.0',
        author: 'Laney XR Labs',
        sourceUrl: 'https://poly.pizza/m/b_eanaL8C6j',
        attributionRequired: true,
        sourcePriority: 38,
    },
    'seaweed-laney-01-ccby.glb': {
        id: 'seaweed-laney-01-ccby',
        kind: 'poly-pizza-seaweed',
        triangleCount: 998,
        byteSize: 56632,
        textureCount: 0,
        runtimeScale: 5.3,
        placementRole: 'hero-kelp',
        materialMode: 'runtime-height-sway',
        sourceMode: 'third-party-cc-by',
        license: 'CC-BY-4.0',
        author: 'Laney XR Labs',
        sourceUrl: 'https://poly.pizza/m/461xlaa6SZW',
        attributionRequired: true,
        sourcePriority: 36,
    },
    'seagrass-quaternius-01-cc0.glb': {
        id: 'seagrass-quaternius-01-cc0',
        kind: 'seagrass-detail',
        triangleCount: 155,
        byteSize: 79796,
        textureCount: 1,
        runtimeScale: 1.0,
        placementRole: 'seagrass-detail',
        materialMode: 'runtime-height-sway',
        sourceMode: 'third-party-cc0',
        license: 'CC0',
        author: 'Quaternius',
        sourceUrl: 'https://poly.pizza/m/vUJjrRsFp4',
        attributionRequired: false,
        sourcePriority: 30,
    },
    'seagrass-quaternius-tall-cc0.glb': {
        id: 'seagrass-quaternius-tall-cc0',
        kind: 'seagrass-detail',
        triangleCount: 326,
        byteSize: 88020,
        textureCount: 1,
        runtimeScale: 0.8,
        placementRole: 'seagrass-detail',
        materialMode: 'runtime-height-sway',
        sourceMode: 'third-party-cc0',
        license: 'CC0',
        author: 'Quaternius',
        sourceUrl: 'https://poly.pizza/m/JSIYtscPmP',
        attributionRequired: false,
        sourcePriority: 29,
    },
    'seagrass-quaternius-wispy-cc0.glb': {
        id: 'seagrass-quaternius-wispy-cc0',
        kind: 'seagrass-detail',
        triangleCount: 494,
        byteSize: 97188,
        textureCount: 1,
        runtimeScale: 0.95,
        placementRole: 'seagrass-detail',
        materialMode: 'runtime-height-sway',
        sourceMode: 'third-party-cc0',
        license: 'CC0',
        author: 'Quaternius',
        sourceUrl: 'https://poly.pizza/m/Msr9zx66VU',
        attributionRequired: false,
        sourcePriority: 28,
    },
};

function fileNameFromKey(key) {
    return key.split('/').pop();
}

function makeKelpRecord(key) {
    const fileName = fileNameFromKey(key);
    const metadata = KELP_METADATA[fileName] || {};
    return {
        id: metadata.id || fileName.replace(/\.glb$/i, ''),
        kind: metadata.kind || 'hero-kelp',
        fileName,
        url: KELP_MODULES[key],
        modelVersion: OCEAN_KELP_ASSET_VERSION,
        sourceMode: metadata.sourceMode || OCEAN_KELP_AUTHORING_CONTRACT.defaultSourceMode,
        license: metadata.license || OCEAN_KELP_AUTHORING_CONTRACT.defaultLicense,
        author: metadata.author || OCEAN_KELP_AUTHORING_CONTRACT.defaultAuthor,
        sourceUrl: metadata.sourceUrl || null,
        attributionRequired: metadata.attributionRequired ?? false,
        coordinateForward: OCEAN_KELP_AUTHORING_CONTRACT.coordinateForward,
        yUp: OCEAN_KELP_AUTHORING_CONTRACT.yUp,
        triangleCount: metadata.triangleCount ?? null,
        triangleBudget: OCEAN_KELP_AUTHORING_CONTRACT.targetTriangleBudget,
        byteSize: metadata.byteSize ?? null,
        maxBytes: OCEAN_KELP_AUTHORING_CONTRACT.targetMaxBytes,
        textureCount: metadata.textureCount ?? null,
        textureBudget: 3,
        runtimeScale: metadata.runtimeScale ?? 1,
        placementRole: metadata.placementRole || 'hero-kelp',
        materialMode: metadata.materialMode || 'runtime-height-sway',
        sourcePriority: metadata.sourcePriority ?? 0,
    };
}

function getAllKelpAssetRecords() {
    return Object.keys(KELP_MODULES)
        .map(makeKelpRecord)
        .sort((a, b) => (
            (b.sourcePriority - a.sourcePriority)
            || a.fileName.localeCompare(b.fileName)
        ));
}

export function getHeroKelpAssetRecords() {
    return getAllKelpAssetRecords()
        .filter((record) => record.placementRole !== 'seagrass-detail');
}

export function getSeabedPlantAssetRecords() {
    return getAllKelpAssetRecords()
        .filter((record) => record.placementRole === 'seagrass-detail');
}

export function hasHeroKelpAssets() {
    return Object.keys(KELP_MODULES).length > 0;
}

export function summarizeKelpAssetManifest() {
    return {
        version: OCEAN_KELP_ASSET_VERSION,
        contract: { ...OCEAN_KELP_AUTHORING_CONTRACT },
        heroKelp: getHeroKelpAssetRecords().map(({ url, ...record }) => record),
        seabedPlants: getSeabedPlantAssetRecords().map(({ url, ...record }) => record),
    };
}

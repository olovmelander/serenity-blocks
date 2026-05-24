/* eslint-disable import/no-unresolved */
/**
 * Ocean Theme — Hero Coral Asset Manifest
 *
 * Blender-authored GLBs dropped into ./assets/corals/ are loaded as close/mid
 * camera hero colonies. Empty folders are valid: the atmosphere system keeps
 * procedural hero coral placeholders until GLBs are available.
 */

export const OCEAN_CORAL_ASSET_VERSION = 'v2-poly-pizza-environment-assets';

export const OCEAN_CORAL_AUTHORING_CONTRACT = {
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
    targetTriangleBudget: { min: 3000, max: 8000 },
    targetMaxBytes: 1024 * 1024,
};

const CORAL_MODULES = typeof import.meta.glob === 'function'
    ? import.meta.glob('./assets/corals/*.glb', {
        eager: true,
        query: '?url',
        import: 'default',
    })
    : {
        './assets/corals/coral-anemone-01.glb': new URL('./assets/corals/coral-anemone-01.glb', import.meta.url).href,
        './assets/corals/coral-boulder-01.glb': new URL('./assets/corals/coral-boulder-01.glb', import.meta.url).href,
        './assets/corals/coral-branch-01.glb': new URL('./assets/corals/coral-branch-01.glb', import.meta.url).href,
        './assets/corals/coral-brush-blue-01.glb': new URL(
            './assets/corals/coral-brush-blue-01.glb',
            import.meta.url,
        ).href,
        './assets/corals/coral-carpet-purple-01.glb': new URL(
            './assets/corals/coral-carpet-purple-01.glb',
            import.meta.url,
        ).href,
        './assets/corals/coral-reef-set-minipoly-cc0.glb': new URL(
            './assets/corals/coral-reef-set-minipoly-cc0.glb',
            import.meta.url,
        ).href,
        './assets/corals/coral-reef-set3-minipoly-ccby.glb': new URL(
            './assets/corals/coral-reef-set3-minipoly-ccby.glb',
            import.meta.url,
        ).href,
        './assets/corals/coral-fan-01.glb': new URL('./assets/corals/coral-fan-01.glb', import.meta.url).href,
        './assets/corals/coral-plate-green-01.glb': new URL(
            './assets/corals/coral-plate-green-01.glb',
            import.meta.url,
        ).href,
        './assets/corals/coral-spire-01.glb': new URL('./assets/corals/coral-spire-01.glb', import.meta.url).href,
        './assets/corals/coral-table-01.glb': new URL('./assets/corals/coral-table-01.glb', import.meta.url).href,
        './assets/corals/coral-tube-orange-01.glb': new URL(
            './assets/corals/coral-tube-orange-01.glb',
            import.meta.url,
        ).href,
    };

const CORAL_METADATA = {
    'coral-branch-01.glb': {
        id: 'coral-branch-01',
        kind: 'branching-coral',
        triangleCount: 2500,
        byteSize: 126240,
        runtimeScale: 1.0,
        placementRole: 'hero-colony',
        materialMode: 'preserve-pbr-underwater-rim',
    },
    'coral-fan-01.glb': {
        id: 'coral-fan-01',
        kind: 'fan-coral',
        triangleCount: 7436,
        byteSize: 141704,
        runtimeScale: 1.0,
        placementRole: 'hero-colony',
        materialMode: 'preserve-pbr-underwater-rim',
    },
    'coral-table-01.glb': {
        id: 'coral-table-01',
        kind: 'table-coral',
        triangleCount: 2736,
        byteSize: 111096,
        runtimeScale: 1.0,
        placementRole: 'hero-colony',
        materialMode: 'preserve-pbr-underwater-rim',
    },
    'coral-spire-01.glb': {
        id: 'coral-spire-01',
        kind: 'spire-coral',
        triangleCount: 2108,
        byteSize: 106492,
        runtimeScale: 1.0,
        placementRole: 'hero-colony',
        materialMode: 'preserve-pbr-underwater-rim',
    },
    'coral-anemone-01.glb': {
        id: 'coral-anemone-01',
        kind: 'anemone-coral',
        triangleCount: 3008,
        byteSize: 150732,
        runtimeScale: 1.0,
        placementRole: 'hero-colony',
        materialMode: 'preserve-pbr-underwater-rim',
    },
    'coral-boulder-01.glb': {
        id: 'coral-boulder-01',
        kind: 'boulder-coral',
        triangleCount: 5144,
        byteSize: 163748,
        runtimeScale: 1.0,
        placementRole: 'hero-colony',
        materialMode: 'preserve-pbr-underwater-rim',
    },
    'coral-carpet-purple-01.glb': {
        id: 'coral-carpet-purple-01',
        kind: 'purple-blue-coral-carpet',
        triangleCount: 2884,
        byteSize: 194804,
        runtimeScale: 1.0,
        placementRole: 'carpet-patch',
        materialMode: 'preserve-pbr-underwater-rim',
    },
    'coral-reef-set-minipoly-cc0.glb': {
        id: 'coral-reef-set-minipoly-cc0',
        kind: 'purple-blue-coral-carpet',
        triangleCount: 6080,
        byteSize: 395956,
        textureCount: 3,
        runtimeScale: 0.35,
        placementRole: 'carpet-patch',
        materialMode: 'preserve-pbr-underwater-rim',
        sourceMode: 'third-party-cc0',
        license: 'CC0',
        author: 'MiniPoly',
        sourceUrl: 'https://poly.pizza/m/74GL45Fvdh',
        attributionRequired: false,
        sourcePriority: 30,
    },
    'coral-reef-set3-minipoly-ccby.glb': {
        id: 'coral-reef-set3-minipoly-ccby',
        kind: 'branching-coral',
        triangleCount: 3200,
        byteSize: 264136,
        textureCount: 3,
        runtimeScale: 0.42,
        placementRole: 'hero-colony',
        materialMode: 'preserve-pbr-underwater-rim',
        sourceMode: 'third-party-cc-by',
        license: 'CC-BY-4.0',
        author: 'MiniPoly',
        sourceUrl: 'https://poly.pizza/m/UyswwdHFiL',
        attributionRequired: true,
        sourcePriority: 28,
    },
    'coral-tube-orange-01.glb': {
        id: 'coral-tube-orange-01',
        kind: 'orange-tube-sponge-cluster',
        triangleCount: 5520,
        byteSize: 278744,
        runtimeScale: 1.0,
        placementRole: 'carpet-patch',
        materialMode: 'preserve-pbr-underwater-rim',
    },
    'coral-plate-green-01.glb': {
        id: 'coral-plate-green-01',
        kind: 'green-yellow-plate-coral',
        triangleCount: 4176,
        byteSize: 174508,
        runtimeScale: 1.0,
        placementRole: 'carpet-patch',
        materialMode: 'preserve-pbr-underwater-rim',
    },
    'coral-brush-blue-01.glb': {
        id: 'coral-brush-blue-01',
        kind: 'blue-brush-coral',
        triangleCount: 2016,
        byteSize: 147184,
        runtimeScale: 1.0,
        placementRole: 'carpet-patch',
        materialMode: 'preserve-pbr-underwater-rim',
    },
    // ── Vibrant reef sponges + corals — generated via Blender MCP to match
    //    the reference reef-canyon photo (warm orange tubes, magenta vases,
    //    violet sea fan, green-yellow barrel stack).
    'sponge-tube-orange-01.glb': {
        id: 'sponge-tube-orange-01',
        kind: 'orange-tube-sponge',
        runtimeScale: 1.0,
        placementRole: 'hero-colony',
        materialMode: 'preserve-pbr-underwater-rim',
    },
    'sponge-tube-purple-01.glb': {
        id: 'sponge-tube-purple-01',
        kind: 'purple-tube-sponge',
        runtimeScale: 1.0,
        placementRole: 'hero-colony',
        materialMode: 'preserve-pbr-underwater-rim',
    },
    'sponge-barrel-yellow-01.glb': {
        id: 'sponge-barrel-yellow-01',
        kind: 'yellow-barrel-sponge',
        runtimeScale: 1.0,
        placementRole: 'hero-colony',
        materialMode: 'preserve-pbr-underwater-rim',
    },
    'coral-vase-magenta-01.glb': {
        id: 'coral-vase-magenta-01',
        kind: 'magenta-vase-coral',
        runtimeScale: 1.0,
        placementRole: 'hero-colony',
        materialMode: 'preserve-pbr-underwater-rim',
    },
    'coral-fan-purple-01.glb': {
        id: 'coral-fan-purple-01',
        kind: 'purple-sea-fan',
        runtimeScale: 1.0,
        placementRole: 'hero-colony',
        materialMode: 'preserve-pbr-underwater-rim',
    },
};

function fileNameFromKey(key) {
    return key.split('/').pop();
}

function makeCoralRecord(key) {
    const fileName = fileNameFromKey(key);
    const metadata = CORAL_METADATA[fileName] || {};
    return {
        id: metadata.id || fileName.replace(/\.glb$/i, ''),
        kind: metadata.kind || 'hero-coral',
        fileName,
        url: CORAL_MODULES[key],
        modelVersion: OCEAN_CORAL_ASSET_VERSION,
        sourceMode: metadata.sourceMode || OCEAN_CORAL_AUTHORING_CONTRACT.defaultSourceMode,
        license: metadata.license || OCEAN_CORAL_AUTHORING_CONTRACT.defaultLicense,
        author: metadata.author || OCEAN_CORAL_AUTHORING_CONTRACT.defaultAuthor,
        sourceUrl: metadata.sourceUrl || null,
        attributionRequired: metadata.attributionRequired ?? false,
        coordinateForward: OCEAN_CORAL_AUTHORING_CONTRACT.coordinateForward,
        yUp: OCEAN_CORAL_AUTHORING_CONTRACT.yUp,
        triangleCount: metadata.triangleCount ?? null,
        triangleBudget: OCEAN_CORAL_AUTHORING_CONTRACT.targetTriangleBudget,
        byteSize: metadata.byteSize ?? null,
        maxBytes: OCEAN_CORAL_AUTHORING_CONTRACT.targetMaxBytes,
        textureCount: metadata.textureCount ?? null,
        textureBudget: 4,
        runtimeScale: metadata.runtimeScale ?? 1,
        placementRole: metadata.placementRole || 'hero-colony',
        materialMode: metadata.materialMode || 'preserve-pbr-underwater-rim',
        sourcePriority: metadata.sourcePriority ?? 0,
    };
}

export function getHeroCoralAssetRecords() {
    return Object.keys(CORAL_MODULES)
        .map(makeCoralRecord)
        .sort((a, b) => (
            (b.sourcePriority - a.sourcePriority)
            || a.fileName.localeCompare(b.fileName)
        ));
}

export function hasHeroCoralAssets() {
    return Object.keys(CORAL_MODULES).length > 0;
}

export function getCoralCarpetAssetRecords() {
    return getHeroCoralAssetRecords()
        .filter((record) => record.placementRole === 'carpet-patch');
}

export function summarizeCoralAssetManifest() {
    return {
        version: OCEAN_CORAL_ASSET_VERSION,
        contract: { ...OCEAN_CORAL_AUTHORING_CONTRACT },
        heroCorals: getHeroCoralAssetRecords().map(({ url, ...record }) => record),
    };
}

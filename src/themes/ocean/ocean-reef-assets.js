/* eslint-disable import/no-unresolved */
/**
 * Ocean Theme — Showcase Reef Canyon Asset Manifest
 *
 * Blender-authored reef wall/shelf/arch GLBs are used as fixed visual anchors
 * for the canyon composition. Procedural reef rocks remain the fallback and
 * bulk layer.
 */

export const OCEAN_REEF_ASSET_VERSION = 'v1-blender-showcase-reef-canyon';

export const OCEAN_REEF_AUTHORING_CONTRACT = {
    sourcePolicy: 'blender-only-project-authored',
    coordinateForward: '+Z decorative / Y up',
    yUp: true,
    origin: 'seabed-anchor',
    license: 'MIT-project-local',
    author: 'Serenity Blocks Blender asset pipeline',
    noMarketplaceAssets: true,
    noProprietaryArtwork: true,
    targetTriangleBudget: { min: 4000, max: 12000 },
    targetMaxBytes: 1024 * 1024,
};

const REEF_MODULES = typeof import.meta.glob === 'function'
    ? import.meta.glob('./assets/reef/*.glb', {
        eager: true,
        query: '?url',
        import: 'default',
    })
    : {
        './assets/reef/reef-arch-coral-01.glb': new URL('./assets/reef/reef-arch-coral-01.glb', import.meta.url).href,
        './assets/reef/reef-arch-mid-01.glb': new URL('./assets/reef/reef-arch-mid-01.glb', import.meta.url).href,
        './assets/reef/reef-shelf-left-01.glb': new URL('./assets/reef/reef-shelf-left-01.glb', import.meta.url).href,
        './assets/reef/reef-shelf-right-01.glb': new URL('./assets/reef/reef-shelf-right-01.glb', import.meta.url).href,
        './assets/reef/reef-stack-far-01.glb': new URL('./assets/reef/reef-stack-far-01.glb', import.meta.url).href,
        './assets/reef/reef-wall-left-01.glb': new URL('./assets/reef/reef-wall-left-01.glb', import.meta.url).href,
    };

const REEF_METADATA = {
    'reef-wall-left-01.glb': {
        id: 'reef-wall-left-01',
        kind: 'left-canyon-wall',
        triangleCount: 8832,
        byteSize: 280328,
        runtimeScale: 7.4,
        materialMode: 'preserve-pbr-caustic-rim',
    },
    'reef-shelf-right-01.glb': {
        id: 'reef-shelf-right-01',
        kind: 'right-coral-shelf',
        triangleCount: 7176,
        byteSize: 231296,
        runtimeScale: 6.8,
        materialMode: 'preserve-pbr-caustic-rim',
    },
    'reef-shelf-left-01.glb': {
        id: 'reef-shelf-left-01',
        kind: 'left-coral-shelf',
        triangleCount: 6624,
        byteSize: 214776,
        runtimeScale: 6.4,
        materialMode: 'preserve-pbr-caustic-rim',
    },
    'reef-arch-mid-01.glb': {
        id: 'reef-arch-mid-01',
        kind: 'mid-canyon-arch',
        triangleCount: 11184,
        byteSize: 280500,
        runtimeScale: 7.2,
        materialMode: 'preserve-pbr-caustic-rim',
    },
    'reef-stack-far-01.glb': {
        id: 'reef-stack-far-01',
        kind: 'far-blue-stack',
        triangleCount: 7728,
        byteSize: 249156,
        runtimeScale: 8.2,
        materialMode: 'preserve-pbr-caustic-rim',
    },
    // Foreground reef arch with baked stylized coral accents. This intentionally
    // uses simple generated materials only, with no embedded texture payload.
    'reef-arch-coral-01.glb': {
        id: 'reef-arch-coral-01',
        kind: 'foreground-coral-arch',
        triangleCount: 11080,
        byteSize: 384000,
        textureCount: 0,
        runtimeScale: 3.6,
        materialMode: 'preserve-pbr-caustic-rim',
    },
};

function fileNameFromKey(key) {
    return key.split('/').pop();
}

function makeReefRecord(key) {
    const fileName = fileNameFromKey(key);
    const metadata = REEF_METADATA[fileName] || {};
    return {
        id: metadata.id || fileName.replace(/\.glb$/i, ''),
        kind: metadata.kind || 'showcase-reef-anchor',
        fileName,
        url: REEF_MODULES[key],
        modelVersion: OCEAN_REEF_ASSET_VERSION,
        sourceMode: OCEAN_REEF_AUTHORING_CONTRACT.sourcePolicy,
        license: OCEAN_REEF_AUTHORING_CONTRACT.license,
        author: OCEAN_REEF_AUTHORING_CONTRACT.author,
        coordinateForward: OCEAN_REEF_AUTHORING_CONTRACT.coordinateForward,
        yUp: OCEAN_REEF_AUTHORING_CONTRACT.yUp,
        triangleCount: metadata.triangleCount ?? null,
        triangleBudget: OCEAN_REEF_AUTHORING_CONTRACT.targetTriangleBudget,
        byteSize: metadata.byteSize ?? null,
        maxBytes: OCEAN_REEF_AUTHORING_CONTRACT.targetMaxBytes,
        textureCount: metadata.textureCount ?? 0,
        textureBudget: 4,
        runtimeScale: metadata.runtimeScale ?? 1,
        materialMode: metadata.materialMode || 'preserve-pbr-caustic-rim',
    };
}

export function getHeroReefAssetRecords() {
    return Object.keys(REEF_MODULES)
        .sort()
        .map(makeReefRecord);
}

export function hasHeroReefAssets() {
    return Object.keys(REEF_MODULES).length > 0;
}

export function summarizeReefAssetManifest() {
    return {
        version: OCEAN_REEF_ASSET_VERSION,
        contract: { ...OCEAN_REEF_AUTHORING_CONTRACT },
        heroReef: getHeroReefAssetRecords().map(({ url, ...record }) => record),
    };
}

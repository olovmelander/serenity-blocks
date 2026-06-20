/* eslint-disable import/no-unresolved */

export const CH3_QUATERNIUS_ASSET_VERSION = 'chapter-03-quaternius-cc0-v1';

export const CH3_QUATERNIUS_ASSET_CONTRACT = Object.freeze({
    author: 'Quaternius',
    source: 'Poly Pizza',
    profileUrl: 'https://poly.pizza/u/Quaternius',
    bundleUrl: 'https://poly.pizza/bundle/Stylized-Nature-MegaKit-T34GZFA0fm',
    license: 'Public Domain (CC0)',
    licenseCode: 'CC0 1.0',
    downloadedOn: '2026-06-13',
    runtimeUse: 'Chapter 3 Surface World foreground nature, forest clusters, shoreline rocks, and birds',
});

const ASSET_MODULES = typeof import.meta.glob === 'function'
    ? import.meta.glob('../../assets/chapter-03/quaternius/*.glb', {
        eager: true,
        query: '?url',
        import: 'default',
    })
    : {
        '../../assets/chapter-03/quaternius/tree-hero-quaternius-qztx-cc0.glb': new URL(
            '../../assets/chapter-03/quaternius/tree-hero-quaternius-qztx-cc0.glb',
            import.meta.url,
        ).href,
        '../../assets/chapter-03/quaternius/tree-cluster-quaternius-juzo-cc0.glb': new URL(
            '../../assets/chapter-03/quaternius/tree-cluster-quaternius-juzo-cc0.glb',
            import.meta.url,
        ).href,
        '../../assets/chapter-03/quaternius/pine-cluster-quaternius-oytd-cc0.glb': new URL(
            '../../assets/chapter-03/quaternius/pine-cluster-quaternius-oytd-cc0.glb',
            import.meta.url,
        ).href,
        '../../assets/chapter-03/quaternius/pine-quaternius-igsu-cc0.glb': new URL(
            '../../assets/chapter-03/quaternius/pine-quaternius-igsu-cc0.glb',
            import.meta.url,
        ).href,
        '../../assets/chapter-03/quaternius/pine-quaternius-79gm-cc0.glb': new URL(
            '../../assets/chapter-03/quaternius/pine-quaternius-79gm-cc0.glb',
            import.meta.url,
        ).href,
        '../../assets/chapter-03/quaternius/pine-quaternius-699s-cc0.glb': new URL(
            '../../assets/chapter-03/quaternius/pine-quaternius-699s-cc0.glb',
            import.meta.url,
        ).href,
        '../../assets/chapter-03/quaternius/tree-quaternius-t9kb-cc0.glb': new URL(
            '../../assets/chapter-03/quaternius/tree-quaternius-t9kb-cc0.glb',
            import.meta.url,
        ).href,
        '../../assets/chapter-03/quaternius/twisted-tree-quaternius-7pdb-cc0.glb': new URL(
            '../../assets/chapter-03/quaternius/twisted-tree-quaternius-7pdb-cc0.glb',
            import.meta.url,
        ).href,
        '../../assets/chapter-03/quaternius/twisted-tree-quaternius-edsp-cc0.glb': new URL(
            '../../assets/chapter-03/quaternius/twisted-tree-quaternius-edsp-cc0.glb',
            import.meta.url,
        ).href,
        '../../assets/chapter-03/quaternius/twisted-tree-quaternius-9awl-cc0.glb': new URL(
            '../../assets/chapter-03/quaternius/twisted-tree-quaternius-9awl-cc0.glb',
            import.meta.url,
        ).href,
        '../../assets/chapter-03/quaternius/bush-flowers-quaternius-u1ym-cc0.glb': new URL(
            '../../assets/chapter-03/quaternius/bush-flowers-quaternius-u1ym-cc0.glb',
            import.meta.url,
        ).href,
        '../../assets/chapter-03/quaternius/flower-group-quaternius-hfpz-cc0.glb': new URL(
            '../../assets/chapter-03/quaternius/flower-group-quaternius-hfpz-cc0.glb',
            import.meta.url,
        ).href,
        '../../assets/chapter-03/quaternius/fern-quaternius-jqca-cc0.glb': new URL(
            '../../assets/chapter-03/quaternius/fern-quaternius-jqca-cc0.glb',
            import.meta.url,
        ).href,
        '../../assets/chapter-03/quaternius/clover-quaternius-iq9n-cc0.glb': new URL(
            '../../assets/chapter-03/quaternius/clover-quaternius-iq9n-cc0.glb',
            import.meta.url,
        ).href,
        '../../assets/chapter-03/quaternius/rock-medium-quaternius-kzde-cc0.glb': new URL(
            '../../assets/chapter-03/quaternius/rock-medium-quaternius-kzde-cc0.glb',
            import.meta.url,
        ).href,
        '../../assets/chapter-03/quaternius/pebble-round-quaternius-kytj-cc0.glb': new URL(
            '../../assets/chapter-03/quaternius/pebble-round-quaternius-kytj-cc0.glb',
            import.meta.url,
        ).href,
        '../../assets/chapter-03/quaternius/bird-jay-quaternius-gyyc-cc0.glb': new URL(
            '../../assets/chapter-03/quaternius/bird-jay-quaternius-gyyc-cc0.glb',
            import.meta.url,
        ).href,
        '../../assets/chapter-03/quaternius/pigeon-animated-quaternius-9ngl-cc0.glb': new URL(
            '../../assets/chapter-03/quaternius/pigeon-animated-quaternius-9ngl-cc0.glb',
            import.meta.url,
        ).href,
    };

const METADATA_BY_FILE = Object.freeze({
    'tree-hero-quaternius-qztx-cc0.glb': {
        id: 'tree-hero',
        title: 'Tree',
        role: 'hero-tree',
        publicId: 'qZtx0AHhcy',
        resourceId: '24cf9df9-435f-408e-971b-640d670ce973',
        sourceUrl: 'https://poly.pizza/m/qZtx0AHhcy',
        triangleCount: 6265,
        byteSize: 2540428,
        runtimeScale: 3.65,
        artDirection: 'large green deciduous landmark replacing the procedural great tree',
    },
    'tree-cluster-quaternius-juzo-cc0.glb': {
        id: 'tree-cluster',
        title: 'Trees',
        role: 'forest-cluster',
        publicId: 'jUzojhHoYR',
        resourceId: '953dfd22-7041-4a2b-a234-0e1088bb8340',
        sourceUrl: 'https://poly.pizza/m/jUzojhHoYR',
        triangleCount: 4776,
        byteSize: 92392,
        runtimeScale: 18,
        artDirection: 'tiny file, broad mid-distance green tree mass',
    },
    'pine-cluster-quaternius-oytd-cc0.glb': {
        id: 'pine-cluster',
        title: 'Pine Trees',
        role: 'pine-cluster',
        publicId: 'oYtDty0fR6',
        resourceId: '1d499f8b-5a1b-4966-9a35-10c0d3841e91',
        sourceUrl: 'https://poly.pizza/m/oYtDty0fR6',
        triangleCount: 3666,
        byteSize: 99604,
        runtimeScale: 19,
        artDirection: 'darker conifer masses to break up the rounded trees',
    },
    'pine-quaternius-igsu-cc0.glb': {
        id: 'pine-igsu',
        title: 'Pine',
        role: 'pine-tree',
        publicId: 'igSu0cPoBz',
        resourceId: '712aaefa-ae7f-4cb3-8834-a1b8860df3b2',
        sourceUrl: 'https://poly.pizza/m/igSu0cPoBz',
        triangleCount: 1646,
        byteSize: 2147312,
        runtimeScale: 2.7,
        artDirection: 'individual pine silhouette for readable near/midground forest form',
    },
    'pine-quaternius-79gm-cc0.glb': {
        id: 'pine-79gm',
        title: 'Pine',
        role: 'pine-tree',
        publicId: '79gmlLnweB',
        resourceId: '082c2026-56af-4e3f-bea7-9ae5de71101f',
        sourceUrl: 'https://poly.pizza/m/79gmlLnweB',
        triangleCount: 3370,
        byteSize: 2221932,
        runtimeScale: 2.35,
        artDirection: 'taller individual pine for mountain-facing tree line',
    },
    'pine-quaternius-699s-cc0.glb': {
        id: 'pine-699s',
        title: 'Pine',
        role: 'pine-tree',
        publicId: '699sFuLCN2',
        resourceId: 'c55b8641-4679-4a85-8bd8-2a20e79abecd',
        sourceUrl: 'https://poly.pizza/m/699sFuLCN2',
        triangleCount: 4502,
        byteSize: 2261060,
        runtimeScale: 3.2,
        artDirection: 'compact pine variant for close island edge detail',
    },
    'tree-quaternius-t9kb-cc0.glb': {
        id: 'tree-t9kb',
        title: 'Tree',
        role: 'tree',
        publicId: 't9KbsfYdXz',
        resourceId: '7f84a768-ac30-48d4-9c5d-f760492e7867',
        sourceUrl: 'https://poly.pizza/m/t9KbsfYdXz',
        triangleCount: 3182,
        byteSize: 2385268,
        runtimeScale: 3.15,
        artDirection: 'rounded green tree supporting the main hero tree without duplicating it',
    },
    'twisted-tree-quaternius-7pdb-cc0.glb': {
        id: 'twisted-tree',
        title: 'Twisted Tree',
        role: 'accent-tree',
        publicId: '7PDBpElkQr',
        resourceId: '229336e6-4632-4bc7-af2e-ec1f3c8245f7',
        sourceUrl: 'https://poly.pizza/m/7PDBpElkQr',
        triangleCount: 9600,
        byteSize: 3075984,
        runtimeScale: 1.25,
        artDirection: 'rare sculptural silhouette, kept off the main green read',
    },
    'twisted-tree-quaternius-edsp-cc0.glb': {
        id: 'twisted-edsp',
        title: 'Twisted Tree',
        role: 'accent-tree',
        publicId: 'edSPJNECM7',
        resourceId: '7ca42e52-d57b-45c6-89c6-0216dda8b97e',
        sourceUrl: 'https://poly.pizza/m/edSPJNECM7',
        triangleCount: 10104,
        byteSize: 3119328,
        runtimeScale: 1.35,
        artDirection: 'red sculptural tree silhouette used sparingly as a left-side accent',
    },
    'twisted-tree-quaternius-9awl-cc0.glb': {
        id: 'twisted-9awl',
        title: 'Twisted Tree',
        role: 'accent-tree',
        publicId: '9aWlx82xUf',
        resourceId: 'c6b8d04d-8ca3-4898-a180-e2ca2b936863',
        sourceUrl: 'https://poly.pizza/m/9aWlx82xUf',
        triangleCount: 9564,
        byteSize: 3048260,
        runtimeScale: 1.18,
        artDirection: 'second twisted-tree variant for asymmetric island composition',
    },
    'bush-flowers-quaternius-u1ym-cc0.glb': {
        id: 'bush-flowers',
        title: 'Bush with Flowers',
        role: 'ground-detail',
        publicId: 'U1ymDy8tbY',
        resourceId: 'af83abca-9b41-4229-9652-e336a5f5eaba',
        sourceUrl: 'https://poly.pizza/m/U1ymDy8tbY',
        triangleCount: 1368,
        byteSize: 809728,
        runtimeScale: 5.4,
        artDirection: 'foreground Zelda-like flower bush color accents',
    },
    'flower-group-quaternius-hfpz-cc0.glb': {
        id: 'flower-group',
        title: 'Flower Group',
        role: 'ground-detail',
        publicId: 'hfPzQAedOe',
        resourceId: '89f163b2-af28-4dd7-bd09-ed7b80fde2b7',
        sourceUrl: 'https://poly.pizza/m/hfPzQAedOe',
        triangleCount: 755,
        byteSize: 1242384,
        runtimeScale: 3.3,
        artDirection: 'small flower rhythm along the path and shore',
    },
    'fern-quaternius-jqca-cc0.glb': {
        id: 'fern',
        title: 'Fern',
        role: 'ground-detail',
        publicId: 'jqcanvH7D6',
        resourceId: 'f94d836f-4eb4-4db0-aa53-3ecdddffa527',
        sourceUrl: 'https://poly.pizza/m/jqcanvH7D6',
        triangleCount: 288,
        byteSize: 692724,
        runtimeScale: 1.2,
        artDirection: 'wide low ferns for near-ground silhouette and richer greens',
    },
    'clover-quaternius-iq9n-cc0.glb': {
        id: 'clover',
        title: 'Clover',
        role: 'ground-detail',
        publicId: 'IQ9NVyVpUw',
        resourceId: 'b03d60f5-bcfa-487b-9064-65f3b0f8ad6b',
        sourceUrl: 'https://poly.pizza/m/IQ9NVyVpUw',
        triangleCount: 379,
        byteSize: 694432,
        runtimeScale: 3.4,
        artDirection: 'small saturated ground detail near camera',
    },
    'rock-medium-quaternius-kzde-cc0.glb': {
        id: 'rock-medium',
        title: 'Rock Medium',
        role: 'shore-rock',
        publicId: 'KZdEP3uUpa',
        resourceId: 'aaf0aaa7-c244-430a-908b-2ac57567d81c',
        sourceUrl: 'https://poly.pizza/m/KZdEP3uUpa',
        triangleCount: 244,
        byteSize: 1060940,
        runtimeScale: 3.1,
        artDirection: 'shoreline and hill-foot rocks to connect islands to mountains',
    },
    'pebble-round-quaternius-kytj-cc0.glb': {
        id: 'pebble-round',
        title: 'Pebble Round',
        role: 'shore-rock',
        publicId: 'KYtJ6JNXh2',
        resourceId: '9ab92cc2-6cae-485b-bc34-8f99d6ba12fc',
        sourceUrl: 'https://poly.pizza/m/KYtJ6JNXh2',
        triangleCount: 114,
        byteSize: 813788,
        runtimeScale: 10,
        artDirection: 'small rounded stones for wet shoreline scale cues',
    },
    'bird-jay-quaternius-gyyc-cc0.glb': {
        id: 'bird-jay',
        title: 'Bird',
        role: 'bird',
        publicId: 'gYYC0gYMnw',
        resourceId: 'bc6de37a-fdc5-4ef2-85c6-4a2e7b5db9d5',
        sourceUrl: 'https://poly.pizza/m/gYYC0gYMnw',
        triangleCount: 1204,
        byteSize: 48544,
        runtimeScale: 5.8,
        artDirection: 'static distant bird model replacing flat V silhouettes',
    },
    'pigeon-animated-quaternius-9ngl-cc0.glb': {
        id: 'pigeon-animated',
        title: 'Pigeon',
        role: 'animated-bird',
        publicId: '9NGlBTpDEr',
        resourceId: '2ad33f9e-e0d5-4a11-821b-7aafe8d13dd3',
        sourceUrl: 'https://poly.pizza/m/9NGlBTpDEr',
        triangleCount: 2024,
        byteSize: 110548,
        runtimeScale: 3.5,
        animationClips: 9,
        artDirection: 'animated near crossing birds with real wing/body volume',
    },
});

function fileNameFromKey(key) {
    return key.split('/').pop();
}

function makeAssetRecord(key) {
    const fileName = fileNameFromKey(key);
    const metadata = METADATA_BY_FILE[fileName] || {};
    return {
        ...CH3_QUATERNIUS_ASSET_CONTRACT,
        ...metadata,
        fileName,
        id: metadata.id || fileName.replace(/\.glb$/i, ''),
        url: ASSET_MODULES[key],
        assetVersion: CH3_QUATERNIUS_ASSET_VERSION,
        license: CH3_QUATERNIUS_ASSET_CONTRACT.license,
        licenseCode: CH3_QUATERNIUS_ASSET_CONTRACT.licenseCode,
        author: CH3_QUATERNIUS_ASSET_CONTRACT.author,
        attributionRequired: false,
        commercialUse: true,
    };
}

export function getChapter3QuaterniusAssetRecords(filter = {}) {
    const records = Object.keys(ASSET_MODULES)
        .sort()
        .map(makeAssetRecord);

    if (!filter.role) return records;
    return records.filter((record) => record.role === filter.role);
}

export function getChapter3QuaterniusAssetById(id) {
    return getChapter3QuaterniusAssetRecords().find((record) => record.id === id) || null;
}

export function hasChapter3QuaterniusAssets() {
    return Object.keys(ASSET_MODULES).length > 0;
}

export function summarizeChapter3QuaterniusAssets() {
    return {
        version: CH3_QUATERNIUS_ASSET_VERSION,
        contract: CH3_QUATERNIUS_ASSET_CONTRACT,
        assets: getChapter3QuaterniusAssetRecords().map(({ url, ...record }) => record),
    };
}

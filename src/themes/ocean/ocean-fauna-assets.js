export const OCEAN_FAUNA_ASSET_VERSION = 'v7-triposr-seahorse';

export const OCEAN_FAUNA_GENERATION_CONTRACT = {
    sourcePolicy: 'generate-first',
    coordinateForward: '+X',
    yUp: true,
    origin: 'body-center',
    allowedLicenses: ['self-generated', 'CC0', 'CC-BY'],
    freeAssetFallbackPolicy: 'CC0-preferred-CC-BY-with-attribution',
    noProprietaryArtwork: true,
    noAbzuLogoTextOrCopiedScenes: true,
    generator: 'tools/assetgen/generate_ocean_fauna_premium.py',
    blenderMcpSketchfabStatus: 'attempted-but-disabled-no-api-key',
};

const FAUNA_URLS = {
    'rare-shark-v2.glb': new URL('./assets/fauna/rare-shark-v2.glb', import.meta.url).href,
    'rare-turtle-v2.glb': new URL('./assets/fauna/rare-turtle-v2.glb', import.meta.url).href,
    'hero-reef-fish.glb': new URL('./assets/fauna/hero-reef-fish.glb', import.meta.url).href,
    'hero-bannerfish.glb': new URL('./assets/fauna/hero-bannerfish.glb', import.meta.url).href,
    'hero-angelfish.glb': new URL('./assets/fauna/hero-angelfish.glb', import.meta.url).href,
    'hero-mandarinfish.glb': new URL('./assets/fauna/hero-mandarinfish.glb', import.meta.url).href,
    'rare-shark.glb': new URL('./assets/fauna/rare-shark.glb', import.meta.url).href,
    'rare-turtle.glb': new URL('./assets/fauna/rare-turtle.glb', import.meta.url).href,
    'rare-blue-whale-v1.glb': new URL('./assets/fauna/rare-blue-whale-v1.glb', import.meta.url).href,
    // Quaternius Animated Fish Bundle (CC0, Poly Pizza)
    // https://poly.pizza/bundle/Animated-Fish-Bundle-ZkGbjS8m8g
    'rare-shark-quaternius.glb': new URL('./assets/fauna/rare-shark-quaternius.glb', import.meta.url).href,
    'rare-whale-quaternius.glb': new URL('./assets/fauna/rare-whale-quaternius.glb', import.meta.url).href,
    'rare-mantaray-quaternius.glb': new URL('./assets/fauna/rare-mantaray-quaternius.glb', import.meta.url).href,
    'rare-dolphin-quaternius.glb': new URL('./assets/fauna/rare-dolphin-quaternius.glb', import.meta.url).href,
    'hero-fish-quaternius-a.glb': new URL('./assets/fauna/hero-fish-quaternius-a.glb', import.meta.url).href,
    'hero-fish-quaternius-b.glb': new URL('./assets/fauna/hero-fish-quaternius-b.glb', import.meta.url).href,
    'hero-fish-quaternius-c.glb': new URL('./assets/fauna/hero-fish-quaternius-c.glb', import.meta.url).href,
    // kenchoo Sea Turtle Lowpoly Animated (CC-BY 4.0, Sketchfab)
    // https://sketchfab.com/3d-models/sea-turtle-lowpoly-animated-ea29d144296245c4bab3484575f2ffca
    'rare-turtle-kenchoo.glb': new URL('./assets/fauna/rare-turtle-kenchoo.glb', import.meta.url).href,
    // Self-generated TripoSR reef-dweller seahorse
    'reef-seahorse-triposr.glb': new URL('./assets/fauna/reef-seahorse-triposr.glb', import.meta.url).href,
    // UniRig auto-rigged variant of the TripoSR seahorse (bones driven procedurally in JS)
    'reef-seahorse-triposr-rigged.glb': new URL('./assets/fauna/reef-seahorse-triposr-rigged.glb', import.meta.url).href,
};

function faunaUrl(fileName) {
    return FAUNA_URLS[fileName];
}

function makeAssetRecord({
    id,
    kind,
    fileName,
    modelVersion,
    sourceMode = 'self-generated',
    license = 'MIT-project-local',
    author = 'Serenity Blocks procedural asset generator',
    sourceUrl = OCEAN_FAUNA_GENERATION_CONTRACT.generator,
    triangleCount,
    triangleBudget,
    byteSize,
    maxBytes,
    textureCount = 0,
    textureBudget = 0,
    animationNames,
    runtimeScale = 1,
    fallback = false,
    // Model's local forward axis as authored in the GLB. The runtime aligns
    // this axis to world +X (the FORWARD constant) at clone time. Override
    // per asset; common Blender → glTF exports come out as '-Z'.
    forwardAxis = '+X',
    // Linear speed (units/sec) at which the embedded swim clip looks natural.
    // The mixer playback rate scales as currentLinearSpeed / referenceSpeed.
    referenceSpeed = null,
}) {
    return {
        id,
        kind,
        fileName,
        url: faunaUrl(fileName),
        modelVersion,
        sourceMode,
        license,
        author,
        sourceUrl,
        triangleCount,
        triangleBudget,
        byteSize,
        maxBytes,
        textureCount,
        textureBudget,
        animationNames,
        runtimeScale,
        fallback,
        forwardAxis,
        referenceSpeed,
        coordinateForward: OCEAN_FAUNA_GENERATION_CONTRACT.coordinateForward,
        yUp: OCEAN_FAUNA_GENERATION_CONTRACT.yUp,
    };
}

export const OCEAN_RARE_FAUNA_ASSETS = {
    shark: {
        primary: makeAssetRecord({
            id: 'rare-shark-quaternius',
            kind: 'shark',
            fileName: 'rare-shark-quaternius.glb',
            modelVersion: 'quaternius-animated-fish-bundle',
            sourceMode: 'third-party-cc0',
            license: 'CC0',
            author: 'Quaternius',
            sourceUrl: 'https://poly.pizza/bundle/Animated-Fish-Bundle-ZkGbjS8m8g',
            triangleBudget: { min: 500, max: 8000 },
            maxBytes: 1024 * 1024,
            // Quaternius models ship with a single swim animation clip.
            // The runtime falls back to whatever the first available clip is
            // when the legacy phase-specific clip names aren't present.
            animationNames: ['Swim'],
            runtimeScale: 1,
            forwardAxis: '+Z',
            referenceSpeed: 14,
        }),
        fallback: makeAssetRecord({
            id: 'rare-shark-v2',
            kind: 'shark',
            fileName: 'rare-shark-v2.glb',
            modelVersion: 'v5-cinematic-phase-clips',
            sourceMode: 'blender-mcp-project-authored',
            author: 'Serenity Blocks Blender MCP asset pipeline',
            sourceUrl: 'tools/assetgen/generate_ocean_fauna_premium.py',
            triangleCount: 12624,
            triangleBudget: { min: 8000, max: 16000 },
            byteSize: 1029496,
            maxBytes: 1536 * 1024,
            textureCount: 3,
            textureBudget: 4,
            animationNames: [
                'shark_cruise_loop',
                'shark_stalk_loop',
                'shark_charge_loop',
                'shark_strike_lunge',
                'shark_disengage_loop',
            ],
            runtimeScale: 1,
            fallback: true,
        }),
    },
    turtle: {
        primary: makeAssetRecord({
            id: 'rare-turtle-kenchoo',
            kind: 'turtle',
            fileName: 'rare-turtle-kenchoo.glb',
            modelVersion: 'kenchoo-sea-turtle-lowpoly-animated',
            sourceMode: 'third-party-cc-by',
            license: 'CC-BY-4.0',
            author: 'kenchoo (based on C.J. Goldman)',
            sourceUrl: 'https://sketchfab.com/3d-models/sea-turtle-lowpoly-animated-ea29d144296245c4bab3484575f2ffca',
            triangleCount: 16200,
            triangleBudget: { min: 8000, max: 20000 },
            maxBytes: 2048 * 1024,
            animationNames: ['Swim'],
            runtimeScale: 1,
            forwardAxis: '+Z',
            referenceSpeed: 4,
        }),
        fallback: makeAssetRecord({
            id: 'rare-turtle-v2',
            kind: 'turtle',
            fileName: 'rare-turtle-v2.glb',
            modelVersion: 'v2',
            triangleCount: 12800,
            triangleBudget: { min: 8000, max: 16000 },
            byteSize: 960724,
            maxBytes: 1536 * 1024,
            textureCount: 3,
            textureBudget: 4,
            animationNames: ['turtle_flipper_glide_loop'],
            runtimeScale: 1,
            fallback: true,
        }),
    },
    whale: {
        primary: makeAssetRecord({
            id: 'rare-whale-quaternius',
            kind: 'whale',
            fileName: 'rare-whale-quaternius.glb',
            modelVersion: 'quaternius-animated-fish-bundle',
            sourceMode: 'third-party-cc0',
            license: 'CC0',
            author: 'Quaternius',
            sourceUrl: 'https://poly.pizza/bundle/Animated-Fish-Bundle-ZkGbjS8m8g',
            triangleBudget: { min: 500, max: 10000 },
            maxBytes: 1536 * 1024,
            animationNames: ['Swim'],
            runtimeScale: 1,
            forwardAxis: '+Z',
            referenceSpeed: 6,
        }),
        fallback: makeAssetRecord({
            id: 'rare-blue-whale-v1',
            kind: 'whale',
            fileName: 'rare-blue-whale-v1.glb',
            modelVersion: 'v1-orphaned',
            sourceMode: 'local-legacy-generated',
            sourceUrl: 'src/themes/ocean/assets/fauna/rare-blue-whale-v1.glb',
            triangleBudget: { min: 500, max: 12000 },
            maxBytes: 2048 * 1024,
            animationNames: ['Swim'],
            runtimeScale: 1,
            fallback: true,
        }),
    },
    mantaRay: {
        primary: makeAssetRecord({
            id: 'rare-mantaray-quaternius',
            kind: 'mantaRay',
            fileName: 'rare-mantaray-quaternius.glb',
            modelVersion: 'quaternius-animated-fish-bundle',
            sourceMode: 'third-party-cc0',
            license: 'CC0',
            author: 'Quaternius',
            sourceUrl: 'https://poly.pizza/bundle/Animated-Fish-Bundle-ZkGbjS8m8g',
            triangleBudget: { min: 500, max: 8000 },
            maxBytes: 1024 * 1024,
            animationNames: ['Swim'],
            runtimeScale: 1,
            forwardAxis: '+Z',
            referenceSpeed: 5,
        }),
    },
    dolphin: {
        primary: makeAssetRecord({
            id: 'rare-dolphin-quaternius',
            kind: 'dolphin',
            fileName: 'rare-dolphin-quaternius.glb',
            modelVersion: 'quaternius-animated-fish-bundle',
            sourceMode: 'third-party-cc0',
            license: 'CC0',
            author: 'Quaternius',
            sourceUrl: 'https://poly.pizza/bundle/Animated-Fish-Bundle-ZkGbjS8m8g',
            triangleBudget: { min: 500, max: 8000 },
            maxBytes: 1024 * 1024,
            animationNames: ['Swim'],
            runtimeScale: 1,
            forwardAxis: '+Z',
            referenceSpeed: 10,
        }),
    },
};

export const OCEAN_HERO_FISH_ASSETS = [
    makeAssetRecord({
        id: 'hero-reef-fish',
        kind: 'hero-fish',
        fileName: 'hero-reef-fish.glb',
        modelVersion: 'v4',
        triangleCount: 4488,
        triangleBudget: { min: 2000, max: 6000 },
        byteSize: 354888,
        maxBytes: 700 * 1024,
        textureCount: 2,
        textureBudget: 4,
        animationNames: ['hero-reef-fish_tail_body_swim_loop'],
        runtimeScale: 4.7,
    }),
    makeAssetRecord({
        id: 'hero-bannerfish',
        kind: 'hero-fish',
        fileName: 'hero-bannerfish.glb',
        modelVersion: 'v4',
        triangleCount: 4488,
        triangleBudget: { min: 2000, max: 6000 },
        byteSize: 316524,
        maxBytes: 700 * 1024,
        textureCount: 2,
        textureBudget: 4,
        animationNames: ['hero-bannerfish_tail_body_swim_loop'],
        runtimeScale: 4.35,
    }),
    makeAssetRecord({
        id: 'hero-angelfish',
        kind: 'hero-fish',
        fileName: 'hero-angelfish.glb',
        modelVersion: 'v1-blender-aaa',
        sourceMode: 'blender-only-project-authored',
        author: 'Serenity Blocks Blender asset pipeline',
        sourceUrl: 'tools/assetgen/generate_ocean_aaa_hero_assets.py',
        triangleCount: 4488,
        triangleBudget: { min: 2000, max: 6000 },
        byteSize: 326680,
        maxBytes: 700 * 1024,
        textureCount: 2,
        textureBudget: 4,
        animationNames: ['hero-angelfish_tail_body_swim_loop'],
        runtimeScale: 4.25,
    }),
    makeAssetRecord({
        id: 'hero-mandarinfish',
        kind: 'hero-fish',
        fileName: 'hero-mandarinfish.glb',
        modelVersion: 'v1-blender-aaa',
        sourceMode: 'blender-only-project-authored',
        author: 'Serenity Blocks Blender asset pipeline',
        sourceUrl: 'tools/assetgen/generate_ocean_aaa_hero_assets.py',
        triangleCount: 4488,
        triangleBudget: { min: 2000, max: 6000 },
        byteSize: 351368,
        maxBytes: 700 * 1024,
        textureCount: 2,
        textureBudget: 4,
        animationNames: ['hero-mandarinfish_tail_body_swim_loop'],
        runtimeScale: 4.1,
    }),
    // Quaternius Animated Fish Bundle (CC0) — 3 fish variants added as
    // supplemental hero schools alongside the project-authored ones above.
    makeAssetRecord({
        id: 'hero-fish-quaternius-a',
        kind: 'hero-fish',
        fileName: 'hero-fish-quaternius-a.glb',
        modelVersion: 'quaternius-animated-fish-bundle',
        sourceMode: 'third-party-cc0',
        license: 'CC0',
        author: 'Quaternius',
        sourceUrl: 'https://poly.pizza/bundle/Animated-Fish-Bundle-ZkGbjS8m8g',
        triangleBudget: { min: 500, max: 6000 },
        maxBytes: 700 * 1024,
        animationNames: ['Swim'],
        forwardAxis: '+Z',
        referenceSpeed: 10,
        runtimeScale: 4.4,
    }),
    makeAssetRecord({
        id: 'hero-fish-quaternius-b',
        kind: 'hero-fish',
        fileName: 'hero-fish-quaternius-b.glb',
        modelVersion: 'quaternius-animated-fish-bundle',
        sourceMode: 'third-party-cc0',
        license: 'CC0',
        author: 'Quaternius',
        sourceUrl: 'https://poly.pizza/bundle/Animated-Fish-Bundle-ZkGbjS8m8g',
        triangleBudget: { min: 500, max: 6000 },
        maxBytes: 700 * 1024,
        animationNames: ['Swim'],
        forwardAxis: '+Z',
        referenceSpeed: 10,
        runtimeScale: 4.2,
    }),
    makeAssetRecord({
        id: 'hero-fish-quaternius-c',
        kind: 'hero-fish',
        fileName: 'hero-fish-quaternius-c.glb',
        modelVersion: 'quaternius-animated-fish-bundle',
        sourceMode: 'third-party-cc0',
        license: 'CC0',
        author: 'Quaternius',
        sourceUrl: 'https://poly.pizza/bundle/Animated-Fish-Bundle-ZkGbjS8m8g',
        triangleBudget: { min: 500, max: 6000 },
        maxBytes: 700 * 1024,
        animationNames: ['Swim'],
        forwardAxis: '+Z',
        referenceSpeed: 10,
        runtimeScale: 4.6,
    }),
];

// ── Reef-Dweller GLB Assets (TripoSR-generated) ────────────────────────────
export const OCEAN_REEF_SEAHORSE_ASSET = makeAssetRecord({
    id: 'reef-seahorse-triposr',
    kind: 'reef-dweller',
    fileName: 'reef-seahorse-triposr.glb',
    modelVersion: 'v1-triposr-mc96',
    sourceMode: 'self-generated-triposr',
    license: 'MIT-project-local',
    author: 'Serenity Blocks TripoSR asset pipeline',
    sourceUrl: 'artifacts/triposr/seahorse-source.png',
    triangleBudget: { min: 2000, max: 12000 },
    maxBytes: 1024 * 1024,
    animationNames: [],
    runtimeScale: 2.8,
    forwardAxis: '+X',
});

// UniRig-rigged variant of the TripoSR seahorse. Same mesh, plus an
// auto-generated skeleton + skinning weights. animationNames stays empty —
// bones are driven procedurally in updateSeahorses() (sin-wave spine sway).
// The reef-dweller system falls back to the unrigged asset above if this
// file is missing, so committing the rigged GLB is optional.
export const OCEAN_REEF_SEAHORSE_RIGGED_ASSET = makeAssetRecord({
    id: 'reef-seahorse-triposr-rigged',
    kind: 'reef-dweller',
    fileName: 'reef-seahorse-triposr-rigged.glb',
    modelVersion: 'v1-triposr-mc96-unirig',
    sourceMode: 'self-generated-triposr-unirig',
    license: 'MIT-project-local',
    author: 'Serenity Blocks TripoSR + UniRig pipeline',
    sourceUrl: 'artifacts/triposr/seahorse-source.png',
    triangleBudget: { min: 2000, max: 12000 },
    // UniRig's merge step bakes the original mesh + 17-bone skeleton + per-vertex
    // skinning weights into the GLB; expected size is ~2 MB.
    maxBytes: 2.5 * 1024 * 1024,
    animationNames: [],
    runtimeScale: 2.8,
    forwardAxis: '+X',
});

function publicAssetRecord(asset) {
    const {
        url,
        ...publicRecord
    } = asset;
    return { ...publicRecord };
}

export function getRareFaunaAssetCandidates(kind) {
    const entry = OCEAN_RARE_FAUNA_ASSETS[kind];
    if (!entry) return [];
    return [entry.primary, entry.fallback].filter(Boolean);
}

export function summarizeFaunaAssetManifest() {
    return {
        version: OCEAN_FAUNA_ASSET_VERSION,
        contract: { ...OCEAN_FAUNA_GENERATION_CONTRACT },
        rareFauna: Object.fromEntries(
            Object.entries(OCEAN_RARE_FAUNA_ASSETS).map(([kind, entry]) => [
                kind,
                {
                    primary: publicAssetRecord(entry.primary),
                    fallback: entry.fallback ? publicAssetRecord(entry.fallback) : null,
                },
            ]),
        ),
        heroFish: OCEAN_HERO_FISH_ASSETS.map(publicAssetRecord),
        reefDwellers: {
            seahorse: publicAssetRecord(OCEAN_REEF_SEAHORSE_ASSET),
        },
    };
}

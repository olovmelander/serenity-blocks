/**
 * Stillwater's single six-tier quality contract.
 *
 * Every visual builder consumes this table. Disabled features are represented by
 * structural values (zero layers / false bloom / zero reflector scale) so callers
 * can omit their shader graph or draw entirely instead of multiplying live work by
 * a zero uniform.
 */

export const STILLWATER_QUALITY_ORDER = Object.freeze([
    'Minimal',
    'Low',
    'Medium',
    'High',
    'Ultra',
    'Extreme',
]);

const PROFILES = {
    Minimal: {
        maxPixelRatio: 1,
        reflectionScale: 0,
        bloom: false,
        bloomScale: 0,
        lutSize: 0,
        mistLayers: 0,
        ambientMotes: 40,
        forestTrees: 12,
        canopyClusters: 8,
        mushroomClusters: 2,
        trollLod: 'low',
        wakeSlots: 0,
        transientShaftSlots: 0,
        waterRings: 8,
        noiseOctaves: 1,
        detailFlow: false,
        secondCaustic: false,
    },
    Low: {
        maxPixelRatio: 1.1,
        reflectionScale: 0,
        bloom: false,
        bloomScale: 0,
        lutSize: 0,
        mistLayers: 0,
        ambientMotes: 90,
        forestTrees: 18,
        canopyClusters: 12,
        mushroomClusters: 3,
        trollLod: 'low',
        wakeSlots: 4,
        transientShaftSlots: 1,
        waterRings: 12,
        noiseOctaves: 2,
        detailFlow: false,
        secondCaustic: false,
    },
    Medium: {
        maxPixelRatio: 1.25,
        reflectionScale: 0,
        bloom: false,
        bloomScale: 0,
        lutSize: 0,
        mistLayers: 1,
        ambientMotes: 180,
        forestTrees: 24,
        canopyClusters: 16,
        mushroomClusters: 3,
        trollLod: 'medium',
        wakeSlots: 4,
        transientShaftSlots: 2,
        waterRings: 16,
        noiseOctaves: 2,
        detailFlow: false,
        secondCaustic: false,
    },
    High: {
        maxPixelRatio: 1.5,
        reflectionScale: 0.30,
        bloom: true,
        bloomScale: 0.45,
        lutSize: 16,
        mistLayers: 1,
        ambientMotes: 280,
        forestTrees: 30,
        canopyClusters: 20,
        mushroomClusters: 4,
        trollLod: 'high',
        wakeSlots: 10,
        transientShaftSlots: 3,
        waterRings: 22,
        noiseOctaves: 2,
        detailFlow: false,
        secondCaustic: false,
    },
    Ultra: {
        maxPixelRatio: 1.65,
        reflectionScale: 0.48,
        bloom: true,
        bloomScale: 0.69,
        lutSize: 16,
        mistLayers: 2,
        ambientMotes: 540,
        forestTrees: 36,
        canopyClusters: 24,
        mushroomClusters: 4,
        trollLod: 'ultra',
        wakeSlots: 12,
        transientShaftSlots: 4,
        waterRings: 28,
        noiseOctaves: 3,
        detailFlow: true,
        secondCaustic: true,
    },
    Extreme: {
        maxPixelRatio: 1.8,
        reflectionScale: 0.5,
        bloom: true,
        bloomScale: 0.72,
        lutSize: 16,
        mistLayers: 2,
        ambientMotes: 700,
        forestTrees: 42,
        canopyClusters: 28,
        mushroomClusters: 4,
        trollLod: 'ultra',
        wakeSlots: 12,
        transientShaftSlots: 4,
        waterRings: 32,
        noiseOctaves: 4,
        detailFlow: true,
        secondCaustic: true,
    },
};

export const STILLWATER_QUALITY_PROFILES = Object.freeze(
    Object.fromEntries(
        Object.entries(PROFILES).map(([name, profile]) => [
            name,
            Object.freeze({ name, ...profile }),
        ]),
    ),
);

export function normalizeStillwaterQuality(value, fallback = 'High') {
    const requested = String(value || '').trim().toLowerCase();
    const match = STILLWATER_QUALITY_ORDER.find(
        (name) => name.toLowerCase() === requested,
    );
    return match || normalizeStillwaterQualityFallback(fallback);
}

function normalizeStillwaterQualityFallback(value) {
    const requested = String(value || 'High').trim().toLowerCase();
    return STILLWATER_QUALITY_ORDER.find(
        (name) => name.toLowerCase() === requested,
    ) || 'High';
}

export function getStillwaterQualityProfile(value, fallback = 'High') {
    return STILLWATER_QUALITY_PROFILES[
        normalizeStillwaterQuality(value, fallback)
    ];
}

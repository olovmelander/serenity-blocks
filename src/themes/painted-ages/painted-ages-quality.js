/** Painted Ages — content budgets. Every tier keeps the geology and every event. */
const makeTier = (
    terrainVertices,
    bakeSize,
    nearHorizonSize,
    horizonAzimuths,
    detailOctaves,
    lenticularPlates,
    curtainSheets,
    curtainStreaks,
    airPool,
    steamSheets,
    floodChannels,
    floodSegments,
    meltwaterChannels,
    meltwaterSegments,
    waterfalls,
    shrubs,
    pixelRatioCap,
) => Object.freeze({
    terrainVertices,
    bakeSize,
    nearHorizonSize,
    horizonAzimuths,
    detailOctaves,
    bounce: detailOctaves >= 2,
    grain: lenticularPlates >= 5,
    microRills: lenticularPlates >= 6,
    lenticularPlates,
    curtainSheets,
    curtainStreaks,
    airPool,
    steamSheets,
    floodChannels,
    floodSegments,
    meltwaterChannels,
    meltwaterSegments,
    waterfalls,
    puddleReflection: detailOctaves >= 2,
    rainDimples: lenticularPlates >= 5,
    supernumeraries: lenticularPlates >= 5,
    shrubs,
    pixelRatioCap,
});

export const QUALITY = Object.freeze({
    Minimal: makeTier(18000, 256, 0, 1, 0, 2, 3, 120, 48, 2, 6, 24, 3, 24, 1, 0, 0.7),
    Low: makeTier(32000, 384, 0, 2, 1, 3, 3, 300, 96, 3, 8, 32, 4, 32, 2, 200, 0.85),
    Medium: makeTier(64000, 512, 256, 3, 2, 4, 4, 700, 160, 4, 10, 48, 6, 48, 2, 400, 1),
    High: makeTier(110000, 768, 512, 3, 2, 5, 5, 1400, 256, 6, 12, 64, 8, 64, 3, 800, 1.15),
    Ultra: makeTier(170000, 1024, 512, 4, 3, 6, 6, 2200, 384, 8, 12, 96, 8, 96, 4, 1200, 1.35),
    Extreme: makeTier(240000, 1024, 512, 4, 3, 7, 6, 3000, 512, 10, 14, 128, 10, 128, 4, 1600, 1.6),
});

export const QUALITY_NAMES = Object.freeze(Object.keys(QUALITY));

export function tierFor(quality) {
    return QUALITY[quality] || QUALITY.High;
}

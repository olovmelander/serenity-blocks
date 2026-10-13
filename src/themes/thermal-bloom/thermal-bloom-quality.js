/**
 * Thermal Bloom — content tiers (docs/theme-concepts/iris-springs.md §5.8). Every tier keeps the
 * whole picture and every event (the bow, the devils, the Consort, the Sleeper, the rosettes and
 * the stone record included): a tier cuts counts and detail terms (dropped in JavaScript, never
 * multiplied by zero or replaced by a constant), never a beat. Bloom and anti-aliasing are the
 * post stack's (POST_LOOK in thermal-bloom-post.js).
 *
 * fan             the basin's polar fan mesh: [rings, spokes]
 * stairBake       the Stair's layout texture (texels a side); `stairTiers` its terraces
 * plumes          steam plumes, each `sheets` volume slices; `steamCap` the screen-coverage cap
 * shadowEllipses  plume shadows the basin's light loop reads
 * mistSheets      ground-mist sheets over the warm apron
 * spray           spray and rain particles (one instanced pool)
 * columnMesh      the eruption columns' and spray veils' lathe grid [θ, h]
 * bloomSlots      lock-bloom slots (one pool for both sides)
 * recordSamples   arc-length samples a row of the stone record holds (16 rows)
 * rosettes        T-spin rosette slots
 * pines           ghost pines
 * motes           drifting droplets / diamond dust in the near air (one instanced pool)
 * devilMesh       the steam devils' lathe grid [θ, h]
 * matOctaves      octaves of the mats' micro-texture
 * steamDetail     the steam's second (detail) noise tap
 * shimmer         heat shimmer over the Iris and the Chalice's vent (post)
 * anticrepuscular the plume shadows' lanes in the ground mist
 */
export const QUALITY = Object.freeze({
    Minimal: Object.freeze({
        fan: Object.freeze([48, 64]),
        stairBake: 256,
        stairTiers: 8,
        plumes: 4,
        sheets: 2,
        steamCap: 0.8,
        shadowEllipses: 4,
        mistSheets: 0,
        spray: 400,
        columnMesh: Object.freeze([12, 8]),
        bloomSlots: 8,
        recordSamples: 128,
        rosettes: 3,
        pines: 24,
        motes: 80,
        devilMesh: Object.freeze([12, 8]),
        matOctaves: 1,
        steamDetail: false,
        shimmer: false,
        anticrepuscular: false,
    }),
    Low: Object.freeze({
        fan: Object.freeze([64, 96]),
        stairBake: 256,
        stairTiers: 8,
        plumes: 6,
        sheets: 2,
        steamCap: 1.0,
        shadowEllipses: 6,
        mistSheets: 1,
        spray: 700,
        columnMesh: Object.freeze([16, 10]),
        bloomSlots: 12,
        recordSamples: 256,
        rosettes: 4,
        pines: 40,
        motes: 140,
        devilMesh: Object.freeze([16, 10]),
        matOctaves: 1,
        steamDetail: false,
        shimmer: false,
        anticrepuscular: false,
    }),
    Medium: Object.freeze({
        fan: Object.freeze([96, 144]),
        stairBake: 384,
        stairTiers: 10,
        plumes: 8,
        sheets: 3,
        steamCap: 1.3,
        shadowEllipses: 8,
        mistSheets: 2,
        spray: 1400,
        columnMesh: Object.freeze([20, 12]),
        bloomSlots: 16,
        recordSamples: 256,
        rosettes: 6,
        pines: 72,
        motes: 260,
        devilMesh: Object.freeze([20, 12]),
        matOctaves: 2,
        steamDetail: true,
        shimmer: true,
        anticrepuscular: false,
    }),
    High: Object.freeze({
        fan: Object.freeze([128, 192]),
        stairBake: 512,
        stairTiers: 10,
        plumes: 10,
        sheets: 4,
        steamCap: 1.6,
        shadowEllipses: 10,
        mistSheets: 3,
        spray: 2400,
        columnMesh: Object.freeze([24, 16]),
        bloomSlots: 24,
        recordSamples: 256,
        rosettes: 6,
        pines: 110,
        motes: 420,
        devilMesh: Object.freeze([24, 16]),
        matOctaves: 2,
        steamDetail: true,
        shimmer: true,
        anticrepuscular: false,
    }),
    Ultra: Object.freeze({
        fan: Object.freeze([160, 256]),
        stairBake: 512,
        stairTiers: 10,
        plumes: 12,
        sheets: 5,
        steamCap: 1.6,
        shadowEllipses: 12,
        mistSheets: 4,
        spray: 3600,
        columnMesh: Object.freeze([28, 18]),
        bloomSlots: 24,
        recordSamples: 256,
        rosettes: 6,
        pines: 150,
        motes: 600,
        devilMesh: Object.freeze([28, 18]),
        matOctaves: 3,
        steamDetail: true,
        shimmer: true,
        anticrepuscular: true,
    }),
    Extreme: Object.freeze({
        fan: Object.freeze([200, 320]),
        stairBake: 768,
        stairTiers: 10,
        plumes: 14,
        sheets: 6,
        steamCap: 1.8,
        shadowEllipses: 14,
        mistSheets: 4,
        spray: 5000,
        columnMesh: Object.freeze([32, 20]),
        bloomSlots: 24,
        recordSamples: 256,
        rosettes: 6,
        pines: 200,
        motes: 800,
        devilMesh: Object.freeze([32, 20]),
        matOctaves: 3,
        steamDetail: true,
        shimmer: true,
        anticrepuscular: true,
    }),
});

export const QUALITY_NAMES = Object.freeze(Object.keys(QUALITY));

/** The tier for a quality name (High for anything unknown, including inherited keys). */
export function tierFor(quality) {
    return typeof quality === 'string' && Object.prototype.hasOwnProperty.call(QUALITY, quality)
        ? QUALITY[quality]
        : QUALITY.High;
}

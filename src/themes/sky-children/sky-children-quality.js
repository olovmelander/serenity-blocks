/**
 * Sky Children — content tiers. They trade detail, never layout: every tier keeps the whole
 * picture and every event, and the scene draws the same set of meshes on each.
 *
 * skyNoise        edge of the baked sky noise (fBm, cloud billow, a second fBm, fine), texels
 * stoneNoise      edge of the baked stone noise (strata, cavities, rims, drip streaks), texels
 * lutWidth        texels per row of the droplet-optics table (bow, secondary, fogbow, glory)
 * cloudSlices     slices the altocumulus is read through
 * shelves         mist shelves in the Deep
 * casters         isle shadows cast across the shelves (the wedges)
 * starLayers      lattices of stars at night, and `milky` whether the Milky Way is drawn
 * isleRadial      segments round the Spring Isle, and `isleRings` rings down it
 * seaRings        rings out across the cloud sea, and `seaSegments` segments round it
 * seaField        edge of the baked cloud-sea relief (half floats), texels
 * terraceSegments segments round a terrace lip
 * archipelago     far isles along the horizon, and `hairlineFalls` the threads of water on them
 * fallRows        rows down a big fall's sheet, and `fallCols` columns across it
 * spray           spray billboards, and `veils` the large ones the chain raises along the bow
 * pools           terrace pools and basins, and `lamps` the held pools that light the stone
 * packets         coloured ribbons and surge fronts riding the falls at once
 * gliders         children in the air, and `trailSamples` the points along each one's trail
 * threads         threads of light-water in flight at once, and `droplets` beads to a thread
 * glows           capacity of the glow pool (copies, crowns, glitter, trails, stroke heads)
 * sleepers        lights in the heap in the grotto at night
 * lightBudget     what the additive light may cover at once (area x intensity, in frames):
 *                 an event over it crowd-scales the glows and the spray, never drops
 */
export const QUALITY = Object.freeze({
    Minimal: Object.freeze({
        skyNoise: 256,
        stoneNoise: 256,
        lutWidth: 256,
        cloudSlices: 2,
        shelves: 2,
        casters: 3,
        starLayers: 1,
        milky: false,
        isleRadial: 48,
        isleRings: 36,
        seaRings: 40,
        seaSegments: 72,
        seaField: 256,
        terraceSegments: 96,
        archipelago: 6,
        hairlineFalls: 2,
        fallRows: 32,
        fallCols: 4,
        spray: 260,
        veils: 8,
        pools: 24,
        lamps: 4,
        packets: 12,
        gliders: 12,
        trailSamples: 8,
        threads: 6,
        droplets: 12,
        glows: 400,
        sleepers: 24,
        lightBudget: 0.6,
    }),
    Low: Object.freeze({
        skyNoise: 256,
        stoneNoise: 256,
        lutWidth: 256,
        cloudSlices: 3,
        shelves: 2,
        casters: 3,
        starLayers: 1,
        milky: true,
        isleRadial: 64,
        isleRings: 44,
        seaRings: 48,
        seaSegments: 96,
        seaField: 256,
        terraceSegments: 128,
        archipelago: 8,
        hairlineFalls: 4,
        fallRows: 44,
        fallCols: 6,
        spray: 420,
        veils: 8,
        pools: 32,
        lamps: 4,
        packets: 16,
        gliders: 16,
        trailSamples: 8,
        threads: 8,
        droplets: 14,
        glows: 560,
        sleepers: 36,
        lightBudget: 0.8,
    }),
    Medium: Object.freeze({
        skyNoise: 512,
        stoneNoise: 512,
        lutWidth: 512,
        cloudSlices: 4,
        shelves: 3,
        casters: 5,
        starLayers: 2,
        milky: true,
        isleRadial: 80,
        isleRings: 56,
        seaRings: 56,
        seaSegments: 112,
        seaField: 256,
        terraceSegments: 160,
        archipelago: 10,
        hairlineFalls: 6,
        fallRows: 56,
        fallCols: 6,
        spray: 700,
        veils: 10,
        pools: 40,
        lamps: 6,
        packets: 24,
        gliders: 20,
        trailSamples: 12,
        threads: 10,
        droplets: 16,
        glows: 800,
        sleepers: 60,
        lightBudget: 1.0,
    }),
    High: Object.freeze({
        skyNoise: 512,
        stoneNoise: 512,
        lutWidth: 512,
        cloudSlices: 5,
        shelves: 3,
        casters: 8,
        starLayers: 2,
        milky: true,
        isleRadial: 112,
        isleRings: 72,
        seaRings: 64,
        seaSegments: 128,
        seaField: 512,
        terraceSegments: 224,
        archipelago: 12,
        hairlineFalls: 8,
        fallRows: 72,
        fallCols: 8,
        spray: 1100,
        veils: 12,
        pools: 54,
        lamps: 10,
        packets: 32,
        gliders: 28,
        trailSamples: 16,
        threads: 12,
        droplets: 20,
        glows: 1200,
        sleepers: 96,
        lightBudget: 1.2,
    }),
    Ultra: Object.freeze({
        skyNoise: 512,
        stoneNoise: 1024,
        lutWidth: 512,
        cloudSlices: 6,
        shelves: 3,
        casters: 8,
        starLayers: 2,
        milky: true,
        isleRadial: 144,
        isleRings: 88,
        seaRings: 80,
        seaSegments: 160,
        seaField: 512,
        terraceSegments: 288,
        archipelago: 14,
        hairlineFalls: 10,
        fallRows: 84,
        fallCols: 8,
        spray: 1500,
        veils: 14,
        pools: 64,
        lamps: 12,
        packets: 40,
        gliders: 36,
        trailSamples: 16,
        threads: 14,
        droplets: 22,
        glows: 1600,
        sleepers: 128,
        lightBudget: 1.4,
    }),
    Extreme: Object.freeze({
        skyNoise: 512,
        stoneNoise: 1024,
        lutWidth: 512,
        cloudSlices: 7,
        shelves: 3,
        casters: 8,
        starLayers: 2,
        milky: true,
        isleRadial: 176,
        isleRings: 104,
        seaRings: 96,
        seaSegments: 192,
        seaField: 512,
        terraceSegments: 320,
        archipelago: 16,
        hairlineFalls: 12,
        fallRows: 96,
        fallCols: 10,
        spray: 1900,
        veils: 16,
        pools: 72,
        lamps: 12,
        packets: 48,
        gliders: 44,
        trailSamples: 20,
        threads: 16,
        droplets: 24,
        glows: 2000,
        sleepers: 160,
        lightBudget: 1.6,
    }),
});

/** The tiers, lowest first (the names the effect-quality setting uses). */
export const QUALITY_NAMES = Object.freeze(Object.keys(QUALITY));

/**
 * The content budget for a quality name; High for anything that is not one of the six (an
 * inherited key such as 'constructor' included).
 * @param {string} quality
 */
export function tierFor(quality) {
    return Object.prototype.hasOwnProperty.call(QUALITY, quality) ? QUALITY[quality] : QUALITY.High;
}

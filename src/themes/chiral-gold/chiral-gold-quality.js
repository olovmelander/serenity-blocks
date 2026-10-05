/**
 * Chiral Gold — content tiers.
 *
 * segments         tessellation along each tower's ribbons
 * wires            fine wires in each tower's cage (0 = none)
 * beads            gold beads sliding on each tower's wires
 * ringSegments     tessellation round each band of the great ring
 * studio           width of the baked studio environment (its prefiltered faces are a quarter)
 * reflection       planar reflector resolution scale for the water (0 = analytic glow)
 * reflectionTaps   taps down the water's smear (1 or 3)
 * shafts           the cones of lit air over the towers
 * motes            gold dust
 * leaf             the leaf pool (ambient flakes included)
 * ambientLeaf      flakes that drift down through the hall for ever
 * sparks           event spark pool
 * braid            flakes in the four-line braid (0 = none)
 * burst            scale on how many particles one event throws
 */
export const QUALITY = Object.freeze({
    Minimal: Object.freeze({
        segments: 120,
        wires: 0,
        beads: 0,
        ringSegments: 96,
        studio: 512,
        reflection: 0,
        reflectionTaps: 1,
        shafts: false,
        motes: 500,
        leaf: 360,
        ambientLeaf: 60,
        sparks: 96,
        braid: 0,
        burst: 0.35,
    }),
    Low: Object.freeze({
        segments: 160,
        wires: 3,
        beads: 0,
        ringSegments: 128,
        studio: 512,
        reflection: 0,
        reflectionTaps: 1,
        shafts: false,
        motes: 900,
        leaf: 800,
        ambientLeaf: 120,
        sparks: 160,
        braid: 1500,
        burst: 0.5,
    }),
    Medium: Object.freeze({
        segments: 220,
        wires: 4,
        beads: 20,
        ringSegments: 180,
        studio: 1024,
        reflection: 0.4,
        reflectionTaps: 1,
        shafts: true,
        motes: 1800,
        leaf: 1700,
        ambientLeaf: 220,
        sparks: 320,
        braid: 3500,
        burst: 0.75,
    }),
    High: Object.freeze({
        segments: 300,
        wires: 6,
        beads: 36,
        ringSegments: 240,
        studio: 1024,
        reflection: 0.5,
        reflectionTaps: 3,
        shafts: true,
        motes: 3200,
        leaf: 2800,
        ambientLeaf: 320,
        sparks: 512,
        braid: 6000,
        burst: 1,
    }),
    Ultra: Object.freeze({
        segments: 380,
        wires: 7,
        beads: 48,
        ringSegments: 300,
        studio: 1024,
        reflection: 0.65,
        reflectionTaps: 3,
        shafts: true,
        motes: 4800,
        leaf: 4000,
        ambientLeaf: 420,
        sparks: 768,
        braid: 9000,
        burst: 1.25,
    }),
    Extreme: Object.freeze({
        segments: 460,
        wires: 8,
        beads: 60,
        ringSegments: 360,
        studio: 1024,
        reflection: 0.8,
        reflectionTaps: 3,
        shafts: true,
        motes: 6500,
        leaf: 5400,
        ambientLeaf: 520,
        sparks: 1024,
        braid: 13000,
        burst: 1.5,
    }),
});

export const QUALITY_NAMES = Object.freeze(Object.keys(QUALITY));

export function tierFor(quality) {
    return QUALITY[quality] || QUALITY.High;
}

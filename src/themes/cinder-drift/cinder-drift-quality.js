/**
 * Cinder Drift — content tiers. Every tier keeps the whole picture and every event.
 *
 * detail     column spacing scale: the plan is cut coarser on a lower tier (fewer, wider columns)
 * embers     cinders rising off the lake
 * smoke      banks of smoke under the roof
 * spatter    lava-drop pool (crowns, sparks, fountains)
 * bombs      lava bombs a four-line clear throws (of BOMB_SLOTS)
 * fountain   drops one fountain of a curtain throws over its life
 * lakeFine   hairline cracks inside the plates, ragged raft edges (two more fetches)
 * lakeGlint  the great fall mirrored in the crust
 * shaft      the night's light drawn in the smoke
 */
export const QUALITY = Object.freeze({
    Minimal: Object.freeze({
        detail: 1.7,
        embers: 0,
        smoke: 0,
        spatter: 384,
        bombs: 5,
        fountain: 28,
        lakeFine: false,
        lakeGlint: false,
        shaft: false,
    }),
    Low: Object.freeze({
        detail: 1.4,
        embers: 420,
        smoke: 10,
        spatter: 1024,
        bombs: 7,
        fountain: 70,
        lakeFine: false,
        lakeGlint: true,
        shaft: true,
    }),
    Medium: Object.freeze({
        detail: 1.18,
        embers: 900,
        smoke: 18,
        spatter: 2304,
        bombs: 10,
        fountain: 160,
        lakeFine: true,
        lakeGlint: true,
        shaft: true,
    }),
    High: Object.freeze({
        detail: 1.0,
        embers: 1600,
        smoke: 26,
        spatter: 4096,
        bombs: 14,
        fountain: 300,
        lakeFine: true,
        lakeGlint: true,
        shaft: true,
    }),
    Ultra: Object.freeze({
        detail: 0.9,
        embers: 2400,
        smoke: 32,
        spatter: 6144,
        bombs: 14,
        fountain: 460,
        lakeFine: true,
        lakeGlint: true,
        shaft: true,
    }),
    Extreme: Object.freeze({
        detail: 0.8,
        embers: 3400,
        smoke: 40,
        spatter: 8192,
        bombs: 14,
        fountain: 620,
        lakeFine: true,
        lakeGlint: true,
        shaft: true,
    }),
});

export const QUALITY_NAMES = Object.freeze(Object.keys(QUALITY));

export function tierFor(quality) {
    return QUALITY[quality] || QUALITY.High;
}

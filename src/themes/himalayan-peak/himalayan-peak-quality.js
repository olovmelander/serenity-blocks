/**
 * Himalayan Peak — content tiers. Every tier keeps the whole picture and every event.
 *
 * stride      grid cells per cell of the massif's mesh (1 = every baked height is a vertex)
 * air         times the amphitheatre's shadow is asked along each ray through the haze
 *             (0 = no shafts: the haze is taken as half lit)
 * cloud       [columns, rows] of the cloud sea's mesh
 * billows     octaves of billow the cloud sea's shading reads (its self-shadow reads one fewer)
 * cirrus      the high cloud over the amphitheatre (two noise fetches)
 * spindrift   blown-snow sprites along the crests and off the summit
 * dust        diamond dust in the air round the viewer
 * papers      wind-horse paper pool (a lock throws a handful, a clear a storm)
 * flags       flags on the prayer lines (the lines themselves are always strung)
 * powder      the avalanche's powder cloud
 * glints      the pass's snow sparkles
 */
export const QUALITY = Object.freeze({
    Minimal: Object.freeze({
        stride: 4, air: 0, cloud: [96, 72], billows: 2, cirrus: false, spindrift: 220, dust: 0, papers: 160, flags: 70, powder: 60, glints: false,
    }),
    Low: Object.freeze({
        stride: 3, air: 0, cloud: [128, 96], billows: 2, cirrus: true, spindrift: 420, dust: 160, papers: 280, flags: 100, powder: 100, glints: true,
    }),
    Medium: Object.freeze({
        stride: 2, air: 3, cloud: [176, 128], billows: 3, cirrus: true, spindrift: 760, dust: 320, papers: 480, flags: 140, powder: 160, glints: true,
    }),
    High: Object.freeze({
        stride: 2, air: 5, cloud: [224, 160], billows: 3, cirrus: true, spindrift: 1200, dust: 520, papers: 720, flags: 180, powder: 220, glints: true,
    }),
    Ultra: Object.freeze({
        stride: 1, air: 6, cloud: [288, 200], billows: 3, cirrus: true, spindrift: 1800, dust: 800, papers: 1000, flags: 220, powder: 300, glints: true,
    }),
    Extreme: Object.freeze({
        stride: 1, air: 8, cloud: [352, 240], billows: 3, cirrus: true, spindrift: 2600, dust: 1200, papers: 1400, flags: 260, powder: 400, glints: true,
    }),
});

export const QUALITY_NAMES = Object.freeze(Object.keys(QUALITY));

export function tierFor(quality) {
    return QUALITY[quality] || QUALITY.High;
}

/**
 * THE FOREST'S SPECIES (2026-11-24): what each kind of tree is coloured like, and how large its
 * individuals run. Frozen, import-free data, so the worker and the tests read it without three.js.
 *
 * A species carries a RAMP of crown colours and every tree takes one point on it (`hue`, 0..1): a wood
 * of one species is a family of near hues, never one green and never a rainbow. A stand leans the
 * point one way (the scatter hands a stand's own hue in), so neighbours agree and stands differ.
 *
 * ⚠️ Authored for the WORLD's output contract, not for the screen: the world hands the post stack
 * `outputScale 0.82` / `outputSaturation 0.72`, and the stack then applies ACES and two saturations.
 * Greens want far less blue and a little less chroma here than they look like on screen.
 *
 * Shade is the crown's own hue gone deeper and more saturated, never greyer (measured, see
 * `shadeColourFor`), and each species says how deep: `shade` is its shade's luminance against its lit.
 */

const S = (id, spec) => Object.freeze({
    id, ...spec, ramp: Object.freeze(spec.ramp.map((c) => Object.freeze(c))), trunk: Object.freeze(spec.trunk),
});

export const ODYSSEY_FOREST_SPECIES = Object.freeze([
    // the Greenwood
    S('oak', {
        ramp: [[0.205, 0.292, 0.068], [0.150, 0.252, 0.064], [0.112, 0.212, 0.072]],
        shade: 0.42,
        sat: 1.3,
        trunk: [0.150, 0.112, 0.080],
    }),
    S('beech', {
        ramp: [[0.160, 0.272, 0.068], [0.108, 0.226, 0.068], [0.080, 0.186, 0.078]],
        shade: 0.42,
        sat: 1.3,
        trunk: [0.205, 0.190, 0.166],
    }),
    S('birch', {
        ramp: [[0.232, 0.318, 0.082], [0.186, 0.290, 0.080], [0.145, 0.250, 0.082]],
        shade: 0.46,
        sat: 1.28,
        trunk: [0.560, 0.540, 0.490],
    }),
    // the autumn side
    S('aspen', {
        ramp: [[0.570, 0.440, 0.076], [0.555, 0.335, 0.052], [0.510, 0.210, 0.042]],
        shade: 0.46,
        sat: 1.3,
        trunk: [0.480, 0.470, 0.390],
    }),
    S('maple', {
        ramp: [[0.460, 0.150, 0.044], [0.410, 0.078, 0.038], [0.320, 0.044, 0.034]],
        shade: 0.4,
        sat: 1.24,
        trunk: [0.092, 0.062, 0.048],
    }),
    // the blossom
    S('cherry', {
        ramp: [[0.600, 0.372, 0.452], [0.570, 0.292, 0.390], [0.505, 0.212, 0.312]],
        shade: 0.48,
        sat: 1.4,
        trunk: [0.115, 0.074, 0.066],
    }),
    // the water
    S('willow', {
        ramp: [[0.200, 0.278, 0.090], [0.165, 0.250, 0.086]],
        shade: 0.42,
        sat: 1.26,
        trunk: [0.130, 0.102, 0.076],
    }),
    // the Landfall
    S('stone-pine', {
        ramp: [[0.096, 0.172, 0.064], [0.074, 0.146, 0.062]],
        shade: 0.42,
        sat: 1.24,
        trunk: [0.285, 0.150, 0.084],
    }),
    // the slopes
    S('spruce', {
        ramp: [[0.082, 0.150, 0.080], [0.062, 0.126, 0.078], [0.052, 0.108, 0.078]],
        shade: 0.42,
        sat: 1.2,
        trunk: [0.120, 0.078, 0.058],
    }),
    S('fir', {
        ramp: [[0.080, 0.156, 0.104], [0.060, 0.130, 0.098]],
        shade: 0.42,
        sat: 1.2,
        trunk: [0.140, 0.106, 0.086],
    }),
    S('larch', {
        ramp: [[0.182, 0.272, 0.086], [0.142, 0.238, 0.084]],
        shade: 0.46,
        sat: 1.26,
        trunk: [0.170, 0.106, 0.075],
    }),
    S('scots-pine', {
        ramp: [[0.112, 0.184, 0.088], [0.086, 0.156, 0.084]],
        shade: 0.42,
        sat: 1.22,
        trunk: [0.380, 0.182, 0.094],
    }),
    S('bent-pine', {
        ramp: [[0.104, 0.178, 0.078], [0.084, 0.154, 0.074]],
        shade: 0.42,
        sat: 1.22,
        trunk: [0.300, 0.152, 0.088],
    }),
    S('dwarf-pine', {
        ramp: [[0.104, 0.178, 0.084], [0.086, 0.154, 0.082]],
        shade: 0.42,
        sat: 1.2,
        trunk: [0.170, 0.106, 0.075],
    }),
    // the dark notes
    S('cypress', {
        ramp: [[0.062, 0.108, 0.052], [0.050, 0.090, 0.048]],
        shade: 0.42,
        sat: 1.2,
        trunk: [0.120, 0.084, 0.062],
    }),
    // the skirt
    S('hazel', {
        ramp: [[0.150, 0.246, 0.072], [0.112, 0.206, 0.068]],
        shade: 0.42,
        sat: 1.28,
        trunk: [0.140, 0.104, 0.076],
    }),
    S('hawthorn', {
        ramp: [[0.125, 0.216, 0.076], [0.098, 0.182, 0.072]],
        shade: 0.42,
        sat: 1.28,
        trunk: [0.120, 0.090, 0.070],
    }),
    S('thicket', {
        ramp: [[0.122, 0.204, 0.068], [0.095, 0.170, 0.064]],
        shade: 0.42,
        sat: 1.28,
        trunk: [0.125, 0.094, 0.070],
    }),
    S('juniper', {
        ramp: [[0.092, 0.152, 0.086], [0.076, 0.130, 0.080]],
        shade: 0.42,
        sat: 1.18,
        trunk: [0.140, 0.098, 0.074],
    }),
    // the floor: a wood's ferns, the bracken at its edge (green, then copper), the moss on what has fallen
    S('fern', {
        ramp: [[0.196, 0.300, 0.072], [0.140, 0.254, 0.070], [0.104, 0.210, 0.074]],
        shade: 0.42,
        sat: 1.28,
        trunk: [0.110, 0.082, 0.056],
    }),
    S('bracken', {
        ramp: [[0.180, 0.270, 0.074], [0.206, 0.248, 0.068], [0.290, 0.204, 0.060], [0.330, 0.156, 0.046]],
        shade: 0.42,
        sat: 1.26,
        trunk: [0.140, 0.100, 0.064],
    }),
    S('log', {
        ramp: [[0.160, 0.232, 0.052], [0.118, 0.192, 0.054]],
        shade: 0.42,
        sat: 1.28,
        trunk: [0.132, 0.104, 0.078],
    }),
    S('snag', {
        ramp: [[0.100, 0.100, 0.100]],
        shade: 0.4,
        sat: 1,
        trunk: [0.460, 0.440, 0.405],
    }),
]);

const byId = new Map(ODYSSEY_FOREST_SPECIES.map((s) => [s.id, s]));
/** Undefined for an unknown id. */
export function getForestSpecies(id) {
    return byId.get(id);
}

/**
 * A crown's shade: deeper, and more saturated about its own luma (never greyer, never bluer: a blue
 * above luma, a pink's, is not pushed up), at exactly `shade` of the lit luma.
 */
export function shadeColourFor(crown, species) {
    const { shade, sat } = species;
    const luma = (0.2126 * crown[0]) + (0.7152 * crown[1]) + (0.0722 * crown[2]);
    const pushed = crown.map((c, i) => Math.max(0, luma + ((c - luma) * (i === 2 && c > luma ? Math.min(sat, 1) : sat))));
    const pl = (0.2126 * pushed[0]) + (0.7152 * pushed[1]) + (0.0722 * pushed[2]);
    const k = pl > 1e-6 ? (luma * shade) / pl : shade;
    return pushed.map((c) => c * k);
}

/** The colour a ramp has at `t` (0..1). */
export function rampAt(ramp, t) {
    if (ramp.length === 1) return [...ramp[0]];
    const u = Math.min(0.9999, Math.max(0, t)) * (ramp.length - 1);
    const i = Math.floor(u);
    const f = u - i;
    return ramp[i].map((c, k) => c + ((ramp[i + 1][k] - c) * f));
}

/**
 * One tree's colours: `hue` its point on the species' ramp, `value` 0..1 its lightness among its
 * neighbours (0.5 the species' own), `tint` an optional per-channel push (a stand's, the altitude's).
 * @returns {{crown: number[], shade: number[], trunk: number[]}}
 */
export function forestColours(speciesId, { hue = 0.3, value = 0.5, tint = null } = {}) {
    const species = byId.get(speciesId) ?? ODYSSEY_FOREST_SPECIES[0];
    const k = 1 + ((value - 0.5) * 0.30);
    const crown = rampAt(species.ramp, hue).map((c, i) => Math.max(0, c * k * (tint ? tint[i] : 1)));
    return { crown, shade: shadeColourFor(crown, species), trunk: [...species.trunk] };
}

/**
 * Where each tier of detail ends, in world units from the rail's ground track (a tree's tier is fixed:
 * the camera rides the rail, so a tree never comes nearer than its tier allows and never pops).
 */
export const FOREST_LOD_DISTANCE = Object.freeze({ hero: 165, mid: 390 });

/**
 * What a quality tier draws: the same trees in the same places. `cards` is the share of every near tree's
 * cards (fewer, larger ones). The far pictures hold 80 px and cost next to nothing (17,000 trees, 0.07 ms on
 * an RTX), so a tree hands over to its picture about where it stands that tall on the tier's screen.
 */
export const FOREST_TIERS = Object.freeze({
    Minimal: Object.freeze({ hero: 35, mid: 100, cards: 0.35 }),
    Low: Object.freeze({ hero: 45, mid: 130, cards: 0.4 }),
    Medium: Object.freeze({ hero: 60, mid: 150, cards: 0.5 }),
    High: Object.freeze({ hero: 165, mid: 390, cards: 1 }),
    Ultra: Object.freeze({ hero: 190, mid: 480, cards: 1 }),
    Extreme: Object.freeze({ hero: 220, mid: 560, cards: 1 }),
});

/** The tier's numbers; an unknown name gets High's. */
export function forestTier(name) {
    return FOREST_TIERS[name] ?? FOREST_TIERS.High;
}

/** The tier's distances, for the scatter. */
export function forestLodDistanceForTier(name) {
    const { hero, mid } = forestTier(name);
    return { hero, mid };
}

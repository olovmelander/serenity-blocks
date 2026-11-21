// @ts-check
/**
 * THE OCEAN'S DEPTH ARC (Odyssey masterpiece pass, 2026-11-17) — four waters, one climb.
 *
 * The audit's read of chapter 2: "one saturated blue from bottom to top: 'deep ocean' never feels
 * deep, and there is no arc". The colour script's water keyframes are sampled by PROGRESS and sit
 * in one hue family (they must: their horizon slot runs on into the island's sky, and the script's
 * hue-rate rule holds it there). So the water column gets a table of its own, keyed on what
 * actually makes water look the way it does: how much of it lies over the eye.
 *
 *   abyss     (165 u down and deeper)  blue-black. The only lights are the far well of the surface
 *             straight overhead, the things that glow, and the snow that catches them.
 *   twilight  (~115 u)                 deep blue. The surface is a dim window; shafts are faint.
 *   sunlit    (~58 u)                  blue-green. The light is strong and it moves.
 *   shallows  (the last ~8 u)          turquoise. Caustics lie on everything.
 *
 * Every value is a continuous function of the eye's depth (smoothstep between the zones, so each
 * zone is a plateau the orbs sit on and the climb eases through the turns between them). The
 * world's renderer writes these into the uniforms its underwater column already reads; the whales
 * and the visitors take their haze from `oceanHazeColour`, so an animal dissolves into the water
 * that is actually round it.
 *
 * Colours are scene-referred linear RGB in the units the world authors in (the board hands the
 * stack an output scale and a 0.72 saturation, and the grade puts the chroma back): bright and
 * saturated on purpose, like every palette beside this one.
 *
 * Pure: no three.js.
 */

/**
 * @typedef {object} OceanZone
 * @property {string} name
 * @property {number} depth the eye's depth this zone is centred on (u under the surface)
 * @property {readonly number[]} shallow the plate water near the surface takes, seen from this depth
 * @property {readonly number[]} mid the plate of the water round the eye
 * @property {readonly number[]} deep the plate a long column converges on
 * @property {readonly number[]} luminous the light the surface lets in: the glow overhead and near it
 * @property {number} dim the in-scattered light's multiplier (the deep is dark)
 * @property {number} well how strongly the zenith keeps a well of light in the dimmed column
 * @property {number} shafts the god rays' strength
 * @property {number} glow how much the living lights (plankton, lanterns) show: 1 in the dark
 * @property {number} caustics how much moving surface light lies on what stands in the water
 * @property {number} beams the thin sweeping shafts of the upper water (odyssey-ocean-scenery.js)
 * @property {number} overhead how much of the surface's light the water over the eye takes, per u
 *   of path (0 in the shallows: the surface is right there; the abyss sees it as a far well)
 */

/**
 * The water's extinction per unit of path (rgb): red dies first, blue last. The haze over every
 * surface under water takes it whole (submergedOf); the light shafts take `OCEAN_SHAFT_EXTINCTION`
 * of it along the view ray (2026-11-21 sea audit, item 6), so a far shaft sits back in the water
 * like everything else at its range instead of standing at full strength in front of the haze.
 */
export const OCEAN_EXTINCTION = Object.freeze([0.0160, 0.0082, 0.0046]);
export const OCEAN_SHAFT_EXTINCTION = 0.6;

/** @type {readonly OceanZone[]} shallowest first */
export const OCEAN_ZONES = Object.freeze([
    Object.freeze({
        name: 'shallows',
        depth: 8,
        shallow: Object.freeze([0.16, 0.66, 0.66]),
        mid: Object.freeze([0.045, 0.40, 0.52]),
        deep: Object.freeze([0.012, 0.15, 0.32]),
        luminous: Object.freeze([0.07, 0.52, 0.54]),
        dim: 1,
        well: 0,
        shafts: 0.85,
        glow: 0,
        caustics: 1,
        beams: 0.8,
        overhead: 0,
    }),
    Object.freeze({
        name: 'sunlit',
        depth: 58,
        shallow: Object.freeze([0.10, 0.50, 0.56]),
        mid: Object.freeze([0.022, 0.22, 0.38]),
        deep: Object.freeze([0.008, 0.07, 0.20]),
        luminous: Object.freeze([0.05, 0.42, 0.48]),
        dim: 0.86,
        well: 0.30,
        shafts: 1.0,
        glow: 0.12,
        caustics: 0.45,
        beams: 1,
        overhead: 0.0012,
    }),
    Object.freeze({
        name: 'twilight',
        depth: 115,
        shallow: Object.freeze([0.04, 0.20, 0.40]),
        mid: Object.freeze([0.008, 0.06, 0.20]),
        deep: Object.freeze([0.003, 0.016, 0.085]),
        luminous: Object.freeze([0.025, 0.20, 0.44]),
        dim: 0.50,
        well: 0.55,
        shafts: 0.42,
        glow: 0.6,
        caustics: 0,
        beams: 0.3,
        overhead: 0.0042,
    }),
    Object.freeze({
        name: 'abyss',
        depth: 165,
        shallow: Object.freeze([0.014, 0.07, 0.22]),
        mid: Object.freeze([0.003, 0.016, 0.075]),
        deep: Object.freeze([0.001, 0.0035, 0.024]),
        luminous: Object.freeze([0.012, 0.09, 0.30]),
        dim: 0.24,
        well: 0.80,
        shafts: 0.14,
        glow: 1,
        caustics: 0,
        beams: 0,
        overhead: 0.0085,
    }),
]);

const COLOUR_KEYS = /** @type {const} */ (['shallow', 'mid', 'deep', 'luminous']);
const SCALAR_KEYS = /** @type {const} */ (['dim', 'well', 'shafts', 'glow', 'caustics', 'beams', 'overhead']);

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const smooth = (t) => t * t * (3 - (2 * t));

/**
 * @typedef {object} OceanLook
 * @property {number[]} shallow
 * @property {number[]} mid
 * @property {number[]} deep
 * @property {number[]} luminous
 * @property {number} dim
 * @property {number} well
 * @property {number} shafts
 * @property {number} glow
 * @property {number} caustics
 * @property {number} beams
 * @property {number} overhead
 * @property {string} zone the nearer zone's name
 * @property {number} depth the depth this was sampled at (clamped to 0 and up)
 */

/** A look to write into (so the per-frame call allocates nothing). */
export function createOceanLook() {
    return {
        shallow: [0, 0, 0],
        mid: [0, 0, 0],
        deep: [0, 0, 0],
        luminous: [0, 0, 0],
        dim: 1,
        well: 0,
        shafts: 1,
        glow: 0,
        caustics: 1,
        beams: 0,
        overhead: 0,
        zone: OCEAN_ZONES[0].name,
        depth: 0,
    };
}

/**
 * The water's look for an eye `depthU` under the surface.
 * @param {number} depthU the eye's depth (u); above the surface and garbage read as 0
 * @param {OceanLook} [out]
 * @param {readonly OceanZone[]} [zones]
 * @returns {OceanLook}
 */
export function oceanDepthLook(depthU, out = createOceanLook(), zones = OCEAN_ZONES) {
    const d = Number.isFinite(depthU) ? Math.max(0, depthU) : 0;
    let i = 0;
    while (i < zones.length - 2 && d > zones[i + 1].depth) i += 1;
    const a = zones[i];
    const b = zones[Math.min(i + 1, zones.length - 1)];
    const span = b.depth - a.depth;
    const t = span > 1e-6 ? smooth(clamp01((d - a.depth) / span)) : 0;
    for (let k = 0; k < COLOUR_KEYS.length; k += 1) {
        const key = COLOUR_KEYS[k];
        const ca = a[key];
        const cb = b[key];
        const o = out[key];
        o[0] = ca[0] + ((cb[0] - ca[0]) * t);
        o[1] = ca[1] + ((cb[1] - ca[1]) * t);
        o[2] = ca[2] + ((cb[2] - ca[2]) * t);
    }
    for (let k = 0; k < SCALAR_KEYS.length; k += 1) {
        const key = SCALAR_KEYS[k];
        out[key] = a[key] + ((b[key] - a[key]) * t);
    }
    out.zone = t < 0.5 ? a.name : b.name;
    out.depth = d;
    return out;
}

const hazeScratch = createOceanLook();

/**
 * The colour a long level look through the water ends in, for an eye `depthU` down: what the
 * world's own column converges on there (its grazing plate, dimmed). The sea's animals haze
 * toward this, so they dissolve into the water that is round them.
 * @param {number} depthU
 * @param {number[]} [out]
 * @returns {number[]} linear rgb
 */
export function oceanHazeColour(depthU, out = [0, 0, 0]) {
    const look = oceanDepthLook(depthU, hazeScratch);
    const eye01 = clamp01(look.depth / 140);
    // The renderer's `convergePlate`: the mid plate leaning to the deep one with depth, and to
    // the luminous water in the last ~25 u under the surface.
    const near = (1 - smooth(clamp01(eye01 / 0.18))) * 0.8;
    for (let c = 0; c < 3; c += 1) {
        const column = look.mid[c] + ((look.deep[c] - look.mid[c]) * eye01);
        out[c] = (column + (((look.luminous[c] * 1.25) - column) * near)) * look.dim;
    }
    return out;
}

// ── ALIVE ON THE CLOCK ───────────────────────────────────────────────────────────

/**
 * THE SEA'S OWN WEATHER — what changes over a visit, so the same orb is not the same picture
 * twice. Three slow things, each a continuous function of the world's clock alone:
 *
 *   light  cloud passing over the sun far above: the whole column dims for a while and comes
 *          back (the well, the window, the shafts and the caustics with it), with brighter
 *          spells between. Two incommensurate periods, so the pattern does not repeat for hours.
 *   chop   the surface's state: from a long glassy calm (the window holds its picture, the
 *          caustics are broad and slow) to a breeze that breaks it (the window shatters, the
 *          caustics tighten).
 *   bloom  a patch of plankton that wanders round the column and up and down it: where it lies,
 *          the specks in the water flare green.
 */
export const OCEAN_CLOCK = Object.freeze({
    light: Object.freeze({
        /** The deepest a passing cloud dims the column, and the lift of a clear spell. */
        dip: 0.34, lift: 0.10, periodA: 97, periodB: 41, periodC: 23,
    }),
    chop: Object.freeze({
        calm: 0.55, rough: 1.5, periodA: 211, periodB: 67,
    }),
    bloom: Object.freeze({
        /** Its loop round the column (u), how far it rises and falls (depths, u), its size (u). */
        radius: 34, depth: Object.freeze([24, 150]), size: 46, periodRound: 173, periodDepth: 257, periodPulse: 119,
    }),
});

const TAU = Math.PI * 2;

/**
 * @typedef {object} OceanClock
 * @property {number} light the column's light, as a share (about 0.66 under a cloud to 1.1)
 * @property {number} chop the surface's roughness, as a share of its usual (calm 0.55 .. rough 1.5)
 * @property {number[]} bloom the plankton patch: x, y, z (world) and its strength 0..1
 */

/** A clock state to write into. */
export function createOceanClock() {
    return { light: 1, chop: 1, bloom: [0, 0, 0, 0] };
}

/**
 * The sea's weather at world time `t`.
 * @param {number} t seconds (the board's clock)
 * @param {{ x: number, z: number, seaLevel: number }} column the column's axis and the sea level
 * @param {OceanClock} [out]
 * @returns {OceanClock}
 */
export function oceanClockAt(t, column, out = createOceanClock(), spec = OCEAN_CLOCK) {
    const time = Number.isFinite(t) ? t : 0;
    const L = spec.light;
    // Cloud: mostly clear, with dips where the two slow waves agree.
    const cloud = 0.5 + (0.5 * ((0.62 * Math.sin(((TAU * time) / L.periodA) + 1.1))
        + (0.38 * Math.sin(((TAU * time) / L.periodB) + 2.3))));
    const shade = smooth(clamp01((cloud - 0.42) / 0.5));
    out.light = 1 - (L.dip * shade) + (L.lift * Math.sin(((TAU * time) / L.periodC) + 0.4) * (1 - shade));
    const C = spec.chop;
    const sea = 0.5 + (0.5 * ((0.7 * Math.sin(((TAU * time) / C.periodA) + 0.6))
        + (0.3 * Math.sin(((TAU * time) / C.periodB) + 4.0))));
    out.chop = C.calm + ((C.rough - C.calm) * smooth(clamp01(sea)));
    const B = spec.bloom;
    const round = ((TAU * time) / B.periodRound) + 0.9;
    const dive = 0.5 + (0.5 * Math.sin(((TAU * time) / B.periodDepth) + 2.0));
    out.bloom[0] = column.x + (Math.cos(round) * B.radius);
    out.bloom[1] = column.seaLevel - (B.depth[0] + ((B.depth[1] - B.depth[0]) * dive));
    out.bloom[2] = column.z + (Math.sin(round) * B.radius);
    out.bloom[3] = smooth(clamp01((Math.sin(((TAU * time) / B.periodPulse) + 5.2) + 0.35) / 1.1));
    return out;
}

/**
 * Lay the weather over a depth look (in place): the light scales what the surface gives, the
 * chop tightens the caustics. Deep down the weather is far away: the dark keeps its own lights.
 * @param {OceanLook} look
 * @param {OceanClock} clock
 * @returns {OceanLook}
 */
export function applyOceanClock(look, clock) {
    look.dim *= clock.light;
    look.shafts *= clock.light * clock.light;
    look.beams *= clock.light * clock.light;
    look.caustics *= clock.light * (0.7 + (0.3 * clock.chop));
    return look;
}

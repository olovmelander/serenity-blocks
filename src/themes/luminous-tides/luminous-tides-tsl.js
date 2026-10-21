/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Luminous Tides — shared TSL: the night sky as a function of a direction, and the shore's
 * geometry and surf as pure functions the water, the sand and the land all agree on.
 *
 * The whole distance is ONE function, `skyColour(dir, …)`: the night's air from overhead down to
 * the sea, the warm glow over the far coast on the left (an afterglow, a town), the coast itself
 * with its lamps, the cloud lit orange from beneath where the glow reaches it, the stars and the
 * Milky Way. The dome draws it along the view ray; the water calls it again along its mirror ray
 * (with fewer layers). Nothing is rendered twice and nothing is loaded.
 *
 * Builders that read uniforms or textures are inline (called inside a material's Fn); the pure
 * shore helpers are laid out once (setLayout) and take plain values.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, abs, atan, clamp, cos, dot, exp, float, floor, fract, max, min, mix, normalize, select, sin, smoothstep, sqrt,
    texture, vec2, vec3,
} from 'three/tsl';
import {
    DEG, NIGHT_COLOURS, SHORE, SHORE_FRAME, SURF, SWASH, TAU, bakeSeaNoise, bakeSkyNoise,
} from './luminous-tides-core.js';

/**
 * The look's numbers, in one place. The playground can override any of them from the URL
 * (`P.<name>=<value>`) before the world is built; the theme ships these.
 */
export const TUNE = {
    // The air: how fast the horizon's band and the belt over it fall away with height.
    horizonFall: 11,
    beltFall: 2.8,
    // The warm glow over the far coast: how wide it spreads along the horizon, how fast it fades up.
    warmLobe: 6.5,
    warmFall: 10,
    // The far coast: where it runs on the horizon (degrees right of the view line) and how high.
    coast: [-60, -4],
    coastHeight: 0.5,
    // Its lamps: how many to a degree, how bright.
    lampsPerDegree: 1.7,
    lamps: 3.0,
    // The cloud deck.
    deckCurve: 0.11,
    deckAlong: 0.05,
    deckAcross: 0.09,
    deckThick: 0.22,
    deckTaper: 0.12,
    deckBase: 0.86,
    deckCover: 0.66,
    deckPatch: 0.9,
    deckSoft: 0.16,
    deckEmboss: 5.5,
    deckSlot: [0.012, 0.07],
    deckFog: 0.16,
    // The stars: a spot's radius in buffer pixels, and how bright each layer's stars are (the
    // bright few, the many, the faint dust).
    starSpot: 0.62,
    starGain: [18.0, 0.75, 0.16],
    // The lamps' roads on the water (drawn by the water, not mirrored): how far a road follows the
    // resolved ripples sideways (0: straight down from its lamp), how rough the sea is to them
    // beyond what the water resolves, how bright, and how fast a glint comes and goes (per second).
    lampWander: 0.3,
    lampRough: 0.0025,
    lampRoad: 0.0055,
    glintRate: 4.5,
    // The water.
    glintFloor: 0.0012,
    hazeReach: 2400,
    ripple: [0.075, 0.1, 0.12],
    rippleTile: [19, 5.3, 1.6],
    // The sea's light.
    lip: 4.0, // the lip of a wave as it breaks
    bore: 2.6, // the front of a bore
    foam: 0.35, // the foam a bore leaves
    edge: 2.4, // the swash's leading edge
    lace: 0.9, // the lace the backwash leaves
    sparkle: 0.55, // the sparks in the foam
    calm: 0.05, // the faint fire of calm water
    mirrorFire: 0.08, // the water's mirror of a breaking wave's lit lip and bore
    // The land at night (landLight): how much of the sky's air, the far coast's warm glow and the
    // sea's blue fire falls on the trees, how brightly the sky behind wraps their edges, and the
    // mist lying in the jungle's foot and between it and the headland.
    landSky: 0.45,
    landWarm: 0.22,
    landFire: 0.32,
    landRim: 0.8,
    landMist: 0.4,
};

/** Apply overrides (numbers, or comma lists for the array entries) to TUNE. */
export function tune(overrides) {
    if (!overrides) return;
    Object.keys(overrides).forEach((key) => {
        if (!(key in TUNE)) return;
        const current = TUNE[key];
        const raw = overrides[key];
        if (Array.isArray(current)) {
            const list = String(raw).split(',').map(Number);
            if (list.length === current.length && list.every(Number.isFinite)) TUNE[key] = list;
        } else if (Number.isFinite(Number(raw))) {
            TUNE[key] = Number(raw);
        }
    });
}

function noiseTexture(data, size, name) {
    const map = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    map.wrapS = THREE.RepeatWrapping;
    map.wrapT = THREE.RepeatWrapping;
    map.magFilter = THREE.LinearFilter;
    map.minFilter = THREE.LinearMipmapLinearFilter;
    map.generateMipmaps = true;
    map.anisotropy = 8;
    map.colorSpace = THREE.NoColorSpace;
    map.needsUpdate = true;
    map.name = name;
    return map;
}

/** The sky's noise field as a texture (see bakeSkyNoise). */
export function createSkyNoise(size) {
    return noiseTexture(bakeSkyNoise(size), size, 'luminous-tides-sky-noise');
}

/** The water's noise field as a texture, and the slope variance its bytes carry. */
export function createSeaNoise(size) {
    const { data, variance } = bakeSeaNoise(size);
    return { map: noiseTexture(data, size, 'luminous-tides-sea-noise'), variance };
}

/**
 * The night's colours as nodes: one uniform row each (NIGHT_COLOURS), which the world rewrites
 * as the wheel turns. `rows` is a uniformArray of vec4.
 */
export function createLight(rows) {
    return Object.freeze(Object.fromEntries(NIGHT_COLOURS.map((name, i) => [name, rows.element(i).xyz])));
}

export const hash21 = (p) => fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453));
export const hash22 = (p) => fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))).mul(43758.5453));
const hash33 = (p) => fract(sin(vec3(
    dot(p, vec3(127.1, 311.7, 74.7)),
    dot(p, vec3(269.5, 183.3, 246.1)),
    dot(p, vec3(113.5, 271.9, 124.6)),
)).mul(43758.5453));

// ── The shore, as pure functions ────────────────────────────────────────────────────────────

const { along: ALONG, out: SEAWARD, origin: ORIGIN } = SHORE_FRAME;
const LEAN = Math.sin(SURF.oblique * DEG);
const WOBBLE = SURF.wobble * SURF.period;

/** World xz → shore (a, s). Laid out: pure. */
export const shoreOf = /* @__PURE__ */ Fn(([xz]) => {
    const d = xz.sub(vec2(ORIGIN.x, ORIGIN.z));
    const a = dot(d, vec2(ALONG.x, ALONG.z));
    const past = max(a.sub(SHORE.bendFrom), 0.0);
    const s = dot(d, vec2(SEAWARD.x, SEAWARD.z)).sub(past.mul(past).div(2 * SHORE.bendRadius));
    return vec2(a, s);
}).setLayout({ name: 'lt_shoreOf', type: 'vec2', inputs: [{ name: 'xz', type: 'vec2' }] });

/** The ground's height across the shore (sandHeight in the core). Laid out: pure. */
export const sandOf = /* @__PURE__ */ Fn(([s]) => {
    const bermUp = -SHORE.berm;
    const duneUp = -SHORE.dunes;
    const atBerm = SHORE.foreshore * bermUp;
    const atDune = atBerm + SHORE.backshore * (duneUp - bermUp);
    const up = s.negate().toVar();
    const land = select(
        up.lessThan(bermUp),
        up.mul(SHORE.foreshore),
        select(up.lessThan(duneUp), up.sub(bermUp).mul(SHORE.backshore).add(atBerm), min(up.sub(duneUp).mul(0.09).add(atDune), 6.0)),
    );
    const sea = select(
        s.lessThan(SHORE.outer),
        s.mul(-SHORE.bed),
        s.sub(SHORE.outer).mul(-SHORE.bedDeep).sub(SHORE.bed * SHORE.outer),
    );
    return select(s.lessThan(0.0), land, sea);
}).setLayout({ name: 'lt_sandOf', type: 'float', inputs: [{ name: 's', type: 'float' }] });

/** The surf's warped phase at the time a place sees (surfPhase ∘ surfTime in the core). */
export const surfPhaseOf = /* @__PURE__ */ Fn(([a, s, t]) => {
    const bend = sin(a.mul(0.083).add(1.1)).mul(0.7).add(sin(a.mul(0.21).add(2.3)).mul(0.25));
    const tr = t.sub(float(SURF.reference).sub(s).div(SURF.speed)).sub(a.mul(LEAN / SURF.speed)).sub(bend);
    const warped = tr.add(sin(tr.mul(TAU / 23.3)).mul(WOBBLE * 0.55)).add(sin(tr.mul(TAU / 41.9).add(1.7)).mul(WOBBLE * 0.35));
    return warped.div(SURF.period);
}).setLayout({
    name: 'lt_surfPhaseOf',
    type: 'float',
    inputs: [{ name: 'a', type: 'float' }, { name: 's', type: 'float' }, { name: 't', type: 'float' }],
});

/** The height of crest number k (crestHeight in the core). Laid out: pure. */
export const crestOf = /* @__PURE__ */ Fn(([k]) => {
    const born = k.mul(SURF.period);
    const set = sin(born.mul(TAU / SURF.setPeriod)).mul(0.5).add(0.5);
    const h = fract(sin(k.mul(12.9898).add(4.1414)).mul(43758.5453));
    const one = h.mul(SURF.spread * 2).add(1 - SURF.spread);
    return one.mul(set.mul(set).mul(SURF.setDepth).add(1 - SURF.setDepth * 0.5)).mul(SURF.height);
}).setLayout({ name: 'lt_crestOf', type: 'float', inputs: [{ name: 'k', type: 'float' }] });

/** Where a wave of height H breaks (breakLine in the core). Laid out: pure. */
export const breakOf = /* @__PURE__ */ Fn(([H, a]) => {
    const bar = sin(a.mul(0.071).add(0.6)).mul(SURF.sandbar * 0.6).add(sin(a.mul(0.023).add(2.1)).mul(SURF.sandbar * 0.4));
    return max(H.div(SURF.breakRatio * SHORE.bed).add(bar), 4.0);
}).setLayout({ name: 'lt_breakOf', type: 'float', inputs: [{ name: 'H', type: 'float' }, { name: 'a', type: 'float' }] });

/** How far up the sand the swash's edge is tau seconds after its bore reached the waterline. */
export const swashOf = /* @__PURE__ */ Fn(([H, tau]) => {
    const R = H.mul(SWASH.reachPerH).add(SWASH.reach0);
    const top = sqrt(R.mul(2.0 / SWASH.gravity));
    const t = clamp(tau, 0.0, top.mul(2.0));
    return max(top.mul(SWASH.gravity).mul(t).sub(t.mul(t).mul(0.5 * SWASH.gravity)), 0.0);
}).setLayout({ name: 'lt_swashOf', type: 'float', inputs: [{ name: 'H', type: 'float' }, { name: 'tau', type: 'float' }] });

// ── The night sky ───────────────────────────────────────────────────────────────────────────

/**
 * The air alone: the night's three bands along a direction, and the warm glow over the far
 * coast. No cloud, no star.
 */
export function skyBase(dir, U) {
    const { light } = U;
    const up = max(dir.y, 0.0);
    const h1 = exp(up.mul(-TUNE.horizonFall));
    const h2 = exp(up.mul(-TUNE.beltFall));
    const air = light.zenith.add(light.mid.sub(light.zenith).mul(h2)).add(light.horizon.sub(light.mid).mul(h1));
    const level = normalize(vec3(dir.x, 0.0, dir.z).add(vec3(0.0, 0.0, -1e-4)));
    const around = dot(level, U.warmDir).sub(1.0);
    const glow = exp(around.mul(TUNE.warmLobe)).mul(exp(up.mul(-TUNE.warmFall)));
    return air.add(light.warm.mul(glow).mul(U.warmth));
}

/** The air over the far sea along a direction: the horizon seen level. The sea fades into this. */
export function horizonHaze(dir, U) {
    const level = normalize(vec3(dir.x, 0.0, dir.z).add(vec3(0.0, 0.0, -1e-4)));
    return skyBase(level, U).mul(U.squallDim);
}

/** 1 where a height is positive (a smooth step at a hair above zero). */
const step0 = (h) => smoothstep(0.004, 0.02, h);

/** Bearing of a direction, degrees right of the view line (−z). */
const bearingOf = (dir) => atan(dir.x, dir.z.negate()).mul(1 / DEG);

/**
 * The far coast's height over the sea at a bearing (degrees of elevation), 0 off its ends: low
 * hills, a bluff where it ends on the right.
 */
export function coastHeight(bearing, noise) {
    const [from, to] = TUNE.coast;
    const t = bearing.sub(from).div(to - from).toVar();
    const ends = smoothstep(0.0, 0.06, t).mul(float(1.0).sub(smoothstep(0.9, 1.0, t)));
    const hills = texture(noise, vec2(t.mul(1.7), 0.37), 0.0).r.mul(0.7).add(texture(noise, vec2(t.mul(5.3), 0.61), 0.0).a.mul(0.3));
    const bluff = smoothstep(0.7, 0.9, t).mul(float(1.0).sub(smoothstep(0.93, 0.995, t))).mul(0.55);
    return hills.mul(0.8).add(0.35).add(bluff).mul(ends)
        .mul(TUNE.coastHeight);
}

/**
 * The far coast's lamps along the horizon, as light: a lattice of tiny points in bearing (a few
 * rows up the coast's flank), most of them dark, each a few buffer pixels across at least.
 * `spread` widens each point vertically (the water's reflection of them is a streak).
 */
const lampField = /* @__PURE__ */ Fn(([bearing, elevation, height, spread, pix]) => {
    const [from, to] = TUNE.coast;
    const cells = bearing.sub(from).mul(TUNE.lampsPerDegree).toVar();
    const lit = float(0.0).toVar();
    const inside = smoothstep(from, from + 2, bearing).mul(float(1.0).sub(smoothstep(to - 6, to, bearing)));
    // Two rows: the waterfront and the town above it; each point is found in its own cell and its
    // two neighbours.
    for (let row = 0; row < 2; row += 1) {
        const base = floor(cells);
        for (let o = -1; o <= 1; o += 1) {
            const cell = base.add(o);
            const h = hash22(vec2(cell, 17.3 + row * 9.1)).toVar();
            const at = cell.add(h.x).div(TUNE.lampsPerDegree).add(from);
            const up = height.mul(row === 0 ? 0.12 : h.y.mul(0.5).add(0.25));
            const dx = bearing.sub(at).div(max(pix.mul(0.9), 0.006));
            const dy = elevation.sub(up).div(max(pix.mul(0.9), spread));
            const town = smoothstep(0.42, 0.72, sin(cell.mul(0.21).add(1.3)).mul(0.5).add(sin(cell.mul(0.083).add(4.1)).mul(0.5)).mul(0.5)
                .add(0.5));
            const on = smoothstep(row === 0 ? 0.5 : 0.74, 1.0, fract(h.y.mul(7.13).add(h.x.mul(3.1)))).mul(town.mul(0.85).add(0.15));
            const strength = h.x.mul(h.x).mul(1.6).add(0.4).mul(on);
            lit.addAssign(exp(dx.mul(dx).add(dy.mul(dy)).negate()).mul(strength));
        }
    }
    return lit.mul(inside);
}).setLayout({
    name: 'lt_lampField',
    type: 'float',
    inputs: [
        { name: 'bearing', type: 'float' }, { name: 'elevation', type: 'float' }, { name: 'height', type: 'float' },
        { name: 'spread', type: 'float' }, { name: 'pix', type: 'float' },
    ],
});

export function coastLamps(bearing, elevation, U, height, spread) {
    return U.light.town.mul(lampField(bearing, elevation, height, spread, U.pixelAngle.mul(1 / DEG))).mul(TUNE.lamps);
}

/**
 * The sky along a unit direction (dir.y >= 0), scene-linear, in the night's light.
 *
 * @param {object} dir     vec3 node
 * @param {object} U       the world's uniforms (luminous-tides-world.js)
 * @param {object} noise   the sky's noise texture
 * @param {object} o
 * @param {number} o.slices    slices the cloud deck is drawn in (0: no deck)
 * @param {boolean} o.fine     the deck's torn edges
 * @param {boolean} o.stars    the stars
 * @param {boolean} o.milky    the Milky Way
 * @param {boolean} o.coast    the far coast and its lamps (off: the water draws their streaks itself)
 * @param {boolean} [o.lamps]  with the coast, its lamps (default on; the water's mirror turns them
 *                             off and lays each lamp's road of glints itself)
 */
export function skyColour(dir, U, noise, o) {
    const { light } = U;
    const up = max(dir.y, 0.0).toVar();
    const base = skyBase(dir, U).toVar();
    const sky = base.toVar();
    const level = normalize(vec3(dir.x, 0.0, dir.z).add(vec3(0.0, 0.0, -1e-4)));
    const toward = dot(level, U.warmDir).toVar();

    // ── Stars and the Milky Way: behind everything ──
    if (o.stars) {
        // The night sky turns slowly about a pole behind the eye.
        const c = cos(U.starTurn);
        const s = sin(U.starTurn);
        const axis = vec3(0.0, 0.62, 0.785);
        const q = dir.mul(c).add(axis.cross(dir).mul(s)).add(axis.mul(dot(axis, dir)).mul(float(1.0).sub(c))).toVar();
        const dark = U.stars.mul(smoothstep(0.01, 0.14, up));
        // A star is a point: its spot is about a buffer pixel across whatever the lens (a few
        // tenths of a milliradian at least), so brightness, not size, says which stars are bright.
        // A spot a fixed angle wide drew every star as a disc several pixels across, the sky as snow.
        const spot = max(U.pixelAngle.mul(TUNE.starSpot), 0.00032).toVar();
        const fall = float(-0.5).div(spot.mul(spot)).toVar();
        const starLayer = (scale, power, gain, chance) => {
            const p = q.mul(scale);
            const cell = floor(p);
            const h = hash33(cell).toVar();
            const star = normalize(cell.add(h.mul(0.56).add(0.22)));
            const off = q.sub(star);
            const bright = h.y.pow(power).mul(smoothstep(chance, chance + 0.1, h.x));
            const twinkle = sin(U.time.mul(h.x.mul(1.7).add(0.6)).add(h.z.mul(40.0))).mul(0.3).add(0.7);
            const tint = mix(vec3(1.0, 0.82, 0.64), vec3(0.72, 0.84, 1.0), fract(h.z.mul(7.31)));
            return tint.mul(exp(dot(off, off).mul(fall)).mul(bright).mul(twinkle).mul(gain));
        };
        // The bright few, the many, and a dust of faint ones that gives the dark its depth.
        const stars = starLayer(44.0, 9.0, TUNE.starGain[0], 0.4)
            .add(starLayer(105.0, 6.0, TUNE.starGain[1], 0.4))
            .add(starLayer(190.0, 4.0, TUNE.starGain[2], 0.3))
            .toVar();
        if (o.milky) {
            const pole = vec3(0.42, -0.70, -0.58);
            const off = dot(q, pole).toVar();
            const along = atan(dot(q, vec3(0.62, 0.66, -0.35)), dot(q, vec3(-0.66, 0.27, -0.70))).toVar();
            const core = exp(along.sub(0.25).pow2().mul(-1.8));
            const clot = texture(noise, vec2(along.mul(0.42), off.mul(1.6).add(0.31))).toVar();
            const lane = smoothstep(0.42, 0.78, texture(noise, vec2(along.mul(0.83).add(0.2), off.mul(2.4))).b);
            const width = core.mul(9.0).sub(17.0);
            const band = exp(off.mul(off).mul(width)).mul(clot.r.mul(1.1).add(0.25)).mul(core.mul(1.6).add(0.55))
                .mul(float(1.0).sub(lane.mul(exp(off.mul(off).mul(-70.0))).mul(0.85)));
            const coreLight = exp(off.mul(off).mul(-90.0)).mul(clot.b).add(core.mul(0.4));
            const glow = mix(vec3(0.28, 0.34, 0.6), vec3(0.7, 0.58, 0.48), coreLight);
            sky.addAssign(glow.mul(band).mul(0.09).mul(dark).mul(U.milky));
            stars.mulAssign(band.mul(U.milky).mul(2.2).add(1.0));
        }
        sky.addAssign(stars.mul(dark));
    }

    // ── The cloud deck, lit from beneath by the far coast's glow ──
    if (o.slices > 0) {
        const n = o.slices;
        const range = float(1.0).div(up.add(TUNE.deckCurve)).toVar();
        const plane = dir.xz.mul(range).toVar();
        const street = vec2(0.42, -0.91);
        const cross = vec2(street.y.negate(), street.x);
        const coords = (height) => vec2(dot(plane, street).mul(TUNE.deckAlong), dot(plane, cross).mul(TUNE.deckAcross))
            .mul(height).add(U.drift);
        const mid = coords(1.0 + TUNE.deckThick * 0.5).toVar();
        const patch = texture(noise, mid.mul(0.21).add(vec2(0.13, 0.57))).b;
        const broad = texture(noise, mid.mul(0.47).add(vec2(0.71, 0.29))).r;
        const coverHere = U.cover.add(patch.sub(0.5).mul(TUNE.deckPatch));
        const need = float(TUNE.deckBase).sub(coverHere.mul(TUNE.deckCover)).toVar();
        const torn = o.fine ? texture(noise, mid.mul(3.3).add(U.drift.mul(1.6))).a.sub(0.5).mul(0.13) : float(0.0);
        const field = (at) => texture(noise, at).g.mul(0.56).add(broad.mul(0.5)).add(torn);
        // The glow comes from the far coast: a cloud's side toward it is lit.
        const warmFlat = vec2(dot(U.warmDir.xz, street), dot(U.warmDir.xz, cross)).normalize();
        const lee = field(mid.add(warmFlat.mul(0.012)));
        const here = field(mid).toVar();
        const facing = clamp(here.sub(lee).mul(TUNE.deckEmboss).add(0.5), 0.0, 1.0).toVar();
        // How much of the coast's glow reaches the deck here: most low over the coast.
        const reach = exp(toward.sub(1.0).mul(2.4)).mul(float(1.0).sub(smoothstep(0.05, 0.75, up)).mul(0.75).add(0.25))
            .mul(U.warmth).toVar();
        const transmit = float(1.0).toVar();
        const cloud = vec3(0.0).toVar();
        for (let i = 0; i < n; i += 1) {
            const f = n > 1 ? i / (n - 1) : 0.5;
            const d = i === Math.floor((n - 1) / 2) && n % 2 === 1 ? here : field(coords(1.0 + TUNE.deckThick * f));
            const edge0 = need.add(TUNE.deckTaper * f * f);
            const a = smoothstep(edge0, edge0.add(TUNE.deckSoft), d).toVar();
            const heart = smoothstep(edge0.add(0.1), edge0.add(0.42), d);
            // Lit from beneath: the lowest slices take the glow, the tops stand dark.
            const lit = reach.mul(1.0 - 0.7 * f).mul(facing.mul(0.6).add(0.4)).mul(float(1.0).sub(heart.mul(0.45)));
            const colour = mix(light.cloudShade, light.cloudLit, clamp(lit, 0.0, 1.4));
            cloud.addAssign(colour.mul(a).mul(transmit));
            transmit.mulAssign(float(1.0).sub(a));
        }
        const cover = float(1.0).sub(transmit).toVar();
        const fog = float(1.0).sub(exp(range.mul(-TUNE.deckFog)));
        const slot = smoothstep(TUNE.deckSlot[0], TUNE.deckSlot[1], dir.y);
        const seen = cover.mul(slot).mul(float(1.0).sub(fog.mul(0.45)));
        const aired = mix(cloud.div(max(cover, 1e-3)), base, fog.mul(0.6));
        sky.assign(mix(sky, aired.mul(U.squallDim), seen));
    }

    // ── The far coast, low on the horizon on the left, and its lamps ──
    if (o.coast) {
        const bearing = bearingOf(dir).toVar();
        const elevation = dir.y.mul(1 / DEG).toVar();
        const height = coastHeight(bearing, noise).toVar();
        const land = float(1.0).sub(smoothstep(height.sub(0.03), height.add(0.03), elevation)).mul(step0(height));
        const shade = horizonHaze(dir, U).mul(0.42);
        sky.assign(mix(sky, shade, land));
        if (o.lamps !== false) {
            sky.addAssign(coastLamps(bearing, elevation, U, height, float(0.0)).mul(land.mul(0.85).add(0.15)));
        }
    }
    return sky.mul(U.squallDim.mul(0.4).add(0.6));
}

// ── Light on the land ───────────────────────────────────────────────────────────────────────

/** Where the sea's light comes from, seen from the land: out to sea and a little below. */
const FIRE_FROM = (() => {
    const v = [SEAWARD.x, -0.45, SEAWARD.z];
    const l = Math.hypot(v[0], v[1], v[2]);
    return Object.freeze(v.map((c) => c / l));
})();

/**
 * The night's light on a surface of the land (a trunk, a frond, a crown of the jungle), scene-
 * linear, before the air between it and the eye: the sky's air from above (the zenith's deep blue
 * on what faces up, the horizon's paler band on what faces out), the far coast's warm glow on what
 * turns toward it, and the sea's blue fire from out and below on the seaward faces, strongest low
 * down and near the water and flaring with the bay. Then the sky behind wraps the edges.
 *   N       unit normal on the side the eye sees       V      unit toward the eye
 *   albedo  how much of that light the surface keeps   lift   metres over the sand
 *   reach   metres from the water's edge              rim    how much the sky wraps (0..1)
 */
export function landLight(N, V, albedo, lift, reach, rim, U) {
    const { light } = U;
    const up = N.y.mul(0.5).add(0.5);
    const sky = mix(light.horizon, light.mid, up).mul(up.mul(0.5).add(0.5)).mul(U.squallDim);
    const warm = light.warm.mul(U.warmth).mul(max(dot(N, U.warmDir), 0.0));
    const facing = max(dot(N, vec3(FIRE_FROM[0], FIRE_FROM[1], FIRE_FROM[2])).mul(0.7).add(0.3), 0.0);
    const fire = light.glow.mul(U.glowPower).mul(facing)
        .mul(exp(lift.mul(-0.11)))
        .mul(exp(max(reach, 0.0).mul(-0.045)))
        .mul(U.bayBloom.mul(3.0).add(1.0));
    const lit = sky.mul(TUNE.landSky).add(warm.mul(TUNE.landWarm)).add(fire.mul(TUNE.landFire));
    const edge = float(1.0).sub(abs(dot(N, V))).toVar();
    const wrap = skyBase(V.negate(), U).mul(U.squallDim).mul(edge.mul(edge).mul(edge)).mul(rim.mul(TUNE.landRim));
    return albedo.mul(lit).add(wrap);
}

/**
 * How much of the air lies between the eye and a point of the land `dist` metres away (0..0.95):
 * the night's long haze and the sea's own (U.haze).
 */
export function landHaze(dist, U) {
    return float(1.0).sub(exp(dist.div(-TUNE.hazeReach * 0.32))).mul(0.85)
        .add(float(1.0).sub(exp(dist.mul(U.haze).mul(-0.012))).mul(0.5))
        .min(0.95);
}

/**
 * The share of rough water's facets that mirror a light along L, seen along V (per unit of the
 * light): the road a lamp lays on the water.
 */
export function glintLobe(slope, variance, V, L) {
    const H = normalize(L.add(V)).toVar();
    const want = H.xz.negate().div(max(H.y, 0.08));
    const miss = want.sub(slope);
    const s2 = max(variance, TUNE.glintFloor);
    const share = exp(dot(miss, miss).div(s2.mul(-2.0))).div(s2.mul(6.2832));
    const h2 = max(H.y, 0.35).pow2();
    const geometry = float(1.0).div(max(V.y, 0.045).mul(4.0).mul(h2.mul(h2)));
    const cosine = clamp(dot(V, H), 0.0, 1.0);
    const m = float(1.0).sub(cosine);
    const m2 = m.mul(m);
    const fresnel = float(0.02).add(m2.mul(m2).mul(m).mul(0.98));
    return share.mul(geometry).mul(fresnel);
}

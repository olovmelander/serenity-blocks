/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Sunset — shared TSL: the sky of the hour as a function of a direction.
 *
 * The whole distance is ONE function, `skyColour(dir, …)`: the air's three bands in the hour's
 * colours, the sun and the moon with their glows, the stars and the Milky Way, the high cirrus,
 * the long bars of cloud low over the sea and the cloud deck that runs in over the eye's head.
 * The dome draws it along the view ray; the sea calls it again along its mirror ray (with fewer
 * layers: moving water smears what it mirrors). Nothing is rendered twice and nothing is loaded.
 *
 * The cloud deck is drawn in relief: a few slices of one noise field at rising heights, composed
 * from the lowest up as the eye meets them. A slice further up is seen a little further off, so
 * toward the horizon the sides and tops of the clouds come into view over their bases. By day
 * the tops take the light; with the sun on the horizon the bases do (`fire`), and the tops stand
 * dark against them.
 *
 * These builders read uniforms and a texture, so they are inline (called inside a material's
 * Fn), never laid-out functions.
 */
import * as THREE from 'three/webgpu';
import {
    If, abs, atan, clamp, cos, dot, exp, float, floor, fract, length, log2, max, min, mix, normalize, sin, smoothstep,
    sqrt, step, texture, vec2, vec3, vec4,
} from 'three/tsl';
import { bakeSeaNoise, bakeSkyNoise } from './sunset-core.js';
import { HOUR_COLOURS, MOON_PHASE } from './sunset-hours.js';

/**
 * The look's numbers, in one place. The playground can override any of them from the URL
 * (`P.<name>=<value>`) before the world is built; the theme ships these.
 */
export const TUNE = {
    // The air: how fast the horizon's band and the belt over it fall away with height.
    horizonFall: 9.5,
    beltFall: 2.7,
    // How narrowly the sun's colour hangs round it along the horizon (1 - cos of the bearing).
    horizonLobe: 2.6,
    midLobe: 1.5,
    // The sun: its wide glow, its tight one.
    bloomTight: 24,
    aureoleTight: 300,
    // The cloud deck.
    deckCurve: 0.105, // softens the horizon: the deck's plane is dir.xz / (dir.y + deckCurve)
    deckAlong: 0.046, // noise tiles per deck height, along the street
    deckAcross: 0.098, // …and across it
    deckThick: 0.2, // the deck's thickness, as a share of its height
    deckTaper: 0.13, // how much a cloud narrows toward its top
    deckBase: 0.86, // the density a clear sky needs before a cloud forms…
    deckCover: 0.66, // …and how far full cover lowers it
    deckPatch: 0.95, // how strongly the large patches open and close the deck
    deckSoft: 0.15, // the softness of a cloud's edge
    deckEmboss: 6.5, // how hard the light models a cloud's side
    deckSlot: [0.02, 0.1], // the clear slot over the horizon: the deck fades in between these heights
    deckFog: 0.15, // the air between the eye and a far cloud
    // The bars of cloud low over the sea.
    barBearing: 0.36,
    barHeight: 6.2,
    barCover: [0.53, 0.7],
    barSpan: [0.008, 0.045, 0.14, 0.26],
    // Cirrus.
    cirrusCurve: 0.24,
    cirrusScale: [0.019, 0.085],
    cirrusCover: [0.5, 0.86],
    // The sea.
    glint: 0.02, // the sun's road: overall strength
    glintFloor: 0.0009, // the smallest slope variance a pixel is given (the sharpest glint)
    sparkle: 22, // the diamonds in the road near the eye
    hazeReach: 2600, // metres: the air over the sea
    ripple: [0.22, 0.26, 0.24], // slope of the three ripple layers
    rippleTile: [23, 6.1, 1.7], // metres a tile of each layer spans
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
    return noiseTexture(bakeSkyNoise(size), size, 'sunset-sky-noise');
}

/** The water's noise field as a texture, and the slope variance its bytes carry. */
export function createSeaNoise(size) {
    const { data, variance } = bakeSeaNoise(size);
    return { map: noiseTexture(data, size, 'sunset-sea-noise'), variance };
}

/**
 * The hour's colours as nodes: one uniform row each (sunset-hours.js HOUR_COLOURS), which the
 * world rewrites as the hour turns. `rows` is a uniformArray of vec4.
 */
export function createLight(rows) {
    return Object.freeze(Object.fromEntries(HOUR_COLOURS.map((name, i) => [name, rows.element(i).xyz])));
}

const hash21 = (p) => fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453));
const hash22 = (p) => fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))).mul(43758.5453));
const hash33 = (p) => fract(sin(vec3(
    dot(p, vec3(127.1, 311.7, 74.7)),
    dot(p, vec3(269.5, 183.3, 246.1)),
    dot(p, vec3(113.5, 271.9, 124.6)),
)).mul(43758.5453));

/**
 * The air alone: the hour's three bands along a direction (its height taken as given, so the sea
 * can ask for the colour of the horizon it fades into). No sun, no cloud.
 */
export function skyBase(dir, U) {
    const { light } = U;
    const up = max(dir.y, 0.0);
    const level = normalize(vec3(dir.x, 0.0, dir.z).add(vec3(0.0, 0.0, 1e-4)));
    const sunLevel = normalize(vec3(U.sun.x, 0.0, U.sun.z).add(vec3(0.0, 0.0, 1e-4)));
    const around = dot(level, sunLevel).sub(1.0);
    const toward = clamp(dot(dir, U.sun).mul(0.5).add(0.5), 0.0, 1.0);
    const zenith = mix(light.zenithFar, light.zenithSun, toward);
    const mid = mix(light.midFar, light.midSun, exp(around.mul(TUNE.midLobe)));
    const horizon = mix(light.horizonFar, light.horizonSun, exp(around.mul(TUNE.horizonLobe)));
    const h1 = exp(up.mul(-TUNE.horizonFall));
    const h2 = exp(up.mul(-TUNE.beltFall));
    return zenith.add(mid.sub(zenith).mul(h2)).add(horizon.sub(mid).mul(h1));
}

/**
 * The air over the far sea along a direction: the horizon band seen level, the sun's and the
 * moon's wide glows in it. The sea fades into this with distance, and the dome draws it under
 * the horizon, so the two meet without a seam.
 */
export function horizonHaze(dir, U) {
    const { light } = U;
    const level = normalize(vec3(dir.x, 0.0, dir.z));
    const away = min(dot(level, U.sun).sub(1.0), 0.0);
    const awayMoon = min(dot(level, U.moon).sub(1.0), 0.0);
    return skyBase(level, U)
        .add(exp(away.mul(TUNE.bloomTight)).mul(light.sunBloom))
        .add(exp(awayMoon.mul(34.0)).mul(light.moonGlow).mul(U.moonUp));
}

/** The moon's seas as seen with the naked eye, north up: [x, y, half-width, half-height, depth]. */
const MARIA = [
    [-0.32, 0.38, 0.28, 0.24, 1.0], // Imbrium
    [0.18, 0.4, 0.17, 0.16, 1.0], // Serenitatis
    [0.36, 0.1, 0.2, 0.17, 1.0], // Tranquillitatis
    [0.66, 0.28, 0.1, 0.12, 1.0], // Crisium
    [0.55, -0.12, 0.13, 0.17, 0.9], // Fecunditatis
    [0.36, -0.3, 0.1, 0.1, 0.8], // Nectaris
    [-0.62, 0.05, 0.22, 0.44, 0.85], // Oceanus Procellarum
    [-0.36, -0.16, 0.18, 0.15, 0.65], // Cognitum
    [-0.14, -0.36, 0.17, 0.14, 0.85], // Nubium
    [-0.5, -0.42, 0.1, 0.1, 0.9], // Humorum
    [0.0, 0.72, 0.4, 0.07, 0.8], // Frigoris
    [0.0, 0.18, 0.12, 0.09, 0.75], // Vaporum, Medii
];

/** A body's disc: vec3(how much of the pixel it covers, 0 at its heart to 1 at its limb, height on it). */
function discOf(dir, body, right, upAxis, size, squash, wobble) {
    const u = dot(dir, right).add(wobble);
    const v = dot(dir, upAxis).div(squash);
    const r = length(vec2(u, v)).div(size);
    const inFront = step(0.0, dot(dir, body));
    return vec3(float(1.0).sub(smoothstep(0.94, 1.03, r)).mul(inFront), r, v.div(size));
}

/**
 * The sky along a unit direction (dir.y >= 0), scene-linear, in the hour's light.
 *
 * @param {object} dir     vec3 node
 * @param {object} U       the world's uniforms (sunset-world.js)
 * @param {object} noise   the sky's noise texture
 * @param {object} o
 * @param {number} o.slices    slices the cloud deck is drawn in (0: no deck)
 * @param {boolean} o.fine     the deck's torn edges
 * @param {boolean} o.cirrus   the high cloud
 * @param {boolean} o.bars     the bars low over the sea
 * @param {boolean} o.discs    the sun's and the moon's own discs (off for a mirror image: the
 *                             sea draws their roads itself)
 * @param {boolean} o.stars    the stars
 * @param {boolean} o.milky    the Milky Way
 */
export function skyColour(dir, U, noise, o) {
    const { light } = U;
    const up = max(dir.y, 0.0).toVar();
    const mu = dot(dir, U.sun).toVar();
    const toward = clamp(mu.mul(0.5).add(0.5), 0.0, 1.0).toVar();
    const t2 = toward.mul(toward).toVar();
    const t4 = t2.mul(t2).toVar();
    const base = skyBase(dir, U).toVar();

    // ── The sun's glows, and the moon's ──
    const away = min(mu.sub(1.0), 0.0);
    const sky = base.add(exp(away.mul(TUNE.bloomTight)).mul(light.sunBloom)).toVar();
    const muMoon = dot(dir, U.moon).toVar();
    const awayMoon = min(muMoon.sub(1.0), 0.0);
    const { moonUp } = U; // 0..1: how much of the moon is over the sea
    sky.addAssign(exp(awayMoon.mul(34.0)).mul(light.moonGlow).mul(moonUp));
    if (o.discs) {
        sky.addAssign(exp(away.mul(TUNE.aureoleTight)).mul(light.sunAureole).mul(U.flare.mul(1.6).add(1.0)));
        sky.addAssign(exp(away.mul(TUNE.bloomTight * 2.5)).mul(light.sunBloom).mul(U.flare.mul(1.2)));
        sky.addAssign(exp(awayMoon.mul(700.0)).mul(light.moonGlow).mul(moonUp).mul(2.2));
    }

    // ── The discs, where they cover the sky: nothing behind them shows through ──
    const sunD = discOf(dir, U.sun, U.sunRight, U.sunTop, U.sunSize, U.sunSquash, o.discs
        ? sin(dot(dir, U.sunTop).mul(1400.0).add(U.time.mul(2.3))).mul(0.00028).mul(U.sunLow)
        : float(0.0)).toVar();
    const moonD = discOf(dir, U.moon, U.moonRight, U.moonTop, U.moonSize, U.moonSquash, float(0.0)).toVar();
    const behindDiscs = o.discs ? float(1.0).sub(max(sunD.x.mul(U.sunUp), moonD.x.mul(moonUp))) : float(1.0);

    // ── Stars and the Milky Way: behind everything ──
    if (o.stars) {
        // The night sky turns with the hours about its pole, behind the eye and 35 degrees up, so
        // in front of the eye the stars come up on the right and go down on the left as the sun
        // and the moon do. `q` is the direction fixed to the sky.
        const c = cos(U.starTurn);
        const s = sin(U.starTurn);
        const axis = vec3(0.0, 0.5736, 0.8192);
        const q = dir.mul(c).add(axis.cross(dir).mul(s)).add(axis.mul(dot(axis, dir)).mul(float(1.0).sub(c))).toVar();
        const dark = U.stars.mul(smoothstep(0.012, 0.16, up)).mul(behindDiscs);
        // Stars on a 3D lattice: each cell holds one, put back on the sphere, so no part of the
        // sky has its stars stretched (a grid in latitude and longitude does that near its pole).
        const starLayer = (scale, power, gain) => {
            const p = q.mul(scale);
            const cell = floor(p);
            const h = hash33(cell).toVar();
            const star = normalize(cell.add(h.mul(0.56).add(0.22)));
            const off = q.sub(star).mul(scale);
            const bright = h.y.pow(power).mul(smoothstep(0.4, 0.5, h.x));
            const twinkle = sin(U.time.mul(h.x.mul(1.7).add(0.6)).add(h.z.mul(40.0))).mul(0.3).add(0.7);
            const tint = mix(vec3(1.0, 0.8, 0.6), vec3(0.72, 0.84, 1.0), fract(h.z.mul(7.31)));
            return tint.mul(exp(dot(off, off).mul(-150.0)).mul(bright).mul(twinkle).mul(gain));
        };
        const stars = starLayer(44.0, 7.0, 4.0).add(starLayer(105.0, 5.0, 0.9)).toVar();
        if (o.milky) {
            // A band of light along a great circle of the sky, clotted and split by dust: at
            // midnight it stands across the picture as below; the hours wheel it with the stars.
            const m = q;
            const pole = vec3(0.56, -0.628, -0.541);
            const off = dot(m, pole).toVar();
            const along = atan(dot(m, vec3(0.526, 0.773, -0.353)), dot(m, vec3(-0.64, 0.087, -0.763))).toVar();
            const core = exp(along.sub(0.35).pow2().mul(-2.2));
            const clot = texture(noise, vec2(along.mul(0.42), off.mul(1.6).add(0.31))).toVar();
            const lane = smoothstep(0.42, 0.78, texture(noise, vec2(along.mul(0.83).add(0.2), off.mul(2.4))).b);
            const width = core.mul(9.0).sub(17.0);
            const band = exp(off.mul(off).mul(width)).mul(clot.r.mul(1.1).add(0.25)).mul(core.mul(1.6).add(0.55))
                .mul(float(1.0).sub(lane.mul(exp(off.mul(off).mul(-70.0))).mul(0.85)));
            const coreLight = exp(off.mul(off).mul(-90.0)).mul(clot.b).add(core.mul(0.4));
            const glow = mix(vec3(0.3, 0.36, 0.6), vec3(0.72, 0.56, 0.46), coreLight);
            sky.addAssign(glow.mul(band).mul(0.11).mul(dark));
            stars.mulAssign(band.mul(2.4).add(1.0));
        }
        sky.addAssign(stars.mul(dark));
    }

    // ── The discs ──
    if (o.discs) {
        const limb = sqrt(max(float(1.0).sub(sunD.y.mul(sunD.y)), 0.0));
        // Its lower limb reddens as it comes down into the thick air (or climbs out of it).
        const ember = mix(vec3(1.0), vec3(1.0, 0.6, 0.36), U.sunLow.mul(smoothstep(0.5, -1.0, sunD.z)));
        // It darkens toward its limb, blue most: a bright gold heart in a deeper rim.
        const darkening = vec3(1.0).sub(vec3(0.46, 0.6, 0.76).mul(float(1.0).sub(limb)));
        sky.addAssign(light.sunDisc.mul(ember).mul(darkening).mul(U.sunPower).mul(sunD.x));
        // The green flash: for a breath the last of the upper limb burns green, a thin rim and a
        // sliver lifted clear of it (four lines, a perfect clear, while the sun is low).
        const rim = smoothstep(0.74, 0.96, sunD.y).mul(float(1.0).sub(smoothstep(1.0, 1.14, sunD.y)))
            .mul(smoothstep(0.25, 0.8, sunD.z));
        const sliver = exp(sunD.z.sub(1.2).div(0.07).pow2().negate())
            .mul(exp(dot(dir, U.sunRight).div(U.sunSize).div(0.5).pow2()
                .negate()));
        sky.assign(mix(sky, vec3(0.12, 3.8, 0.95), clamp(rim.add(sliver.mul(0.9)), 0.0, 1.0).mul(U.green)));

        // The moon: a sphere lit from the sun's side of it (a gibbous moon, its shadow on the
        // limb away from the sun, wherever the sun is), its seas and bright craters on a face
        // that turns as it crosses the sky. Light ADDED to the air in front of it: by day it is
        // a pale ghost, by night the brightest thing there.
        If(moonD.x.mul(moonUp).greaterThan(0.0), () => {
            const p = vec2(dot(dir, U.moonRight), dot(dir, U.moonTop).div(U.moonSquash)).div(U.moonSize).toVar();
            const sphere = vec3(p, sqrt(max(float(1.0).sub(dot(p, p)), 0.0))).toVar();
            const sunward = normalize(vec2(dot(U.sun, U.moonRight), dot(U.sun, U.moonTop)).add(vec2(1e-4, 0.0)))
                .toVar();
            const phase = MOON_PHASE * (Math.PI / 180);
            const texels = noise.image?.width ?? 256;
            const lod = (scale) => max(log2(U.pixelAngle.mul(scale * texels).div(U.moonSize)), 0.0);
            const ndl = dot(sphere, vec3(sunward.mul(Math.sin(phase)), Math.cos(phase))).toVar();
            // Its face, turned.
            const ct = cos(U.moonTilt);
            const st = sin(U.moonTilt);
            const f = vec2(p.x.mul(ct).sub(p.y.mul(st)), p.x.mul(st).add(p.y.mul(ct))).toVar();
            const fSun = vec2(sunward.x.mul(ct).sub(sunward.y.mul(st)), sunward.x.mul(st).add(sunward.y.mul(ct)));
            let seas = float(0.0);
            MARIA.forEach(([x, y, w, h, depth]) => {
                const reach = f.x.sub(x).div(w).pow2().add(f.y.sub(y).div(h).pow2());
                seas = seas.add(exp(reach.negate()).mul(depth));
            });
            const ragged = texture(noise, f.mul(0.35).add(vec2(0.37, 0.61)), lod(0.35)).r.sub(0.5);
            const mare = smoothstep(0.24, 0.64, seas.add(ragged.mul(0.4))).toVar();
            // The highlands' fine mottle (a fine fBm: no cells, which read as spots).
            const mottle = texture(noise, f.mul(0.9).add(vec2(0.71, 0.27)), lod(0.9)).a;
            // Tycho and its rays, Copernicus, Kepler, Aristarchus: the bright marks of the full moon.
            const tycho = f.sub(vec2(-0.12, -0.68)).toVar();
            const tychoAt = length(tycho).toVar();
            const spoke = atan(tycho.y, tycho.x);
            const streak = texture(noise, vec2(cos(spoke), sin(spoke)).mul(0.8).add(vec2(0.31, 0.77)), float(0.0)).g;
            const rays = smoothstep(0.56, 0.84, streak).mul(exp(tychoAt.mul(-2.4)))
                .mul(smoothstep(0.03, 0.09, tychoAt));
            const spot = (x, y, tight) => exp(dot(f.sub(vec2(x, y)), f.sub(vec2(x, y))).mul(-tight));
            const craters = exp(tychoAt.mul(tychoAt).mul(-900.0)).add(spot(-0.3, 0.16, 1100.0).mul(0.8))
                .add(spot(-0.56, 0.13, 1800.0).mul(0.6)).add(spot(-0.7, 0.38, 2600.0));
            const albedo = float(1.0).sub(mare.mul(0.56)).add(mottle.sub(0.5).mul(0.2)).add(rays.mul(0.24))
                .add(craters.mul(0.45));
            const tint = mix(vec3(1.0, 0.98, 0.95), vec3(0.9, 0.93, 1.0), mare);
            // Relief: along the shadow's edge the craters cast shadows of their own.
            const bumpAt = f.mul(1.7).add(vec2(0.23, 0.41));
            const relief = texture(noise, bumpAt.add(fSun.mul(0.012)), lod(1.7)).a
                .sub(texture(noise, bumpAt, lod(1.7)).a).mul(7.0)
                .mul(float(1.0).sub(smoothstep(0.0, 0.35, ndl)));
            const shade = smoothstep(-0.03, 0.13, ndl).mul(clamp(ndl, 0.0, 1.0).mul(0.3).add(0.7))
                .mul(clamp(relief.add(1.0), 0.4, 1.6));
            // The world's own light on its night side, faint.
            const earthshine = 0.018;
            const moonLimb = sphere.z.mul(0.12).add(0.88);
            const moonLight = light.moonDisc.mul(tint).mul(albedo).mul(moonLimb).mul(shade.add(earthshine))
                .mul(U.moonPower);
            sky.addAssign(moonLight.mul(moonD.x).mul(moonUp));
        });
    }

    // ── Cirrus: high, thin, the last to lose the light ──
    if (o.cirrus) {
        const plane = dir.xz.div(up.add(TUNE.cirrusCurve));
        const along = dot(plane, U.street);
        const across = dot(plane, vec2(U.street.y.negate(), U.street.x));
        const at = vec2(along.mul(TUNE.cirrusScale[0]), across.mul(TUNE.cirrusScale[1])).add(U.drift.mul(0.35));
        const fibre = texture(noise, at).b;
        const comb = texture(noise, at.mul(vec2(2.3, 3.7)).add(vec2(0.43, 0.17))).a;
        const veil = smoothstep(TUNE.cirrusCover[0], TUNE.cirrusCover[1], fibre.mul(0.72).add(comb.mul(0.28)))
            .mul(smoothstep(0.03, 0.2, up)).mul(U.cover.mul(0.9).add(0.2));
        const lit = light.cirrus.mul(toward.mul(0.55).add(0.45)).mul(U.skyFire.mul(0.45).add(1.0));
        sky.assign(mix(sky, lit, veil.mul(0.4)));
    }

    // ── The bars of cloud low over the sea ──
    if (o.bars) {
        const bearing = atan(dir.x, dir.z.negate());
        const at = vec2(bearing.mul(TUNE.barBearing).add(U.drift.x.mul(0.6)), dir.y.mul(TUNE.barHeight).add(0.17));
        const bar = texture(noise, at).b.toVar();
        const under = texture(noise, at.sub(vec2(0.0, 0.035))).b;
        const span = TUNE.barSpan;
        const bars = smoothstep(TUNE.barCover[0], TUNE.barCover[1], bar)
            .mul(smoothstep(span[0], span[1], dir.y))
            .mul(float(1.0).sub(smoothstep(span[2], span[3], dir.y)))
            .mul(U.cover.mul(0.8).add(0.35));
        // Lit along its lower edge by a low sun; a dark body against the bright band behind it.
        const edge = clamp(bar.sub(under).mul(7.0).add(0.35), 0.0, 1.0).mul(U.fire);
        const lit = mix(light.cirrus, light.cloudLit, t4).mul(U.skyFire.mul(0.5).add(1.0));
        const body = mix(light.cloudShade, light.cloudDeep, smoothstep(0.62, 0.82, bar));
        const barColour = mix(body, lit, edge.mul(toward.mul(0.6).add(0.4)));
        sky.assign(mix(sky, mix(barColour, base, 0.22), bars.mul(0.9)));
    }

    // ── The cloud deck, in relief ──
    if (o.slices > 0) {
        const n = o.slices;
        const range = float(1.0).div(up.add(TUNE.deckCurve)).toVar();
        const plane = dir.xz.mul(range).toVar();
        const { street } = U;
        const cross = vec2(street.y.negate(), street.x);
        const coords = (height) => vec2(dot(plane, street).mul(TUNE.deckAlong), dot(plane, cross).mul(TUNE.deckAcross))
            .mul(height).add(U.drift);
        const mid = coords(1.0 + TUNE.deckThick * 0.5).toVar();
        // Slow terms, read once: where there is cloud at all, and the field's broad shape.
        const patch = texture(noise, mid.mul(0.21).add(vec2(0.13, 0.57))).b;
        const broad = texture(noise, mid.mul(0.47).add(vec2(0.71, 0.29))).r;
        const coverHere = U.cover.add(patch.sub(0.5).mul(TUNE.deckPatch));
        const need = float(TUNE.deckBase).sub(coverHere.mul(TUNE.deckCover)).toVar();
        const torn = o.fine ? texture(noise, mid.mul(3.3).add(U.drift.mul(1.6))).a.sub(0.5).mul(0.13) : float(0.0);
        const field = (at) => texture(noise, at).g.mul(0.56).add(broad.mul(0.5)).add(torn);
        // The light's side of a cloud: the field is thinner toward the light there.
        const lee = field(mid.add(U.keyFlat.mul(0.011)));
        const here = field(mid).toVar();
        const facing = clamp(here.sub(lee).mul(TUNE.deckEmboss).add(0.5), 0.0, 1.0).toVar();
        // What the light gives: gold toward the sun, the high cloud's rose away from it.
        const fireReach = clamp(t2.mul(1.25).add(0.12).add(U.skyFire.mul(0.85)), 0.0, 1.0);
        const lit = mix(light.cirrus.mul(0.8), light.cloudLit, fireReach).mul(U.skyFire.mul(1.1).add(1.0)).toVar();
        // Seen low and toward the light, a cloud shows its dark side; overhead, its lit base.
        const against = float(1.0).sub(smoothstep(0.03, 0.26, up)).mul(t4).mul(U.fire)
            .mul(0.85);
        const transmit = float(1.0).toVar();
        const cloud = vec3(0.0).toVar();
        for (let i = 0; i < n; i += 1) {
            const f = n > 1 ? i / (n - 1) : 0.5;
            const d = i === Math.floor((n - 1) / 2) && n % 2 === 1 ? here : field(coords(1.0 + TUNE.deckThick * f));
            const edge0 = need.add(TUNE.deckTaper * f * f);
            const a = smoothstep(edge0, edge0.add(TUNE.deckSoft), d).toVar();
            const heart = smoothstep(edge0.add(0.1), edge0.add(0.42), d);
            // By day a cloud's top takes the light; with the sun on the horizon its base does.
            const reach = mix(float(0.42 + 0.58 * f), float(1.0 - 0.72 * f), U.fire);
            const darkens = mix(float(1.0 - 0.5 * f), float(0.35 + 0.65 * f), U.fire);
            const body = mix(light.cloudShade, light.cloudDeep, heart.mul(darkens));
            const amount = facing.mul(reach).mul(float(1.0).sub(heart.mul(0.6))).mul(fireReach.mul(0.55).add(0.45))
                .mul(float(1.0).sub(against))
                .mul(U.skyFire.mul(0.5).add(1.0));
            const colour = mix(body, lit, amount);
            cloud.addAssign(colour.mul(a).mul(transmit));
            transmit.mulAssign(float(1.0).sub(a));
        }
        const cover = float(1.0).sub(transmit).toVar();
        // The lining: thin cloud seen against the sun (or the moon) burns.
        const thin = cover.mul(transmit).mul(4.0);
        const lining = light.cloudRim.mul(exp(away.mul(9.0)).mul(U.sunUp))
            .add(light.cloudRim.mul(exp(awayMoon.mul(16.0)).mul(moonUp).mul(U.moonKey)));
        cloud.addAssign(lining.mul(thin).mul(against.mul(0.9).add(0.3)));
        // The air between: far cloud goes to the colour of the sky behind it, and the deck
        // leaves a clear slot over the horizon.
        const fog = float(1.0).sub(exp(range.mul(-TUNE.deckFog)));
        const slot = smoothstep(TUNE.deckSlot[0], TUNE.deckSlot[1], dir.y);
        const seen = cover.mul(slot).mul(float(1.0).sub(fog.mul(0.42)));
        const behind = base.add(light.sunBloom.mul(exp(away.mul(TUNE.bloomTight))));
        const aired = mix(cloud.div(max(cover, 1e-3)), behind, fog.mul(0.62));
        sky.assign(mix(sky, aired, seen));
    }

    // ── A halo round the light (a clear): prismatic, red on its inner edge ──
    const across = dot(dir, U.pulseDir).sub(U.pulse.x).div(U.pulse.y).toVar();
    const band = exp(across.mul(across).negate()).mul(U.pulse.z);
    const prism = mix(vec3(0.62, 0.78, 1.0), vec3(1.0, 0.42, 0.16), smoothstep(-1.2, 1.2, across));
    sky.addAssign(prism.mul(band).mul(mix(light.cloudRim, light.moonGlint.mul(1.15), U.moonKey).mul(0.16)));
    return sky;
}

/** The sun's road on rough water, per unit of the sun's light: the share of facets that mirror it. */
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
    return vec4(share.mul(geometry).mul(fresnel), exp(dot(miss, miss).div(s2.mul(-5.0))), 0.0, 0.0);
}

export { abs, hash21, hash22 };

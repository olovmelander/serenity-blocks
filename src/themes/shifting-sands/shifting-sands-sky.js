/**
 * Shifting Sands — the sky dome: one opaque BackSide sphere shaded per pixel by view direction.
 *
 *  - the shared atmosphere gradient (hot apricot band toward the suns → dusty rose away from
 *    them → violet upper sky → deep blue zenith) and the suns' Mie glow, which outlasts them:
 *    after a sunset the air where the sun went down keeps burning (uGlowA / uGlowB);
 *  - faint crepuscular rays fanning from the primary sun (longer and brighter as play heats:
 *    uHeat.w, the burn);
 *  - the stars: a few at golden hour, a field of them by night, each with its own colour and a
 *    slow twinkle, and the star river — a band of unresolved light with bright clouds and a dark
 *    rift down its middle — standing over the bearing the suns set on;
 *  - the two moons: shaded spheres lit by the primary sun (thick crescents, the dark limb faintly
 *    lit by dust-glow), veiled by the haze by day and standing bright by night;
 *  - high cirrus on an altitude plane, in wisps gathered into drifts (a slow warp bends the
 *    fibres), lit gold-pink from below near the suns and dusky mauve away from them;
 *  - dust bars: thin strata of high dust low over the suns' bearing, dark against the suns' own
 *    glow with a burning edge, rose-gold further out; the sinking ember passes down behind them;
 *  - the twin suns: an ember-gold primary whose heart passes the tone curve's whitening point and
 *    whose rim melts into its glow (lower limb reddened, squashed a little by refraction, veiled
 *    where a dust bar crosses it), and a white-hot companion that turns gold as it nears the
 *    horizon in its turn; a flare (uSunFlare) swells both discs and widens the ember's corona.
 *
 * Drawn after the opaque world (renderOrder) with depthWrite off, so early-z rejects every pixel
 * the dunes, rocks and worm already cover: the sky only pays for the sky it shows.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    If,
    abs,
    atan,
    cameraPosition,
    clamp,
    cross,
    dot,
    exp,
    float,
    floor,
    fract,
    fwidth,
    length,
    max,
    mix,
    normalize,
    positionWorld,
    smoothstep,
    sqrt,
    uniformArray,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { dirFromAzEl } from './shifting-sands-composition.js';
import { ssHash21, ssPhaseHG, ssTexNoise } from './shifting-sands-tsl.js';
import { METEORS, WALL } from './shifting-sands-weather.js';

export const SKY_RADIUS = 20000;

/**
 * The suns' own discs (scene-linear). The ember's heart is bright enough to pass the tone curve's
 * whitening point (it reads cream-gold) while its rim falls to an orange that melts into the glow.
 */
const SUN_A_CORE = vec3(1.0, 0.62, 0.2);
const SUN_A_LIMB = vec3(1.0, 0.4, 0.09);
const SUN_A_POWER = 12.0;
const SUN_B_CORE = vec3(1.0, 0.9, 0.74);
/** The white sun low in the thick air: it sets gold, as the ember did before it. */
const SUN_B_LOW = vec3(1.0, 0.56, 0.2);
const SUN_B_POWER = 22.0;

/** Bearing (radians) the dust bars gather over: between the two suns. */
const SUN_BEARING = (-28.5 * Math.PI) / 180;
const DUST_BARS_SPAN = (34 * Math.PI) / 180;
/** el: sine of the bar's height; half: its half-thickness; wob: how far it wavers; gap: where it breaks. */
const DUST_BARS = Object.freeze([
    {
        el: 0.066, half: 0.0085, wob: 0.008, gap: 0.36, dens: 0.72,
    },
    {
        el: 0.118, half: 0.0055, wob: 0.012, gap: 0.46, dens: 0.58,
    },
]);

/**
 * The star river: a great circle through two directions of the sky, rising from the horizon left
 * of the suns' bearing and leaning over the bearing they set on, so that by night it stands over
 * the last of the afterglow. `core` is where along it the bright bulge lies.
 */
export const STAR_RIVER = Object.freeze({
    foot: Object.freeze({ az: -47, el: 0 }),
    over: Object.freeze({ az: -17, el: 24 }),
    halfWidth: 0.15,
});

function starRiverFrame() {
    const a = dirFromAzEl(STAR_RIVER.foot.az, STAR_RIVER.foot.el);
    const b = dirFromAzEl(STAR_RIVER.over.az, STAR_RIVER.over.el);
    const pole = new THREE.Vector3().crossVectors(a, b).normalize();
    const along = new THREE.Vector3().crossVectors(pole, a).normalize();
    return { pole, foot: a, along };
}

/** Half the length of the wall of dust along the horizon (radians). */
const WALL_HALF = (WALL.half * Math.PI) / 180;
/** Falling stars that can cross the sky at once. */
export const METEOR_SLOTS = 2;

/** A shaded moon disc at direction M with angular radius r (radians). Returns vec4(rgb, mask). */
function moonDisc(dir, M, r, uSunA, noiseTex, seed) {
    const c = dot(dir, M);
    const perp = dir.sub(M.mul(c));
    const t = perp.div(r);
    const t2 = dot(t, t);
    const edge = fwidth(t2).add(1e-4);
    const mask = float(1.0).sub(smoothstep(float(1.0).sub(edge.mul(1.5)), float(1.0).add(edge), t2))
        .mul(smoothstep(0.0, 0.2, c));
    const n = normalize(t.sub(M.mul(sqrt(max(float(1.0).sub(t2), 0.0)))));
    const lit = clamp(dot(n, uSunA).mul(1.6), 0.0, 1.0);
    // Maria: two noise channels on the disc.
    const m = ssTexNoise(noiseTex, t.xy.add(t.z).mul(2.6).add(seed));
    const maria = smoothstep(0.35, 0.65, m.x.mul(0.7).add(m.y.mul(0.3)));
    const albedo = mix(vec3(0.62, 0.55, 0.48), vec3(0.86, 0.8, 0.7), maria);
    const limb = mix(0.75, 1.0, sqrt(max(float(1.0).sub(t2), 0.0)));
    const col = albedo.mul(lit.mul(limb).mul(1.9).add(0.02));
    return vec4(col, mask);
}

/**
 * @param {object} shared world uniforms + atmosphere + noise texture
 * @param {object} opts
 * @param {boolean} [opts.clouds=true]
 * @param {boolean} [opts.stars=true]   the night's own sky: the faint many, the star river, falling stars
 * @param {boolean} [opts.fineClouds=true] the cloud deck's fine tatters (one more texture read)
 * @param {THREE.Vector3} opts.moonA / opts.moonB directions; opts.moonRadA/moonRadB (radians)
 * @param {number} opts.sunRadA / opts.sunRadB  angular radii (radians)
 */
export function createSky(shared, opts) {
    const {
        uTime, uSunA, uSunB, uGlowA, uGlowB, uDusk, uNight, uMoonGain, uMoonLight, uSunFlare, uHeat,
        uUpper, uHorizonWarm, uHorizonCool, atmosphere, noiseTex, uWindDir, uWeather, uWall,
    } = shared;
    // Falling stars: where each starts (xyz) and when (w); where it ends (xyz) and how bright (w).
    const meteorRows = (w) => Array.from({ length: METEOR_SLOTS }, () => new THREE.Vector4(0, 1, 0, w));
    const uMeteorFrom = uniformArray(meteorRows(-100), 'vec4');
    const uMeteorTo = uniformArray(meteorRows(0), 'vec4');
    const METEOR_LIFE = METEORS.life;
    const clouds = opts.clouds !== false;
    const stars = opts.stars !== false;
    // The deck's fine tatters are a texture read of their own: the lighter tiers go without.
    const fineClouds = opts.fineClouds !== false;
    const { uMoonA } = opts;
    const { uMoonB } = opts;
    const { sunRadA } = opts;
    const { sunRadB } = opts;
    const river = starRiverFrame();
    const RIVER_POLE = vec3(river.pole.x, river.pole.y, river.pole.z);
    const RIVER_FOOT = vec3(river.foot.x, river.foot.y, river.foot.z);
    const RIVER_ALONG = vec3(river.along.x, river.along.y, river.along.z);

    const material = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false });
    material.name = 'shifting-sands-sky';
    material.fog = false;

    material.colorNode = Fn(() => {
        const dir = normalize(positionWorld.sub(cameraPosition)).toVar();
        const el = dir.y;
        const col = atmosphere.skyGradient(dir).toVar();
        // Nothing of the sky's own lights shows below the horizon (the land hides it at rest; a
        // tall frame or a leaning lens must not find a sun under the sand).
        const aboveLand = smoothstep(-0.012, 0.006, el).toVar();

        // ── Crepuscular rays: an angular modulation of the primary sun's glow ──
        const right = normalize(cross(uSunA, vec3(0.0, 1.0, 0.0)));
        const upv = cross(right, uSunA);
        const tp = dir.sub(uSunA.mul(dot(dir, uSunA)));
        const ang = atan(dot(tp, upv), dot(tp, right));
        const rayN = ssTexNoise(noiseTex, vec2(ang.mul(9.0), uTime.mul(0.015)));
        const rays = rayN.x.mul(0.65).add(rayN.y.mul(0.35));
        const cA = dot(dir, uSunA).toVar();
        const burn = uHeat.w;
        // A sun under the horizon still fans its rays up into the afterglow for a while.
        const sunUp = smoothstep(-0.11, 0.02, uSunA.y);
        const rayFall = smoothstep(burn.mul(-0.05).add(0.93), 0.997, cA).mul(smoothstep(-0.04, 0.05, el))
            .mul(float(1.0).sub(smoothstep(burn.mul(0.12).add(0.1), burn.mul(0.2).add(0.3), el)));
        const haze = uWeather.w;
        col.addAssign(uGlowA.mul(smoothstep(0.35, 0.85, rays).mul(rayFall).mul(sunUp)
            .mul(burn.mul(0.055).add(0.035))
            .mul(haze.mul(1.5).add(1.0))));

        // ── The moons (their masks first: no star may shine through a moon) ──
        const veil = smoothstep(0.02, 0.45, el).mul(0.55).add(0.25).mul(uMoonGain)
            .mul(haze.mul(-0.35).add(1.0));
        const mA = moonDisc(dir, uMoonA, opts.moonRadA, uSunA, noiseTex, vec2(3.1, 7.4)).toVar();
        const mB = moonDisc(dir, uMoonB, opts.moonRadB, uSunA, noiseTex, vec2(11.7, 2.9)).toVar();
        const openSky = float(1.0).sub(mA.w).mul(float(1.0).sub(mB.w)).toVar();

        // ── Stars: the bright few on every tier (the night is an hour of its own now); the faint
        // many, the star river and the falling stars where the tier affords them ──
        {
            const bearing = atan(dir.x, dir.z.negate());
            const sp = vec2(bearing, el).mul(160.0).toVar();
            const fw = fwidth(sp.x).add(fwidth(sp.y)).mul(0.5).toVar();
            const lowAir = smoothstep(0.03, 0.42, el).toVar();
            // The bright few: seen from golden hour on.
            const cell = floor(sp);
            const h = ssHash21(cell);
            const off = vec2(ssHash21(cell.add(7.7)), ssHash21(cell.add(13.1))).mul(0.6).add(0.2);
            const dotS = float(1.0).sub(smoothstep(fw.mul(0.5), fw.mul(1.4), length(fract(sp).sub(off))));
            const bright = smoothstep(0.985, 1.0, h).mul(lowAir);
            const tw = float(0.75).add(float(0.25).mul(fract(h.mul(91.7).add(uTime.mul(0.6))).sub(0.5).abs().mul(2.0)));
            // Each its own colour: blue-white, white, pale gold, a few orange.
            const tint = mix(vec3(0.72, 0.82, 1.0), vec3(1.0, 0.8, 0.58), smoothstep(0.35, 0.95, fract(h.mul(57.3))));
            const starry = tint.mul(dotS.mul(bright).mul(tw).mul(uNight.mul(1.25).add(0.02))).toVar();
            // ── The night's own sky: the faint many, and the star river ──
            // (Stars drown in bright air: none in the glow round a sunset.)
            const darkAir = float(1.0).sub(smoothstep(0.04, 0.3, max(col.x, max(col.y, col.z)))).toVar();
            const nightSky = () => {
                const deep = smoothstep(0.35, 0.9, uNight);
                // Where the eye looks along the river there are more stars than it can part.
                const lat = dot(dir, RIVER_POLE);
                const lon = atan(dot(dir, RIVER_ALONG), dot(dir, RIVER_FOOT));
                const w = lat.div(STAR_RIVER.halfWidth);
                const band = exp(w.mul(w).negate());
                const n1 = ssTexNoise(noiseTex, vec2(lon.mul(7.0).add(1.7), lat.mul(11.0).add(4.3)));
                const n2 = ssTexNoise(noiseTex, vec2(lon.mul(23.0).add(9.1), lat.mul(31.0).add(2.2)));
                const cloudy = smoothstep(0.3, 0.82, n1.x.mul(0.62).add(n2.y.mul(0.38)));
                // The rift: dark dust lying along the middle of the river, torn into lengths.
                const riftLine = lat.add(n1.w.sub(0.5).mul(0.05)).div(0.03);
                const rift = exp(riftLine.mul(riftLine).negate())
                    .mul(smoothstep(0.3, 0.62, n1.z.mul(0.6).add(n2.w.mul(0.4))));
                const riverGlow = band.mul(cloudy.mul(0.75).add(0.25)).mul(float(1.0).sub(rift.mul(0.82)));
                // Warm toward the bulge low over the afterglow, blue-white along its arms.
                const bulge = exp(lon.sub(0.22).mul(lon.sub(0.22)).mul(-9.0));
                const riverCol = mix(vec3(0.3, 0.4, 0.82), vec3(0.9, 0.66, 0.5), bulge.mul(0.75));
                col.addAssign(riverCol.mul(riverGlow.mul(bulge.mul(0.7).add(0.6)).mul(deep).mul(lowAir)
                    .mul(openSky)
                    .mul(darkAir)
                    .mul(0.15)));
                // The faint many: a finer field, thick in the river and thin away from it.
                const sp2 = sp.mul(2.3).add(vec2(41.0, 17.0));
                const cell2 = floor(sp2);
                const h2 = ssHash21(cell2.add(3.3));
                const off2 = vec2(ssHash21(cell2.add(21.7)), ssHash21(cell2.add(5.9))).mul(0.6).add(0.2);
                const fw2 = fw.mul(2.3);
                const dot2 = float(1.0).sub(smoothstep(fw2.mul(0.45), fw2.mul(1.2), length(fract(sp2).sub(off2))));
                const many = smoothstep(mix(0.93, 0.74, riverGlow), 1.0, h2).mul(lowAir);
                const beat2 = fract(h2.mul(37.1).add(uTime.mul(0.4))).sub(0.5).abs().mul(2.0);
                const tw2 = float(0.7).add(float(0.3).mul(beat2));
                const tint2 = mix(vec3(0.74, 0.84, 1.0), vec3(1.0, 0.86, 0.7), fract(h2.mul(113.0)));
                starry.addAssign(tint2.mul(dot2.mul(many).mul(tw2).mul(deep).mul(0.5)));
            };
            if (stars) If(uNight.greaterThan(0.35), nightSky);
            col.addAssign(starry.mul(openSky).mul(darkAir).mul(haze.mul(-0.6).add(1.0)).mul(1.4));
            // ── Falling stars: a bright head on a thinning trail, each over in a second and a half ──
            for (let i = 0; stars && i < METEOR_SLOTS; i++) {
                const from = uMeteorFrom.element(i);
                const to = uMeteorTo.element(i);
                const u = uTime.sub(from.w).div(METEOR_LIFE);
                const live = smoothstep(0.0, 0.08, u).mul(float(1.0).sub(smoothstep(0.7, 1.0, u))).mul(to.w);
                // The head runs from → to; the trail is the stretch it has just crossed.
                const head = mix(from.xyz, to.xyz, clamp(u, 0.0, 1.0));
                const tail = mix(from.xyz, to.xyz, clamp(u.sub(0.34), 0.0, 1.0));
                const seg = head.sub(tail);
                const along = clamp(dot(dir.sub(tail), seg).div(max(dot(seg, seg), 1e-7)), 0.0, 1.0);
                const aside = length(dir.sub(tail).sub(seg.mul(along)));
                const core = exp(aside.mul(aside).mul(-1.6e6)).mul(along.mul(along));
                const bloomy = exp(aside.mul(aside).mul(-9.0e4)).mul(along.mul(along).mul(along)).mul(0.16);
                col.addAssign(mix(vec3(1.0, 0.72, 0.46), vec3(0.82, 0.92, 1.0), along)
                    .mul(core.add(bloomy).mul(live).mul(openSky).mul(aboveLand)
                        .mul(3.2)));
            }
        }

        // ── Moons (veiled by the lower atmosphere by day, bright by night) ──
        col.assign(mix(col, col.mul(0.82).add(mA.xyz.mul(veil)), mA.w));
        col.assign(mix(col, col.mul(0.82).add(mB.xyz.mul(veil)), mB.w));

        // ── High cirrus on an altitude plane ──
        // A slow warp bends the fibres and a slow mask gathers them into drifts: unbent fibres
        // streaming toward the suns line up as a comb of ruled strokes.
        if (clouds) {
            const q = dir.xz.div(el.add(0.1)).toVar();
            const drift = uTime.mul(0.006);
            const along = dot(q, uWindDir);
            const across = dot(q, vec2(uWindDir.y.negate(), uWindDir.x));
            const slow = ssTexNoise(noiseTex, vec2(along.mul(0.22), across.mul(0.45)).add(vec2(drift.mul(0.3), 3.1)));
            const bent = across.add(slow.x.sub(0.5).mul(3.2));
            const at = vec2(along.mul(1.3).add(drift), bent.mul(5.0));
            const fibre = ssTexNoise(noiseTex, at.add(vec2(4.3, 1.7)));
            const comb = ssTexNoise(noiseTex, at.mul(vec2(2.6, 3.2)).add(vec2(fibre.z.mul(0.9), 9.2)));
            // Wisps: the streets break into lengths, each fraying out at its ends.
            const lengths = ssTexNoise(noiseTex, vec2(along.mul(0.55), bent.mul(1.4)).add(vec2(11.0, 2.0)));
            // The weather: how much cirrus there is (uWeather.x) and whether it lies in long
            // unbroken streets (uWeather.y) or in wisps.
            const cirrus = uWeather.x;
            const streets = uWeather.y;
            const wisps = mix(smoothstep(0.3, 0.68, lengths.w), float(1.0), streets.mul(0.85));
            const driftLo = mix(0.62, 0.08, cirrus);
            const drifts = smoothstep(driftLo, driftLo.add(0.36), slow.z);
            const fibreLo = streets.mul(-0.14).add(0.48);
            const dens = smoothstep(fibreLo, fibreLo.add(0.36), fibre.x.mul(0.66).add(comb.y.mul(0.34)))
                .mul(drifts).mul(wisps).mul(streets.mul(0.3).add(1.0))
                .toVar();
            dens.mulAssign(smoothstep(0.025, 0.14, el).mul(float(1.0).sub(smoothstep(0.5, 0.88, el))));
            // Lit from below by the low suns: a gold-rose underside toward them, mauve away. High
            // cloud keeps the light of a sun that has set on the land (the glow, not the sunlight).
            const fwdA = ssPhaseHG(cA, float(0.72));
            const fwdB = ssPhaseHG(dot(dir, uSunB), float(0.75));
            const toward = atmosphere.towardSunA(dir);
            const rim = uGlowA.mul(fwdA.mul(0.12).add(mix(0.03, 0.07, toward)))
                .add(uGlowB.mul(fwdB.mul(0.05)));
            // Its own shade is the sky's: violet from above, the warm horizon toward the suns, and
            // by night the moons' silver.
            const dusky = mix(
                uUpper.mul(0.8).add(uHorizonCool.mul(0.22)),
                uHorizonWarm.mul(0.3).add(uHorizonCool.mul(0.22)),
                toward,
            ).add(uMoonLight.mul(0.16));
            // Thick fibres are brighter at heart; thin ones are only veil.
            const body = mix(0.6, 1.1, smoothstep(0.55, 0.95, fibre.x));
            const cloudCol = dusky.add(rim.mul(body).mul(mix(0.7, 1.0, comb.x)));
            col.assign(mix(col, cloudCol, dens.mul(0.62)));
        }

        // ── The deck: a sheet of high cloud over the upper sky, open along the horizon ──
        // The sunset every desert remembers: a ceiling of cloud with a clear slot under it, and the
        // low suns shining up through the slot onto its underside. Drawn in the deck's own level
        // sheet (so its cells lie in long lenses toward the horizon, as a ceiling seen from under
        // its edge does): broad masses, cells warped by them, fine tatters warped by the cells,
        // each drifting at its own pace so the field forms and melts as it goes. The same field
        // read a step toward the suns says which flank of a cell is lit: toward the suns the
        // deck is fire with dark hearts, away from them rose over mauve.
        if (clouds) {
            const sheet = dir.xz.div(max(el, 0.0).add(0.12)).toVar();
            const deckCover = uWeather.z;
            If(deckCover.greaterThan(0.01).and(el.greaterThan(0.004)), () => {
                const pace = uTime.mul(0.0035);
                const p0 = sheet.mul(0.52).sub(uWindDir.mul(pace)).add(vec2(7.1, 3.3)).toVar();
                const big = ssTexNoise(noiseTex, p0).toVar();
                const p1 = sheet.mul(1.65).sub(uWindDir.mul(pace.mul(2.6))).add(big.yz.sub(0.5).mul(0.9))
                    .add(vec2(3.7, 1.9))
                    .toVar();
                const cells = ssTexNoise(noiseTex, p1).toVar();
                const p2 = sheet.mul(5.4).sub(uWindDir.mul(pace.mul(6.5))).add(cells.zw.sub(0.5).mul(0.7));
                const fine = (fineClouds ? ssTexNoise(noiseTex, p2) : cells.wzyx).toVar();
                const field = big.x.mul(0.5).add(cells.x.mul(0.34)).add(fine.x.mul(0.16)).toVar();
                const sunward = normalize(uSunA.xz);
                const big2 = ssTexNoise(noiseTex, p0.add(sunward.mul(0.13)));
                const cells2 = ssTexNoise(noiseTex, p1.add(sunward.mul(0.4)));
                const field2 = big2.x.mul(0.5).add(cells2.x.mul(0.34)).add(fine.x.mul(0.16));
                const lo = mix(0.7, 0.38, deckCover);
                const dense = smoothstep(lo, lo.add(0.17), field).toVar();
                const heart = smoothstep(lo.add(0.1), lo.add(0.34), field);
                // The slot: the deck ends some way above the horizon, its edge frayed by its own masses.
                const slot = smoothstep(0.0, 0.05, el.sub(big.w.mul(0.05).add(0.045)));
                const cover = dense.mul(slot).mul(smoothstep(0.0, 0.25, deckCover));
                // Where the field thins toward the suns, this point is on a sunward flank.
                const flank = clamp(field.sub(field2).mul(7.0), -0.6, 1.4);
                const toward = atmosphere.towardSunA(dir);
                const fwdA = ssPhaseHG(cA, float(0.55));
                const fwdB = ssPhaseHG(dot(dir, uSunB), float(0.7));
                const fire = uGlowA.mul(fwdA.mul(0.2).add(mix(0.016, 0.115, toward.mul(toward))))
                    .add(uGlowB.mul(fwdB.mul(0.07).add(0.01)));
                const shade = mix(
                    uUpper.mul(0.62).add(uHorizonCool.mul(0.16)),
                    uHorizonWarm.mul(0.2).add(uHorizonCool.mul(0.2)),
                    toward,
                ).add(uMoonLight.mul(0.22));
                const lit = fire.mul(flank.add(0.5).max(0.0)).mul(mix(1.25, 0.5, heart));
                const deckCol = shade.mul(mix(1.0, 0.55, heart)).add(lit);
                col.assign(mix(col, deckCol, cover.mul(0.93)));
            });
        }

        // ── Dust bars: a few thin strata of high dust over the suns' bearing, lit from behind ──
        // They hang at fixed heights, so the sinking ember (the level dusk) passes down behind them.
        const barCover = float(0.0).toVar();
        if (clouds) {
            const bearing = atan(dir.x, dir.z.negate());
            const fromSuns = bearing.sub(SUN_BEARING).div(DUST_BARS_SPAN).toVar();
            const reach = exp(fromSuns.mul(fromSuns).negate());
            const drift = uTime.mul(0.0035);
            const bn = ssTexNoise(noiseTex, vec2(bearing.mul(22.0).add(drift.mul(6.0)), 5.0));
            const bl = ssTexNoise(noiseTex, vec2(bearing.mul(7.0).add(drift), 19.0));
            for (let i = 0; i < DUST_BARS.length; i++) {
                const b = DUST_BARS[i];
                // Each bar wavers in height and thickness and breaks into long lengths.
                const wob = bn.x.sub(0.5).mul(b.wob);
                const thick = float(b.half).mul(bn.y.mul(0.8).add(0.5));
                const cut = smoothstep(b.gap, b.gap + 0.22, i === 0 ? bl.x : bl.z);
                const across = abs(el.sub(b.el).sub(wob)).div(thick);
                const bar = float(1.0).sub(smoothstep(0.1, 1.0, across)).mul(cut).mul(reach)
                    .mul(b.dens);
                barCover.assign(max(barCover, bar));
            }
            // Against the suns' own glow a bar is a dark band with a burning edge; further out the
            // low light catches its underside and it glows rose-gold.
            const against = smoothstep(0.985, 0.9996, cA);
            const edge = barCover.mul(float(1.0).sub(barCover)).mul(4.0);
            const glowA = ssPhaseHG(cA, float(0.86)).mul(0.06).add(ssPhaseHG(dot(dir, uSunB), float(0.8)).mul(0.02));
            const barCol = col.mul(mix(1.4, 0.5, against)).mul(vec3(1.0, 0.84, 0.8))
                .add(uGlowA.mul(glowA.mul(edge.mul(1.5).add(0.25))));
            col.assign(mix(col, barCol, barCover.mul(0.85)));
        }

        // ── The twin suns ──
        // A is low in the thick air: an ember disc, its rim dark red (blue darkens fastest toward
        // the limb), its lower limb redder and dimmer still, squashed a little by refraction, and
        // crossed by the dust bars. B is higher and white-hot. Each disc's own colour is authored
        // with its green low: the shared sun light is the colour the SAND takes, too pale for a disc.
        const lA = vec2(dot(tp, right), dot(tp, upv)).div(sunRadA).toVar();
        const rA = length(vec2(lA.x, lA.y.div(0.965)));
        const pxA = fwidth(rA).add(1e-5);
        // (The front hemisphere only: the disc's coordinates repeat at the antipode.)
        const discA = float(1.0).sub(smoothstep(float(1.0).sub(pxA), float(1.0).add(pxA), rA))
            .mul(smoothstep(-0.2, 0.2, cA)).mul(aboveLand);
        const muA = sqrt(max(float(1.0).sub(rA.mul(rA)), 0.0));
        const darkA = vec3(1.0).sub(vec3(0.5, 0.56, 0.64).mul(float(1.0).sub(muA)));
        const heartA = mix(SUN_A_LIMB, SUN_A_CORE, smoothstep(0.3, 1.0, muA));
        const lowLimb = smoothstep(0.35, -1.0, lA.y).mul(uDusk.mul(0.25).add(0.55));
        const ember = mix(vec3(1.0), vec3(0.78, 0.5, 0.32), lowLimb);
        // Sinking into the thick air at its sunset, it dims and reddens.
        const duskA = mix(vec3(1.0), vec3(0.62, 0.36, 0.26), uDusk);
        // A flare lifts the white sun fully; the ember only a little (its heart would pale to cream
        // under a long chain): its corona carries the rest.
        const flare = uSunFlare.add(1.0);
        const radA = heartA.mul(darkA).mul(ember).mul(duskA).mul(SUN_A_POWER)
            .mul(uSunFlare.mul(0.4).add(1.0));
        // A dust bar across the disc veils it to a deeper ember.
        // ...and so does the dust when it hangs: a disc the eye can rest on.
        const veiled = radA.mul(mix(vec3(1.0), vec3(0.42, 0.24, 0.16), barCover.mul(0.85)))
            .mul(mix(vec3(1.0), vec3(0.5, 0.27, 0.16), haze.mul(0.85)));
        col.assign(mix(col, veiled, discA));
        const cB = dot(dir, uSunB).toVar();
        const angB = sqrt(max(float(2.0).mul(float(1.0).sub(cB)), 0.0));
        const pxB = fwidth(angB).add(1e-6);
        const discB = float(1.0).sub(smoothstep(float(sunRadB).sub(pxB), float(sunRadB).add(pxB), angB))
            .mul(aboveLand);
        const muB = sqrt(max(float(1.0).sub(angB.div(sunRadB).pow(2.0)), 0.0));
        const darkB = vec3(1.0).sub(vec3(0.3, 0.45, 0.62).mul(float(1.0).sub(muB)));
        // Its own sunset: under about seven degrees the thick air takes its blue and then its green.
        const lowB = float(1.0).sub(smoothstep(0.03, 0.13, uSunB.y));
        const coreB = mix(SUN_B_CORE, SUN_B_LOW, lowB.mul(0.9)).mul(mix(1.0, 0.62, lowB));
        const veiledB = mix(vec3(1.0), vec3(0.5, 0.3, 0.2), barCover.mul(0.8))
            .mul(mix(vec3(1.0), vec3(0.62, 0.4, 0.24), haze.mul(0.8)));
        col.assign(mix(col, coreB.mul(darkB).mul(veiledB).mul(SUN_B_POWER).mul(flare), discB));
        // A tight corona just outside each disc: the ember's held close, the white sun's wider.
        // The ember swells with the flare and with the heat of play (its heart keeps its colour:
        // the corona carries the heat, the disc only the flare).
        const swell = clamp(uSunFlare.add(burn.mul(0.5)), 0.0, 1.5);
        const coronaA = exp(rA.sub(1.0).max(0.0).mul(swell.mul(1.4).sub(4.0)))
            .mul(swell.mul(0.6).add(0.5)).mul(float(1.0).sub(discA))
            .mul(float(1.0).sub(barCover.mul(0.7)))
            .mul(aboveLand);
        col.addAssign(uGlowA.mul(coronaA));
        const coronaB = exp(angB.div(sunRadB).sub(1.0).max(0.0).mul(-2.6)).mul(1.2).mul(float(1.0).sub(discB))
            .mul(aboveLand);
        col.addAssign(uGlowB.mul(coronaB));

        // ── The front: a wall of dust standing on the far horizon ──
        // Seen from the side, in the sky's own coordinates (bearing along it, height above the
        // horizon): a slow noise along it says where it towers, a finer one that boils upward
        // makes its billows, and it ends where the height outruns them. It stands in front of
        // everything in the sky: a sun behind it is a dim red ball. Lightning flickers in its body.
        if (clouds) {
            const wallUp = uWall.x;
            If(wallUp.greaterThan(0.004).and(el.greaterThan(-0.02)).and(el.lessThan(0.3)), () => {
                const bearingW = atan(dir.x, dir.z.negate());
                const a = bearingW.sub(uWall.y).div(WALL_HALF).toVar();
                // Tallest behind its leading edge (toward -a: it travels that way), trailing off behind.
                const reach = smoothstep(-1.0, -0.62, a).mul(float(1.0).sub(smoothstep(0.1, 1.0, a))).toVar();
                const boil = uTime.mul(0.012);
                const mass = ssTexNoise(noiseTex, vec2(bearingW.mul(5.2).add(uWall.y.mul(-3.0)), 31.0));
                const lumpAt = vec2(bearingW.mul(19.0), el.mul(34.0).sub(boil.mul(3.0))).add(vec2(5.0, 9.0));
                const lump = ssTexNoise(noiseTex, lumpAt);
                const fineAt = vec2(bearingW.mul(47.0), el.mul(88.0).sub(boil.mul(7.0))).add(vec2(17.0, 3.0));
                const fine = ssTexNoise(noiseTex, fineAt);
                const top = wallUp.mul(0.135).mul(reach).mul(mass.x.mul(0.55).add(0.62))
                    .add(lump.x.sub(0.5).mul(0.05).mul(reach))
                    .add(fine.y.sub(0.5).mul(0.014));
                const cover = smoothstep(-0.006, 0.02, top.sub(el)).mul(smoothstep(0.0, 0.25, reach)).toVar();
                const depth = clamp(top.sub(el).div(max(top, 0.01)), 0.0, 1.0);
                // Its own colour: the far dust's, darker toward its foot and heart, its billows
                // shaded by their own lumps; its top and its sunward shoulders take the suns.
                const hz = atmosphere.horizonColor(dir);
                const body = hz.mul(mix(0.52, 0.11, depth)).mul(lump.z.mul(0.8).add(0.55)).mul(vec3(0.95, 0.72, 0.58));
                // (only its thin crown lets the light through: the body stays a dark mass)
                const crown = float(1.0).sub(smoothstep(0.0, 0.24, depth));
                const sunlit = uGlowA.mul(ssPhaseHG(cA, float(0.5)).mul(0.3).add(0.03))
                    .add(uGlowB.mul(ssPhaseHG(cB, float(0.6)).mul(0.16).add(0.012)))
                    .add(uMoonLight.mul(0.2));
                const wallCol = body
                    .add(sunlit.mul(crown.mul(crown).mul(0.9).add(0.025)).mul(fine.x.mul(0.5).add(0.75)))
                    .toVar();
                // Lightning: lit from inside for an instant, round one place in its body.
                const la = a.sub(uWall.w.mul(0.55)).div(0.1);
                const le = el.sub(top.mul(0.5)).div(max(top.mul(0.4), 0.01));
                const bolt = exp(la.mul(la).add(le.mul(le)).negate()).mul(uWall.z).mul(cover)
                    .mul(smoothstep(0.02, 0.3, depth));
                wallCol.addAssign(vec3(0.5, 0.62, 1.0).mul(bolt.mul(lump.w.mul(lump.w).mul(1.5).add(0.12)).mul(0.6)));
                // A sun behind the wall shows through its thinner top as a dim red ball.
                const thin = mix(0.9, 0.975, smoothstep(0.0, 0.5, depth));
                col.assign(mix(col, wallCol.add(col.mul(vec3(0.045, 0.018, 0.009))), cover.mul(thin)));
            });
        }

        return vec4(col, 1.0);
    })();

    const geometry = new THREE.SphereGeometry(SKY_RADIUS, 48, 24);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'shifting-sands-sky';
    mesh.frustumCulled = false;
    mesh.renderOrder = 20; // after the opaque world: early-z skips covered pixels
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    return {
        mesh,
        material,
        uMeteorFrom,
        uMeteorTo,
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}

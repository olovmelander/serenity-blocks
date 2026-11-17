/**
 * Synthwave Sunset — shared TSL building blocks, palette and world constants.
 *
 * The world is a retro seaside at dusk. World frame: the sea lies toward −z, the sun sets at
 * azimuth 0 (straight down −z) and the beach runs along x, its waterline SHORE.z units in front of
 * the rest camera. The camera yaws (see synthwave-sunset-world.js) to put the sun in the free
 * screen zone beside the gameplay board. Sea level is y = 0.
 *
 * The sky is ONE function of a direction (`swSky`), called by the dome along the view ray and by
 * the sea and the wet sand along their mirror rays, so the reflections match the sky exactly and
 * cost no extra pass.
 *
 * Every hash/noise helper carries a `setLayout`, so TSL emits it once as a real WGSL/GLSL function
 * instead of inlining its body at every call site. They are pure (no uniforms in their closure).
 * No `mx_noise_*`: MaterialX Perlin is a DXC compile pathology on this project's machines.
 *
 * Colours are authored as sRGB hex and converted to the linear working space by THREE.Color, so
 * shader constants and uniforms are scene-linear. Only the sun's disc, its glitter on the water and
 * the lights are authored above the bloom threshold (1.0); the sky stays under it.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    If,
    abs,
    atan,
    clamp,
    dot,
    exp,
    float,
    floor,
    fract,
    length,
    max,
    min,
    mix,
    normalize,
    sin,
    smoothstep,
    sqrt,
    step,
    vec2,
    vec3,
} from 'three/tsl';

// ── World constants ─────────────────────────────────────────────────────────────

/** Rest camera rig: an eye standing on the wet sand. The lens is Hor+ (fixed vertical FOV). */
export const RIG = Object.freeze({
    x: 0,
    height: 3.0,
    z: 20,
    vfov: 58,
    hFovCap: 106,
    /** Where the horizon sits, as a fraction of the screen height from the top. */
    horizonFrac: 0.575,
    near: 0.3,
    far: 9000,
});

/**
 * Sun disc: angular radius and how far its centre stands above the horizon (× radius). `lift`
 * is the rest value; the world sinks the sun as the evening goes on (u.dusk).
 */
export const SUN = Object.freeze({
    radius: THREE.MathUtils.degToRad(6.4),
    lift: 0.38,
    /** The lift at the golden hour: the disc stands clear of the sea, in the wheel's hub. */
    goldLift: 1.5,
    /** The lift at full dusk: the disc is gone, its afterglow remains. */
    setLift: -1.15,
    /** Vertical squash of the disc (refraction flattens a setting sun). */
    squash: 1.03,
});

/** The beach: the mean waterline is SHORE.z (world), the swash runs up to `reach` above it. */
export const SHORE = Object.freeze({
    z: -4,
    /** Wave period at the shore (s): surf and swash share it. */
    period: 8.5,
    /** Mean and spread of the swash's run-up, in metres up the beach. */
    reach: 7.5,
    reachSpread: 5.5,
    /** How far out the waves break (m seaward of the waterline). */
    surfZone: 34,
    /** Right of the pier the shore bends seaward round a bay: z −= bayK · max(x − bayX, 0)². */
    bayX: 62,
    bayK: 0.0035,
    /** The promenade runs this far inland of the waterline (m, square to the shore). */
    promenade: 24,
});

/** Mean distance haze over the sea (1/m). */
export const SEA_HAZE = 1 / 1900;

/** The crescent moon's angular radius (stylised: in proportion to the theme's big sun). */
export const MOON_RADIUS = THREE.MathUtils.degToRad(1.9);
/** The terminator's place across the moon's disc (1 = new, 0 = half): a young crescent. */
export const MOON_PHASE = 0.6;

/**
 * The Milky Way's plane (a unit normal) and two unit vectors in it: the band climbs out of the
 * sea left of the sunset and crosses the upper sky above the wheel, toward the top right.
 */
export const MILKY_WAY = Object.freeze((() => {
    const n = new THREE.Vector3(0.62, 0.42, 0.66).normalize();
    const a = new THREE.Vector3(0, 1, 0).cross(n).normalize();
    const b = new THREE.Vector3().crossVectors(n, a).normalize();
    return { normal: n.toArray(), a: a.toArray(), b: b.toArray() };
})());

/**
 * The evening star: a unit direction (folded to constants in JS, so it never becomes a shader
 * var) left of the sun and above the cirrus, in frame in the menu and beside the wheel in a game.
 */
export const EVENING_STAR = Object.freeze((() => {
    const az = THREE.MathUtils.degToRad(-10.5);
    const el = THREE.MathUtils.degToRad(13.5);
    return { dir: [Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)] };
})());

// ── Palette (sRGB hex → linear) ─────────────────────────────────────────────────

/** A linear-space vec3 constant from an sRGB hex, optionally scaled (HDR). */
export function rgb(hex, scale = 1) {
    const c = new THREE.Color(hex);
    return vec3(c.r * scale, c.g * scale, c.b * scale);
}

/** A linear-space THREE.Color from an sRGB hex (for uniforms). */
export function linearColor(hex) {
    return new THREE.Color(hex);
}

const LUMA = vec3(0.2126, 0.7152, 0.0722);
export const swLuma = (c) => dot(c, LUMA);

// ── Hashes (Dave Hoskins' hash-without-sine) ────────────────────────────────────

/** float → [0,1) */
export const swHash11 = /* @__PURE__ */ Fn(([pIn]) => {
    const p = fract(float(pIn).mul(0.1031)).toVar();
    p.mulAssign(p.add(33.33));
    p.mulAssign(p.add(p));
    return fract(p);
}).setLayout({ name: 'sw_hash11', type: 'float', inputs: [{ name: 'pIn', type: 'float' }] });

/** vec2 → [0,1) */
export const swHash21 = /* @__PURE__ */ Fn(([pIn]) => {
    const p3 = fract(vec3(pIn.x, pIn.y, pIn.x).mul(0.1031)).toVar();
    p3.addAssign(dot(p3, p3.yzx.add(33.33)));
    return fract(p3.x.add(p3.y).mul(p3.z));
}).setLayout({ name: 'sw_hash21', type: 'float', inputs: [{ name: 'pIn', type: 'vec2' }] });

/** vec2 → vec2 in [0,1)² */
export const swHash22 = /* @__PURE__ */ Fn(([pIn]) => {
    const p3 = fract(vec3(pIn.x, pIn.y, pIn.x).mul(vec3(0.1031, 0.103, 0.0973))).toVar();
    p3.addAssign(dot(p3, p3.yzx.add(33.33)));
    return fract(vec2(p3.x.add(p3.y).mul(p3.z), p3.x.add(p3.z).mul(p3.y)));
}).setLayout({ name: 'sw_hash22', type: 'vec2', inputs: [{ name: 'pIn', type: 'vec2' }] });

/** vec3 → [0,1) */
export const swHash31 = /* @__PURE__ */ Fn(([pIn]) => {
    const p3 = fract(vec3(pIn).mul(0.1031)).toVar();
    p3.addAssign(dot(p3, p3.zyx.add(31.32)));
    return fract(p3.x.add(p3.y).mul(p3.z));
}).setLayout({ name: 'sw_hash31', type: 'float', inputs: [{ name: 'pIn', type: 'vec3' }] });

/** vec3 → vec3 in [0,1)³ */
export const swHash33 = /* @__PURE__ */ Fn(([pIn]) => {
    const p3 = fract(vec3(pIn).mul(vec3(0.1031, 0.103, 0.0973))).toVar();
    p3.addAssign(dot(p3, p3.yxz.add(33.33)));
    return fract(p3.xxy.add(p3.yxx).mul(p3.zyx));
}).setLayout({ name: 'sw_hash33', type: 'vec3', inputs: [{ name: 'pIn', type: 'vec3' }] });

/** Smooth 2D value noise in [0,1]. */
export const swNoise2 = /* @__PURE__ */ Fn(([pIn]) => {
    const i = floor(pIn).toVar();
    const f = fract(pIn).toVar();
    const u = f.mul(f).mul(float(3.0).sub(f.mul(2.0)));
    const a = swHash21(i);
    const b = swHash21(i.add(vec2(1.0, 0.0)));
    const c = swHash21(i.add(vec2(0.0, 1.0)));
    const d = swHash21(i.add(vec2(1.0, 1.0)));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}).setLayout({ name: 'sw_noise2', type: 'float', inputs: [{ name: 'pIn', type: 'vec2' }] });

/** Two-octave value fbm in ~[0,1]. */
export const swFbm2 = /* @__PURE__ */ Fn(([pIn]) => {
    const n = swNoise2(pIn).mul(0.65)
        .add(swNoise2(pIn.mul(2.03).add(vec2(17.1, 3.7))).mul(0.35));
    return n;
}).setLayout({ name: 'sw_fbm2', type: 'float', inputs: [{ name: 'pIn', type: 'vec2' }] });

/** Three-octave value fbm in ~[0,1]. */
export const swFbm3 = /* @__PURE__ */ Fn(([pIn]) => {
    const n = swNoise2(pIn).mul(0.54)
        .add(swNoise2(pIn.mul(2.03).add(vec2(17.1, 3.7))).mul(0.3))
        .add(swNoise2(pIn.mul(4.11).add(vec2(-9.3, 11.9))).mul(0.16));
    return n;
}).setLayout({ name: 'sw_fbm3', type: 'float', inputs: [{ name: 'pIn', type: 'vec2' }] });

// ── Anti-aliased lines and pulses ───────────────────────────────────────────────

/**
 * Energy-conserving anti-aliased line (after Ben Golus' "pristine grid"): d = distance from the
 * line centre, hw = half-width, fw = fwidth of the CONTINUOUS coordinate d is measured in. When
 * the line is thinner than a pixel it is drawn one pixel wide at proportionally lower intensity,
 * so distant lines fade to their true average instead of crawling into moiré.
 */
export const swLineAA = /* @__PURE__ */ Fn(([d, hw, fw]) => {
    const w = max(hw, fw.mul(0.5));
    const edge = fw.mul(0.75);
    return float(1.0).sub(smoothstep(w.sub(edge), w.add(edge), abs(d))).mul(hw.div(w));
}).setLayout({
    name: 'sw_lineAA',
    type: 'float',
    inputs: [{ name: 'd', type: 'float' }, { name: 'hw', type: 'float' }, { name: 'fw', type: 'float' }],
});

/**
 * A box-filtered pulse train: the fraction of the pixel footprint [x − w/2, x + w/2] (w =
 * footprint in cells, e.g. 1.25·fwidth(x)) that falls inside the [a, b] part of each unit cell.
 * Exact coverage instead of a thresholded edge, so a window one or two pixels wide keeps a stable
 * brightness while the camera drifts, and many cells per pixel converge to their average.
 */
export const swFilteredPulse = /* @__PURE__ */ Fn(([x, w, a, b]) => {
    const hw = max(w, 1e-4).mul(0.5);
    const width = b.sub(a);
    const hi = x.add(hw);
    const lo = x.sub(hw);
    const integralHi = floor(hi).mul(width).add(min(max(fract(hi).sub(a), 0.0), width));
    const integralLo = floor(lo).mul(width).add(min(max(fract(lo).sub(a), 0.0), width));
    return integralHi.sub(integralLo).div(hw.mul(2.0));
}).setLayout({
    name: 'sw_filteredPulse',
    type: 'float',
    inputs: [
        { name: 'x', type: 'float' },
        { name: 'w', type: 'float' },
        { name: 'a', type: 'float' },
        { name: 'b', type: 'float' },
    ],
});

/** Max of the three channels. */
export const swMax3 = (c) => max(c.x, max(c.y, c.z));

/** Schlick's Fresnel for water (F0 = 0.02), written as products (no pow of a near-zero base). */
export const swFresnel = (cosTheta, f0 = 0.02) => {
    const m = float(1.0).sub(clamp(cosTheta, 0.0, 1.0));
    const m2 = m.mul(m);
    return float(f0).add(float(1.0 - f0).mul(m2.mul(m2).mul(m)));
};

// ── The dusk sky: one function of a direction ───────────────────────────────────

/**
 * Sun alignment of a direction's azimuth: 1 toward the sun's bearing, about 0.14 at 60° off,
 * ~0 behind. `cosAz` = cosine of the horizontal angle between the direction and the sun.
 */
export const swSunAlign = (cosAz) => exp(cosAz.sub(1.0).mul(4.0));

/**
 * The sky's colour gradient (no sun disc, clouds or stars) for a direction: tonight's colours
 * (synthwave-sunset-evening.js, written into the world's uniforms once a frame) from the horizon
 * under the sun and away from it, through the low and the middle sky to overhead. The ramp runs
 * on sqrt(elevation), so the warm band hugs the horizon. Below the horizon the horizon colour
 * holds (the far sea's haze meets it without a seam).
 */
export function swSkyGradient(u, d) {
    const e = max(d.y, 0.0);
    const s = sqrt(e);
    const hLen = max(length(vec2(d.x, d.z)), 1e-4);
    const cosAz = dot(vec2(d.x, d.z).div(hLen), u.sunAz);
    const sa = swSunAlign(cosAz);
    const c = mix(u.skyHorizon0, u.skyHorizon1, sa).toVar();
    c.assign(mix(c, mix(u.skyLow0, u.skyLow1, sa), smoothstep(0.03, 0.2, s)));
    c.assign(mix(c, mix(u.skyMid0, u.skyMid1, sa), smoothstep(0.15, 0.38, s)));
    c.assign(mix(c, u.skyHigh, smoothstep(0.32, 0.55, s)));
    c.assign(mix(c, u.skyZenith, smoothstep(0.5, 0.78, s)));
    return {
        color: c, sa, e, cosAz,
    };
}

/**
 * The sun's radiance across its disc, from its foot through its belt to its crown (tonight's
 * colours, their level folded in). Authored with the green channel low (a linear orange with
 * green over ~0.3 encodes to pale peach) and only a few times the bloom threshold, so the tone
 * curve keeps its hue instead of bleaching it.
 */
export function swSunDiscColor(u, ly, limb) {
    const base = mix(u.sunDisc0, u.sunDisc1, smoothstep(-0.95, 0.15, ly)).toVar();
    base.assign(mix(base, u.sunDisc2, smoothstep(0.1, 0.95, ly)));
    return base.mul(float(0.62).add(limb.mul(0.38)));
}

/**
 * One row of cumulus heads along the horizon: a half circle in every cell of `x`, as tall as the
 * cell's own hash. Two rows half a cell apart, the higher taken, leave no gap between heads.
 * `x` is kept positive by the caller (a hash of a negative cell repeats its neighbour).
 */
const swHeads = /* @__PURE__ */ Fn(([x, seed]) => {
    const a = fract(x).sub(0.5).toVar();
    const b = fract(x.add(0.5)).sub(0.5).toVar();
    const ha = swHash11(floor(x).add(seed));
    const hb = swHash11(floor(x.add(0.5)).add(seed).add(57.0));
    const ra = sqrt(max(float(1.0).sub(a.mul(a).mul(4.0)), 0.0));
    const rb = sqrt(max(float(1.0).sub(b.mul(b).mul(4.0)), 0.0));
    return max(ra.mul(ha.mul(0.7).add(0.3)), rb.mul(hb.mul(0.7).add(0.3)));
}).setLayout({
    name: 'sw_heads',
    type: 'float',
    inputs: [{ name: 'x', type: 'float' }, { name: 'seed', type: 'float' }],
});

/**
 * The full sky for a direction `d` (normalised).
 * @param {object} u   world uniforms (the sun's frame, tonight's colours, cloudCover, skyLights,
 *                     the moon's frame, bolt, time, shoot0A/B, shoot1A/B)
 * @param {object} d   TSL vec3 direction
 * @param {object} o
 * @param {object} o.pxRad   radians per pixel along this ray (from fwidth, taken by the caller)
 * @param {number} [o.clouds=3]   0, 2 or 3 octaves
 * @param {boolean} [o.stars=true]  the stars, the evening star, the Milky Way and the moon
 * @param {boolean} [o.sunDisc=true]  false for mirror rays (the glitter lobe draws the sun there)
 * @param {boolean} [o.mackerel=true]  the mackerel sky (a tier may leave it out)
 * @param {boolean} [o.towers=true]  the cumulus towers on the horizon
 * @param {object} [o.cloudMix]   how much of the cloud shows (a rough mirror blurs it away)
 * @param {object} [o.az]   azimuth node (atan(d.x, −d.z)) when the caller already has one
 */
export function swSky(u, d, o) {
    const clouds = o.clouds ?? 3;
    const withStars = o.stars !== false;
    const withDisc = o.sunDisc !== false;
    const withMackerel = clouds > 0 && o.mackerel !== false;
    const withTowers = clouds > 0 && o.towers !== false;
    const g = swSkyGradient(u, d);
    const col = g.color.toVar();
    const { sa, e, cosAz } = g;
    const az = o.az ?? atan(d.x, d.z.negate());
    const cloudMix = o.cloudMix ?? float(1.0);

    // ── Glow round the sun: a tight aureole, a wide warm bloom, a band along the horizon ──
    const cosS = dot(d, u.sunDir);
    const ang = sqrt(max(float(1.0).sub(cosS), 0.0).mul(2.0)).toVar();
    const sunUpness = smoothstep(-0.16, 0.06, u.sunDir.y).toVar();
    const aureole = exp(ang.mul(-16.0)).mul(0.3).add(exp(ang.mul(-4.2)).mul(0.14)).mul(sunUpness);
    const band = exp(e.mul(-26.0)).mul(sa).mul(float(0.08).add(sunUpness.mul(0.1)));
    col.addAssign(u.sunWarm.mul(aureole).add(u.sunBand.mul(band)));

    // ── Fireworks light the sky round their bursts (and so the sea, which mirrors this) ──
    if (u.burst0) {
        const glowOf = (B, C) => {
            const a = sqrt(max(float(1.0).sub(dot(d, B.xyz)), 0.0).mul(2.0));
            return C.mul(exp(a.mul(-9.0)).mul(0.22).add(exp(a.mul(-2.6)).mul(0.06)).mul(B.w));
        };
        col.addAssign(glowOf(u.burst0, u.burstCol0).add(glowOf(u.burst1, u.burstCol1)));
    }

    // The sky behind every cloud: the towers on the horizon are hazed toward it.
    const clear = col.toVar();
    const cloud = float(0.0).toVar();
    // How widely a cloud's underside is lit: the whole western sky, not only the sun's bearing.
    const wide = exp(cosAz.sub(1.0).mul(1.3)).toVar();

    if (clouds > 0) {
        // ── High cloud: long streaks of cirrus and altostratus, lit from below by the low sun ──
        const env = smoothstep(0.012, 0.05, e).mul(float(1.0).sub(smoothstep(0.17, 0.34, e)));
        const cc = vec2(az.mul(2.1).add(u.time.mul(0.0022)), e.mul(27.0).add(sin(az.mul(3.1)).mul(0.6)));
        const n = clouds >= 3 ? swFbm3(cc) : swFbm2(cc);
        // The weather thins the streaks out or draws them over (0.5 is the opening look).
        const from = mix(float(0.82), float(0.41), u.cloudCover.x);
        cloud.assign(smoothstep(from, from.add(0.3), n).mul(env).mul(cloudMix));
        // Underlit: salmon-gold toward the sun, lilac away; silhouettes dark close to the disc
        // with a bright silver lining on their thin edges.
        const lit = mix(u.cloud0, u.cloud1, sqrt(sa));
        const near = exp(ang.mul(-7.0));
        const thin = float(1.0).sub(smoothstep(0.08, 0.5, cloud));
        const cloudCol = mix(lit, rgb(0x5a2c4a), near.mul(0.6))
            .add(rgb(0xffd0a0).mul(near.mul(thin).mul(1.2).mul(sunUpness)));
        col.assign(mix(col, cloudCol, cloud.mul(0.9)));
    }

    if (withMackerel) {
        // ── A mackerel sky: fine ripples of cloud on a level sheet high overhead, drawn in the
        // sheet's own plane so they close up toward the horizon. One wave train, bent by a slow
        // noise, makes the ripples; a noise drawn out along them breaks each ripple into
        // cloudlets; a third gathers them into fields with open sky between. Where the ripples
        // are finer than the pixel they settle to their mean (a thin veil) instead of crawling.
        // The low sun lights the sheet's underside from the west; as the evening deepens the
        // light leaves its far, high part first, so the afterglow burns only near the horizon ──
        If(u.cloudCover.y.greaterThan(0.01), () => {
            const spread = float(1.0).div(e.add(0.12)).toVar();
            const plane = vec2(d.x, d.z).mul(spread).add(vec2(u.time.mul(0.0035), 0.0)).toVar();
            // Turned a little, so the ripples run aslant of the line of sight.
            const sheet = vec2(plane.x.mul(0.9).sub(plane.y.mul(0.43)), plane.x.mul(0.43).add(plane.y.mul(0.9)))
                .toVar();
            const bend = swNoise2(sheet.mul(0.9)).toVar();
            const resolved = float(1.0).sub(smoothstep(0.5, 1.4, o.pxRad.mul(52.0).mul(spread).mul(spread)));
            const ripple = mix(float(0.5), sin(sheet.y.mul(52.0).add(bend.mul(15.0))).mul(0.5).add(0.5), resolved);
            const breaks = swNoise2(sheet.mul(vec2(11.0, 6.0)).add(vec2(3.7, 1.9)));
            const field = smoothstep(0.2, 0.62, swNoise2(sheet.mul(0.36).add(vec2(5.1, 9.3))));
            const amount = u.cloudCover.y.mul(field);
            const lo = mix(float(1.25), float(0.3), amount);
            const dense = smoothstep(lo, lo.add(0.4), ripple.mul(0.58).add(breaks.mul(0.8)).sub(0.14)).toVar();
            const envM = smoothstep(0.12, 0.3, e).mul(float(1.0).sub(smoothstep(0.72, 0.95, e)));
            // A rough mirror (the wet sand) loses the ripples before it loses the streaks.
            const mk = dense.mul(envM).mul(cloudMix).mul(cloudMix).toVar();
            const reach = mix(float(1.0), float(1.0).sub(smoothstep(0.12, 0.55, e)), u.dusk.mul(0.9));
            const under = mix(u.cloud0, u.cloud1, wide.mul(reach)).mul(float(0.82).add(dense.mul(0.36)));
            col.assign(mix(col, under, mk.mul(0.88)));
            cloud.assign(max(cloud, mk));
        });
    }

    if (withTowers) {
        // ── Cumulus towers: a bank of far thunderheads standing on the horizon, never across the
        // sun. Their heads catch the light, their flat feet stand in the haze; the rims turned to
        // the sun burn. After dark heat lightning flickers inside them (u.bolt: bearing, width,
        // strength) ──
        If(u.cloudCover.z.greaterThan(0.01).and(e.lessThan(0.24)), () => {
            const x = az.mul(7.0).add(40.0).add(u.time.mul(0.0007)).toVar();
            // Where a bank stands: slow sines of the bearing (no noise: the world places its
            // lightning by the same sum), kept off the sun's own bearing.
            const stand = sin(x.mul(0.9).add(1.3)).mul(0.5).add(sin(x.mul(0.37).add(4.1)).mul(0.35))
                .add(sin(x.mul(1.7).add(2.2)).mul(0.15));
            const bank = smoothstep(-0.4, 0.2, stand).mul(smoothstep(0.17, 0.32, abs(az))).mul(u.cloudCover.z)
                .toVar();
            // A few tall towers among the lower heads.
            const tall = smoothstep(0.55, 0.9, swHash11(floor(x.mul(0.5)).add(11.0)));
            const top = bank.mul(
                swHeads(x, 3.0).mul(tall.mul(0.07).add(0.062))
                    .add(swHeads(x.mul(2.6), 31.0).mul(0.03))
                    .add(swHeads(x.mul(6.3), 71.0).mul(0.012))
                    .add(0.004),
            ).toVar();
            const soft = max(o.pxRad.mul(1.5), 0.0025);
            const inside = float(1.0).sub(smoothstep(top.sub(soft), top, e)).mul(smoothstep(0.02, 0.2, bank))
                .toVar();
            const below = max(top.sub(e), 0.0).toVar();
            const billow = swNoise2(vec2(x.mul(2.3), e.mul(150.0))).toVar();
            // Lit from the west and from below: the heads bright, the body in its own shade.
            const height = clamp(e.div(max(top, 1e-3)), 0.0, 1.0);
            const shade = mix(float(0.55), float(1.15), height.mul(height)).mul(mix(float(0.78), float(1.12), billow));
            // In the golden hour's daylight they are cream above blue-grey shade.
            const lit = mix(u.cloud1, rgb(0xfff0da, 1.05), u.gold.mul(0.85));
            const shaded = mix(u.cloud0.mul(0.62), rgb(0x8793bd, 0.8), u.gold.mul(0.85));
            const body = mix(shaded, lit, wide.mul(0.75).add(0.12)).mul(shade).toVar();
            // The lining: the heads' rims catch the sun from behind; after dark, the moon.
            const rimLight = exp(below.div(0.0042).negate());
            body.addAssign(u.sunWarm.mul(rimLight.mul(float(0.3).add(wide.mul(0.9))).mul(sunUpness).mul(1.15)));
            body.addAssign(rgb(0x9aa8d8).mul(rimLight.mul(u.skyLights.y).mul(0.22)));
            // Far cloud is hazed toward the sky behind it, most at its foot.
            body.assign(mix(body, clear, float(0.16).add(float(1.0).sub(smoothstep(0.0, 0.04, e)).mul(0.4))));
            const off = az.sub(u.bolt.x).div(max(u.bolt.y, 1e-3));
            const flash = u.bolt.z.mul(exp(off.mul(off).negate())).toVar();
            body.addAssign(rgb(0xb9c2ff).mul(flash.mul(float(0.35).add(billow.mul(0.65))).mul(1.5)));
            col.assign(mix(col, body, inside.mul(cloudMix)));
            // The flash lights the air above the bank a little.
            col.addAssign(rgb(0x7f88d0).mul(flash.mul(exp(e.mul(-16.0))).mul(bank).mul(0.16)));
            cloud.assign(max(cloud, inside.mul(cloudMix)));
        });
    }

    // ── The sun's disc (a flattened setting sun with limb darkening) ──
    if (withDisc) {
        const lx = dot(d, u.sunRight).div(u.sunTan);
        const ly = dot(d, u.sunUp).div(u.sunTan).mul(SUN.squash);
        const r = length(vec2(lx, ly));
        const aa = o.pxRad.div(u.sunTan).mul(1.3);
        const facing = step(0.0, cosS);
        const disc = float(1.0).sub(smoothstep(float(1.0).sub(aa), float(1.0).add(aa), r)).mul(facing);
        const limb = sqrt(max(float(1.0).sub(r.mul(r)), 0.0));
        // Cloud in front of the sun dims it (the streaks cross its upper half).
        col.assign(mix(col, swSunDiscColor(u, ly, limb), disc.mul(float(1.0).sub(cloud.mul(0.75)))));
    }

    if (withStars) {
        const starsOut = u.skyLights.x;
        const moonLit = u.skyLights.y;
        const night = u.skyLights.w;

        // ── The Milky Way: after dark, a band of unresolved stars and dust climbing out of the
        // sea left of the sunset and over the wheel ──
        const milky = float(0.0).toVar();
        If(night.greaterThan(0.02), () => {
            const mw = MILKY_WAY;
            const off = dot(d, vec3(mw.normal[0], mw.normal[1], mw.normal[2]));
            const along = atan(dot(d, vec3(mw.b[0], mw.b[1], mw.b[2])), dot(d, vec3(mw.a[0], mw.a[1], mw.a[2])));
            const dust = swFbm3(vec2(along.mul(3.4).add(20.0), off.mul(11.0).add(20.0)));
            const lane = smoothstep(0.42, 0.7, swNoise2(vec2(along.mul(5.1).add(31.0), off.mul(24.0).add(9.0))));
            milky.assign(exp(off.mul(off).div(-0.03)).mul(float(0.3).add(dust.mul(1.1)))
                .mul(float(1.0).sub(lane.mul(0.55)))
                .mul(smoothstep(0.04, 0.3, e))
                .mul(night)
                .mul(float(1.0).sub(cloud)));
            col.addAssign(mix(rgb(0x7f86d2), rgb(0xd9a6c8), dust).mul(milky.mul(0.05)));
        });

        // ── The moon: a young crescent that follows the sun down, its horns turned from it, the
        // dark of its disc faintly lit by the earth ──
        const tanM = Math.tan(MOON_RADIUS);
        const mx = dot(d, u.moonRight).div(tanM);
        const my = dot(d, u.moonUp).div(tanM);
        const mr = length(vec2(mx, my));
        const aaM = o.pxRad.div(tanM).mul(1.3);
        const cosM = dot(d, u.moonDir);
        const moonDisc = float(1.0).sub(smoothstep(float(1.0).sub(aaM), float(1.0).add(aaM), mr))
            .mul(step(0.0, cosM)).toVar();
        const terminator = sqrt(max(float(1.0).sub(my.mul(my)), 0.0)).mul(MOON_PHASE);
        const sunlit = smoothstep(terminator.sub(aaM.mul(1.5)), terminator.add(aaM.mul(1.5)), mx);
        const limbM = sqrt(max(float(1.0).sub(mr.mul(mr)), 0.0));
        const veil = float(1.0).sub(cloud.mul(0.8));
        const moonCol = rgb(0xfff0d8, 2.3).mul(sunlit.mul(float(0.7).add(limbM.mul(0.3))))
            .add(rgb(0x8496c8, 0.04).mul(float(0.5).add(limbM.mul(0.5))));
        const moonShows = moonDisc.mul(veil).mul(smoothstep(0.0, 0.25, moonLit));
        // The dark of the disc stays the sky's own colour, a shade deeper: a ball there would
        // show against a sky the fireworks have lit.
        col.assign(mix(col, col.mul(0.78).add(moonCol.mul(moonLit)), moonShows));
        const angM = sqrt(max(float(1.0).sub(cosM), 0.0).mul(2.0));
        const moonHalo = exp(angM.mul(-34.0)).mul(0.22).add(exp(angM.mul(-8.0)).mul(0.03));
        col.addAssign(rgb(0xc4d0ff).mul(moonHalo.mul(moonLit).mul(veil)));

        // ── Stars: one per cell of a 3D lattice (no stretching anywhere on the sphere), a few
        // bright and many faint. They come out in order of brightness as the evening deepens:
        // the first handful at the sunset, the whole field at night; fewer low in the bright west.
        const scale = 150.0;
        const q = d.mul(scale);
        const cell = floor(q);
        const h = swHash31(cell);
        const starDir = normalize(cell.add(swHash33(cell.add(7.1)).mul(0.56).add(0.22)));
        const cellsPerPx = max(o.pxRad.mul(scale), 1e-4);
        const dPx = length(d.sub(starDir)).mul(scale).div(cellsPerPx);
        const mag = clamp(h.sub(0.9).div(0.1), 0.0, 1.0).toVar();
        const mag2 = mag.mul(mag);
        const bright = mag2.mul(mag2).mul(mag);
        const radiusPx = float(0.36).add(bright.mul(0.95));
        const core = float(1.0).sub(smoothstep(radiusPx.sub(0.5), radiusPx.add(0.5), dPx)).mul(step(0.9, h));
        // Scintillation: steadier overhead, livelier low over the sea.
        const depthT = mix(float(0.42), float(0.18), smoothstep(0.1, 0.6, e));
        const twinkle = sin(u.time.mul(float(1.1).add(h.mul(2.3))).add(h.mul(77.0))).mul(depthT)
            .add(float(1.0).sub(depthT));
        const needed = float(1.0).sub(starsOut).sub(milky.mul(0.25))
            .add(float(1.0).sub(smoothstep(0.12, 0.45, e)).mul(0.1));
        const out = smoothstep(needed, needed.add(0.05), mag);
        const vis = smoothstep(0.06, 0.25, e)
            .mul(out)
            .mul(float(1.0).sub(cloud))
            .mul(float(1.0).sub(moonDisc))
            .mul(float(1.0).sub(smoothstep(0.08, 0.36, swLuma(col))));
        const starI = core.mul(float(0.035).add(mag.mul(0.1)).add(bright.mul(2.4))).mul(twinkle).mul(vis);
        const tint = swHash31(cell.add(3.7));
        const starCol = mix(mix(rgb(0xc8dcff), rgb(0xffe2f0), tint), rgb(0xffbe94), step(0.9, tint));
        col.addAssign(starCol.mul(starI));

        // The evening star, low in the west beside the sun: the first light of the night, steady,
        // a little warm, with a soft halo, brighter as the sky darkens behind it.
        const venus = vec3(EVENING_STAR.dir[0], EVENING_STAR.dir[1], EVENING_STAR.dir[2]);
        const vPx = length(d.sub(venus)).div(o.pxRad);
        const vCore = exp(vPx.mul(vPx).mul(-0.32));
        const vHalo = exp(vPx.mul(-0.22)).mul(0.05);
        const vLevel = u.skyLights.z.mul(float(1.0).sub(cloud.mul(0.85)))
            .mul(smoothstep(0.995, 0.9995, dot(d, venus)));
        col.addAssign(rgb(0xfff0dc).mul(vCore.mul(2.6).add(vHalo)).mul(vLevel));
    }

    return {
        color: col, cloud, sa, e,
    };
}

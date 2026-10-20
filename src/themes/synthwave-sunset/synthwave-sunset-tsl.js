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
 * The sky's colour gradient (no sun disc, clouds or stars) for a direction: tangerine and gold on
 * the horizon under the sun, dusty rose away from it, coral and rose low, mauve, then indigo and a
 * teal-indigo zenith. The ramp runs on sqrt(elevation), so the warm band hugs the horizon. `dusk`
 * (0..1) darkens the upper sky first and reddens the horizon; the afterglow outlasts the sun.
 * Below the horizon the horizon colour holds (the far sea's haze meets it without a seam).
 */
export function swSkyGradient(u, d) {
    const e = max(d.y, 0.0);
    const s = sqrt(e);
    const hLen = max(length(vec2(d.x, d.z)), 1e-4);
    const cosAz = dot(vec2(d.x, d.z).div(hLen), u.sunAz);
    const sa = swSunAlign(cosAz);
    const { dusk } = u;
    const horizon = mix(
        mix(rgb(0xc9707f), rgb(0x9a4d6e), dusk),
        mix(rgb(0xffb466, 0.74), rgb(0xff7a4a, 0.56), dusk),
        sa,
    );
    const low = mix(mix(rgb(0xb2607a), rgb(0x703a66), dusk), mix(rgb(0xf47a5c, 0.8), rgb(0xd0505a, 0.55), dusk), sa);
    const mid = mix(rgb(0x8a5274), rgb(0xa45a72), sa.mul(0.6)).mul(mix(1.0, 0.55, dusk));
    const high = rgb(0x3a4a78).mul(mix(1.0, 0.45, dusk));
    const zenith = rgb(0x163456).mul(mix(1.0, 0.4, dusk));
    const c = horizon.toVar();
    c.assign(mix(c, low, smoothstep(0.03, 0.2, s)));
    c.assign(mix(c, mid, smoothstep(0.15, 0.38, s)));
    c.assign(mix(c, high, smoothstep(0.32, 0.55, s)));
    c.assign(mix(c, zenith, smoothstep(0.5, 0.78, s)));
    return {
        color: c, sa, e, cosAz,
    };
}

/**
 * The sun's radiance across its disc: deep red-orange at the foot, gold at the crown. Authored
 * with the green channel low (a linear orange with green over ~0.3 encodes to pale peach) and only
 * a few times the bloom threshold, so the tone curve keeps its hue instead of bleaching it.
 */
export function swSunDiscColor(u, ly, limb) {
    const base = mix(rgb(0xff4a22), rgb(0xff8a34), smoothstep(-0.95, 0.15, ly)).toVar();
    base.assign(mix(base, rgb(0xffb04c), smoothstep(0.1, 0.95, ly)));
    const level = mix(float(3.0), float(1.8), u.dusk);
    return base.mul(level).mul(float(0.62).add(limb.mul(0.38)));
}

/**
 * The full sky for a direction `d` (normalised).
 * @param {object} u   world uniforms (sunDir, sunRight, sunUp, sunAz, sunTan, dusk, time,
 *                     shoot0A/B, shoot1A/B)
 * @param {object} d   TSL vec3 direction
 * @param {object} o
 * @param {object} o.pxRad   radians per pixel along this ray (from fwidth, taken by the caller)
 * @param {number} [o.clouds=3]   0, 2 or 3 octaves
 * @param {boolean} [o.stars=true]
 * @param {boolean} [o.sunDisc=true]  false for mirror rays (the glitter lobe draws the sun there)
 * @param {object} [o.cloudMix]   how much of the cloud shows (a rough mirror blurs it away)
 * @param {object} [o.az]   azimuth node (atan(d.x, −d.z)) when the caller already has one
 */
export function swSky(u, d, o) {
    const clouds = o.clouds ?? 3;
    const withStars = o.stars !== false;
    const withDisc = o.sunDisc !== false;
    const g = swSkyGradient(u, d);
    const col = g.color.toVar();
    const { sa, e } = g;
    const az = o.az ?? atan(d.x, d.z.negate());

    // ── Glow round the sun: a tight aureole, a wide warm bloom, a band along the horizon ──
    const cosS = dot(d, u.sunDir);
    const ang = sqrt(max(float(1.0).sub(cosS), 0.0).mul(2.0));
    const sunUpness = smoothstep(-0.16, 0.06, u.sunDir.y);
    const aureole = exp(ang.mul(-16.0)).mul(0.3).add(exp(ang.mul(-4.2)).mul(0.14)).mul(sunUpness);
    const band = exp(e.mul(-26.0)).mul(sa).mul(float(0.08).add(sunUpness.mul(0.1)));
    col.addAssign(rgb(0xffa060).mul(aureole).add(rgb(0xff8a5a).mul(band)));

    // ── Fireworks light the sky round their bursts (and so the sea, which mirrors this) ──
    if (u.burst0) {
        const glowOf = (B, C) => {
            const a = sqrt(max(float(1.0).sub(dot(d, B.xyz)), 0.0).mul(2.0));
            return C.mul(exp(a.mul(-9.0)).mul(0.22).add(exp(a.mul(-2.6)).mul(0.06)).mul(B.w));
        };
        col.addAssign(glowOf(u.burst0, u.burstCol0).add(glowOf(u.burst1, u.burstCol1)));
    }

    // ── High cloud: long streaks of cirrus and altostratus, lit from below by the low sun ──
    const cloud = float(0.0).toVar();
    if (clouds > 0) {
        const env = smoothstep(0.012, 0.05, e).mul(float(1.0).sub(smoothstep(0.17, 0.34, e)));
        const cc = vec2(az.mul(2.1).add(u.time.mul(0.0022)), e.mul(27.0).add(sin(az.mul(3.1)).mul(0.6)));
        const n = clouds >= 3 ? swFbm3(cc) : swFbm2(cc);
        cloud.assign(smoothstep(0.5, 0.8, n).mul(env).mul(o.cloudMix ?? 1.0));
        // Underlit: salmon-gold toward the sun, lilac away; silhouettes dark close to the disc
        // with a bright silver lining on their thin edges.
        const lit = mix(rgb(0x8a5e8e), rgb(0xff9478, 0.95), sqrt(sa)).mul(mix(1.0, 0.5, u.dusk));
        const near = exp(ang.mul(-7.0));
        const thin = float(1.0).sub(smoothstep(0.08, 0.5, cloud));
        const cloudCol = mix(lit, rgb(0x5a2c4a), near.mul(0.6))
            .add(rgb(0xffd0a0).mul(near.mul(thin).mul(1.2).mul(sunUpness)));
        col.assign(mix(col, cloudCol, cloud.mul(0.9)));
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

    // ── Stars: one per cell of a 3D lattice (no stretching anywhere on the sphere) ──
    if (withStars) {
        const scale = 150.0;
        const q = d.mul(scale);
        const cell = floor(q);
        const h = swHash31(cell);
        const starDir = normalize(cell.add(swHash33(cell.add(7.1)).mul(0.56).add(0.22)));
        const cellsPerPx = max(o.pxRad.mul(scale), 1e-4);
        const dPx = length(d.sub(starDir)).mul(scale).div(cellsPerPx);
        const mag = clamp(h.sub(0.93).div(0.07), 0.0, 1.0);
        const radiusPx = float(0.42).add(mag.mul(0.7));
        const core = float(1.0).sub(smoothstep(radiusPx.sub(0.5), radiusPx.add(0.5), dPx)).mul(step(0.93, h));
        const twinkle = sin(u.time.mul(float(1.1).add(h.mul(2.3))).add(h.mul(77.0))).mul(0.3).add(0.7);
        const vis = smoothstep(0.1, 0.36, e)
            .mul(float(0.3).add(u.dusk.mul(0.7)))
            .mul(float(1.0).sub(cloud))
            .mul(float(1.0).sub(smoothstep(0.06, 0.32, swLuma(col))));
        const starI = core.mul(float(0.14).add(mag.mul(mag).mul(mag).mul(1.4))).mul(twinkle).mul(vis);
        col.addAssign(mix(rgb(0xc8dcff), rgb(0xffe2f0), swHash31(cell.add(3.7))).mul(starI));
    }

    return {
        color: col, cloud, sa, e,
    };
}

/**
 * Spring — the light every part shares (TSL).
 *
 *  - skyColour(u, dir): the sky as a function of a direction (zenith, the horizon band, the sun's
 *    aureole, the disc) — the dome along the view ray, a ditch along its mirror ray;
 *  - aerial(u, P, colour): the air between the eye and a world point: a haze whose density falls
 *    with height (integrated exactly along the ray), lit warm toward the sun, plus the mist that
 *    lies low over the river at dawn;
 *  - airClarity(u, P): transmittance only, for light that must fade with the air.
 *
 * Inline builders (they read uniforms); the laid-out helpers are pure.
 */
import {
    Fn,
    abs,
    clamp,
    dot,
    exp,
    float,
    length,
    max,
    mix,
    normalize,
    select,
    smoothstep,
} from 'three/tsl';
import { SKYLINE_GATE } from './spring-hours.js';

/** Scale heights (metres) of the haze and the ground mist. */
export const HAZE_HEIGHT = 900;
export const MIST_HEIGHT = 5.5;
/** The cloud deck's height (metres). */
export const CLOUD_BASE = 1500;

/**
 * Optical depth of an exponential layer, density a·e^(−y/H), along a ray from height y0 with
 * vertical direction dy over length d (the exact integral; the level-ray limit where dy → 0).
 */
export const layerDepth = /* @__PURE__ */ Fn(([a, scale, y0, dy, d]) => {
    const b = float(1.0).div(scale);
    const start = a.mul(exp(y0.mul(b).negate()));
    const k = dy.mul(b).mul(d);
    const level = d.mul(float(1.0).sub(k.mul(0.5)));
    const ramp = select(abs(k).lessThan(1e-4), level, float(1.0).sub(exp(k.negate())).div(dy.mul(b)));
    return start.mul(ramp);
}).setLayout({
    name: 'sp_layerDepth',
    type: 'float',
    inputs: [
        { name: 'a', type: 'float' }, { name: 'scale', type: 'float' }, { name: 'y0', type: 'float' },
        { name: 'dy', type: 'float' }, { name: 'd', type: 'float' },
    ],
});

/** Mie-like forward glow toward the sun: a broad aureole plus a tight one. */
export const sunGlow = (mu) => {
    const m = clamp(mu, 0.0, 1.0);
    const m2 = m.mul(m);
    const m4 = m2.mul(m2);
    const m16 = m4.mul(m4).mul(m4).mul(m4);
    return m4.mul(0.32).add(m16.mul(0.55));
};

/**
 * The sky along a direction (linear, before exposure). `withSun` adds the disc (the dome draws it;
 * a mirror does too). Below the horizon the horizon band continues (what a ditch's mirror meets).
 */
export function skyColour(u, dir, { withSun = true } = {}) {
    const d = normalize(dir);
    const up = max(d.y, -0.08);
    const mu = dot(d, u.sunDir);
    const e = max(up, 0.0);
    // A northern spring sky: clear blue overhead, paler and softer toward the horizon, a thin
    // bright band right at the line, warmer toward the sun.
    const mid = u.zenith.mul(2.1).add(u.fill.mul(0.34));
    const high = mix(mid, u.zenith, smoothstep(0.05, 0.85, e));
    // A wide pale band: the air over the valley whitens the lowest fifteen degrees.
    const band = exp(e.mul(float(5.2).sub(clamp(mu, 0.0, 1.0).mul(2.4))).negate());
    const base = mix(high, u.horizon, band).toVar();
    base.addAssign(u.haze.mul(exp(abs(up).mul(40.0).negate())).mul(0.26));
    const glow = sunGlow(mu).mul(u.glow).mul(smoothstep(-0.12, 0.02, up)).mul(exp(e.mul(-3.0)).mul(0.5).add(0.5));
    // The sky's glow and the twilight wedge follow the sky's daylight, not the valley's sun.
    base.addAssign(glow.mul(mix(float(1.0), float(0.45), u.day.oneMinus())));
    // The twilight wedge: the sun below the horizon still lights the band above where it set.
    const twilight = smoothstep(-0.25, 0.9, mu).mul(exp(max(up, 0.0).mul(-9.0))).mul(u.day.oneMinus());
    base.addAssign(u.glow.mul(twilight).mul(0.35));
    if (withSun) {
        const r = max(float(1.0).sub(mu), 0.0).sqrt().mul(1.41421);
        const cos = float(0.0048);
        const disc = float(1.0).sub(smoothstep(cos.mul(0.82), cos, r));
        // The disc itself is hidden by whatever land stands in front of it; it is gone when it is
        // under the far horizon.
        base.addAssign(u.sun.mul(disc).mul(9.0).mul(smoothstep(-1.2, 0.6, u.sunEl)));
    }
    return base;
}

/**
 * The air between the eye and a world point P over a surface colour. Returns the composited
 * colour: the haze (warmed toward the sun) and, low over the fields, the mist.
 */
export function aerial(u, P, colour) {
    const V = P.sub(u.eye);
    const d = max(length(V), 1e-3);
    const rd = V.div(d);
    const hazeA = u.hazeDensity.mul(1.0 / 2600);
    const tauHaze = layerDepth(hazeA, float(HAZE_HEIGHT), u.eye.y, rd.y, d);
    const mistA = u.mistDensity.mul(1.0 / 420);
    const tauMist = layerDepth(mistA, float(MIST_HEIGHT), u.eye.y, rd.y, d);
    const mu = dot(rd, u.sunDir);
    const sunward = sunGlow(mu);
    const hazeLight = u.haze.add(u.glow.mul(sunward).mul(0.55));
    const mistLight = u.mist.add(u.glow.mul(sunward).mul(0.45));
    const tHaze = exp(tauHaze.negate());
    const tMist = exp(tauMist.negate());
    const throughMist = mix(mistLight, colour, tMist);
    return mix(hazeLight, throughMist, tHaze);
}

/**
 * How much of the sun reaches a world point (0..1): the valley's share (the sun's height over the
 * skyline at its bearing, spring-hours.js sunClear) lifted for high ground, which sees over the
 * skyline the valley sits under (a point h metres over the eye gains about atan(h / 7 km)), so
 * the fells keep the light after the valley loses it. The same gate as the CPU's.
 */
export function sunShare(u, P) {
    const lift = P.y.sub(u.eye.y).max(0.0).mul(57.3 / 7000.0);
    return smoothstep(SKYLINE_GATE[0], SKYLINE_GATE[1], u.sunEl.sub(u.skyline).add(lift))
        .mul(smoothstep(-1.2, 0.4, u.sunEl));
}

/** Transmittance only (for light that must fade with the air: glints, pollen, spray). */
export function airClarity(u, P) {
    const V = P.sub(u.eye);
    const d = max(length(V), 1e-3);
    const rd = V.div(d);
    const tau = layerDepth(u.hazeDensity.mul(1.0 / 2600), float(HAZE_HEIGHT), u.eye.y, rd.y, d)
        .add(layerDepth(u.mistDensity.mul(1.0 / 420), float(MIST_HEIGHT), u.eye.y, rd.y, d));
    return exp(tau.negate());
}

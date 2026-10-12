/**
 * Painted Ages — the light every part shares (TSL).
 *
 *  - skyColour(u, dir): the sky as a function of a direction (zenith, the horizon band, the sun's
 *    aureole, the disc) — the dome along the view ray, water along its mirror ray;
 *  - aerial(u, P, colour): the air between the eye and a point: a haze whose density falls with
 *    height (integrated exactly along the ray), lit warm toward the sun, plus the valley mist that
 *    lies in the low ground at first light and dusk;
 *  - cloudShadow(u, P): the drifting shadows of the cloud deck on the land.
 *
 * Inline builders (they read uniforms and textures); the laid-out helpers are pure.
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
    min,
    mix,
    normalize,
    pow,
    select,
    smoothstep,
    texture,
    vec2,
    vec3,
} from 'three/tsl';

/** Scale heights (metres) of the haze and the valley mist, and the mist's floor. */
export const HAZE_HEIGHT = 1300;
export const MIST_HEIGHT = 38;
export const MIST_FLOOR = 6;
/** The cloud deck's height (metres): where a sun ray meets it is where its shadow comes from. */
export const CLOUD_BASE = 2600;

/**
 * Optical depth of an exponential layer, density a·e^(−y/H), along a ray from height y0 with
 * vertical direction dy over length d (the exact integral; the level-ray limit where dy → 0).
 */
export const layerDepth = /* @__PURE__ */ Fn(([a, scale, y0, dy, d]) => {
    const b = float(1.0).div(scale);
    const start = a.mul(exp(y0.mul(b).negate()));
    const k = dy.mul(b).mul(d);
    const ramp = select(abs(k).lessThan(1e-4), d.mul(float(1.0).sub(k.mul(0.5))), float(1.0).sub(exp(k.negate())).div(dy.mul(b)));
    return start.mul(ramp);
}).setLayout({
    name: 'pa_layerDepth',
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
 * a mirror would too). Below the horizon the horizon band continues (what a reflection meets).
 */
export function skyColour(u, dir, { withSun = true } = {}) {
    const d = normalize(dir);
    const up = max(d.y, -0.08);
    const mu = dot(d, u.sunDir);
    // The horizon band: thick and warm toward the sun, thin and cool away from it.
    const band = exp(max(up, 0.0).mul(float(6.5).sub(clamp(mu, 0.0, 1.0).mul(2.4))).negate());
    const base = mix(u.zenith, u.horizon, band).toVar();
    // The sky's own brightening right at the horizon (looking through the most air).
    base.addAssign(u.haze.mul(exp(abs(up).mul(30.0).negate())).mul(0.35));
    // The sun's aureole, held a little above the horizon so it warms the band, not the land.
    const glow = sunGlow(mu).mul(u.glow).mul(smoothstep(-0.12, 0.02, up));
    base.addAssign(glow.mul(mix(float(1.0), float(0.45), u.sunUp.oneMinus())));
    // The twilight wedge: the sun below the horizon still lights the band above where it set.
    const twilight = smoothstep(-0.25, 0.9, mu).mul(exp(max(up, 0.0).mul(-9.0))).mul(u.sunUp.oneMinus());
    base.addAssign(u.glow.mul(twilight).mul(0.35));
    if (withSun) {
        // The disc: 0.28° radius, limb darkened, only where it stands above the land's line.
        const r = max(float(1.0).sub(mu), 0.0).sqrt().mul(1.41421);
        const cos = float(0.0048);
        const disc = float(1.0).sub(smoothstep(cos.mul(0.82), cos, r));
        const limb = float(0.55).add(float(0.45).mul(float(1.0).sub(r.div(cos)).clamp(0.0, 1.0).sqrt()));
        base.addAssign(u.sun.mul(disc).mul(limb).mul(9.0).mul(u.sunUp));
    }
    return base;
}

/**
 * The air between the eye and a world point P over a surface colour `colour`. Returns the
 * composited colour. `extinctionScale` thins the air for things that should read through it.
 */
export function aerial(u, P, colour) {
    const V = P.sub(u.eye);
    const d = max(length(V), 1e-3);
    const rd = V.div(d);
    // The haze: density per metre at sea level, set by the hour (thicker at first light, sunset).
    const hazeA = u.hazeDensity.mul(1.0 / 16000);
    const tauHaze = layerDepth(hazeA, float(HAZE_HEIGHT), u.eye.y, rd.y, d);
    // The valley mist: a thin layer on the valley floor (relative to its floor height).
    const mistA = u.mistDensity.mul(1.0 / 700);
    const tauMist = layerDepth(mistA, float(MIST_HEIGHT), u.eye.y.sub(MIST_FLOOR), rd.y, d);
    const mu = dot(rd, u.sunDir);
    const sunward = sunGlow(mu);
    // In-scatter: the haze colour, warmed toward the sun; the mist paler and lit through.
    const hazeLight = u.haze.add(u.glow.mul(sunward).mul(0.55));
    const mistLight = u.mist.add(u.glow.mul(sunward).mul(0.35));
    const tHaze = exp(tauHaze.negate());
    const tMist = exp(tauMist.negate());
    const throughMist = mix(mistLight, colour, tMist);
    return mix(hazeLight, throughMist, tHaze);
}

/** Transmittance only (for things that must fade with the air: sparks, ribbons). */
export function airClarity(u, P) {
    const V = P.sub(u.eye);
    const d = max(length(V), 1e-3);
    const rd = V.div(d);
    const hazeA = u.hazeDensity.mul(1.0 / 16000);
    const tau = layerDepth(hazeA, float(HAZE_HEIGHT), u.eye.y, rd.y, d)
        .add(layerDepth(u.mistDensity.mul(1.0 / 700), float(MIST_HEIGHT), u.eye.y.sub(MIST_FLOOR), rd.y, d));
    return exp(tau.negate());
}

/**
 * The cloud deck's shadow at a world point: where the sun's ray through P meets the deck, the
 * deck's cover there (two drifting reads of the noise). 1 = in sun.
 */
export function cloudShadow(u, noise, P) {
    const lift = max(float(CLOUD_BASE).sub(P.y), 0.0).div(max(u.sunDir.y, 0.06));
    const at = P.xz.add(u.sunDir.xz.mul(lift)).add(u.wind);
    const a = texture(noise, at.div(14000.0)).r;
    const b = texture(noise, at.div(5200.0).add(vec2(0.37, 0.61))).g;
    const cover = a.mul(0.65).add(b.mul(0.35));
    const thick = smoothstep(float(1.0).sub(u.cloudCover), float(1.0).sub(u.cloudCover).add(0.22), cover);
    return float(1.0).sub(thick.mul(0.72));
}

export { min, pow, vec3 };

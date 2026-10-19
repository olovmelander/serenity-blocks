/**
 * Grainfields — the light every part shares (TSL).
 *
 *  - skyColour(u, dir): the sky as a function of a direction (zenith, the bright band low under
 *    the storm's far edge, the sun's aureole, the disc) — the dome along the view ray, the land
 *    along its mirror ray;
 *  - aerial(u, P, colour): the air between the eye and a point: a haze whose density falls with
 *    height and the vale's mist lying low over the floor, both integrated exactly along the ray.
 *    The sun's own light in that air is left to the post stack's march through the deck's
 *    shadows (the shafts) when it runs (`u.airMarch`); without it a share of it is added here;
 *  - lightSurface(u, noise, P, N, albedo): sun (through the deck's gaps), sky fill, the barley's
 *    gold bounce.
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
    mix,
    normalize,
    select,
    smoothstep,
} from 'three/tsl';
import { deckShadow } from './grainfields-tsl.js';

/** Scale heights (metres) of the haze and the vale's mist, and the mist's floor (the vale's). */
export const HAZE_HEIGHT = 1300;
export const MIST_HEIGHT = 45;
export const MIST_FLOOR = 0;

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
    name: 'gf_layerDepth',
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
 * The sky along a direction (linear, before exposure). `withSun` adds the disc. Below the horizon
 * the band continues (what a reflection meets).
 */
export function skyColour(u, dir, { withSun = true } = {}) {
    const d = normalize(dir);
    const up = max(d.y, -0.08);
    const mu = dot(d, u.sunDir);
    const e = max(up, 0.0);
    // Clean blue overhead through the gaps, a pale bright band low down (the light coming in
    // under the storm's far edge), warmer toward the sun.
    const mid = u.zenith.mul(1.7).add(u.fill.mul(0.35));
    const high = mix(mid, u.zenith, smoothstep(0.05, 0.75, e));
    const band = exp(e.mul(float(9.0).sub(clamp(mu, 0.0, 1.0).mul(3.5))).negate());
    const base = mix(high, u.horizon, band).toVar();
    base.addAssign(u.haze.mul(exp(abs(up).mul(38.0).negate())).mul(0.25));
    // The sun's aureole, strongest low in the sky: tight round the disc (the haze's forward
    // scattering falls off fast), a faint broad halo.
    const m = clamp(mu, 0.0, 1.0);
    const m4 = m.mul(m).mul(m).mul(m);
    const m16 = m4.mul(m4).mul(m4).mul(m4);
    const m64 = m16.mul(m16).mul(m16).mul(m16);
    const aureole = m4.mul(0.07).add(m16.mul(0.18)).add(m64.mul(1.15));
    const glow = aureole.mul(u.glow).mul(smoothstep(-0.12, 0.02, up)).mul(exp(e.mul(-2.6)).mul(0.5).add(0.5));
    base.addAssign(glow.mul(mix(float(1.0), float(0.45), u.day.oneMinus())));
    // The twilight wedge: the sun below the horizon still lights the band above where it set.
    const twilight = smoothstep(-0.25, 0.9, mu).mul(exp(max(up, 0.0).mul(-8.0))).mul(u.day.oneMinus());
    base.addAssign(u.glow.mul(twilight).mul(0.4));
    if (withSun) {
        // The disc: 0.27° radius, limb darkened.
        const r = max(float(1.0).sub(mu), 0.0).sqrt().mul(1.41421);
        const cos = float(0.0047);
        const disc = float(1.0).sub(smoothstep(cos.mul(0.82), cos, r));
        const limb = float(0.55).add(float(0.45).mul(float(1.0).sub(r.div(cos)).clamp(0.0, 1.0).sqrt()));
        base.addAssign(u.sun.mul(disc).mul(limb).mul(9.0).mul(u.sunUp));
    }
    return base;
}

/**
 * The air between the eye and a world point P over a surface colour `colour`. Returns the
 * composited colour.
 */
export function aerial(u, P, colour) {
    const V = P.sub(u.eye);
    const d = max(length(V), 1e-3);
    const rd = V.div(d);
    const hazeA = u.hazeDensity.mul(1.0 / 15000);
    const tauHaze = layerDepth(hazeA, float(HAZE_HEIGHT), u.eye.y, rd.y, d);
    const mistA = u.mistDensity.mul(1.0 / 900);
    const tauMist = layerDepth(mistA, float(MIST_HEIGHT), u.eye.y.sub(MIST_FLOOR), rd.y, d);
    const mu = dot(rd, u.sunDir);
    const sunward = sunGlow(mu);
    // The sunlit share of the air: all of it here without the march, a far remnant with it.
    const sunAir = mix(float(1.0), float(0.3), u.airMarch);
    const hazeLight = u.haze.add(u.glow.mul(sunward).mul(0.55).mul(sunAir));
    const mistLight = u.mist.add(u.glow.mul(sunward).mul(0.35).mul(sunAir));
    const tHaze = exp(tauHaze.negate());
    const tMist = exp(tauMist.negate());
    const throughMist = mix(mistLight, colour, tMist);
    return mix(hazeLight, throughMist, tHaze);
}

/**
 * The same air as two terms, for a colour composited later: aerial(u, P, c) = c · transmit +
 * inscatter. A part that knows them per vertex (the barley: its plants are a few metres tall at
 * most, so the air across one is constant) composites per pixel with one multiply-add.
 */
export function aerialParts(u, P) {
    const V = P.sub(u.eye);
    const d = max(length(V), 1e-3);
    const rd = V.div(d);
    const hazeA = u.hazeDensity.mul(1.0 / 15000);
    const tauHaze = layerDepth(hazeA, float(HAZE_HEIGHT), u.eye.y, rd.y, d);
    const mistA = u.mistDensity.mul(1.0 / 900);
    const tauMist = layerDepth(mistA, float(MIST_HEIGHT), u.eye.y.sub(MIST_FLOOR), rd.y, d);
    const sunward = sunGlow(dot(rd, u.sunDir));
    const sunAir = mix(float(1.0), float(0.3), u.airMarch);
    const hazeLight = u.haze.add(u.glow.mul(sunward).mul(0.55).mul(sunAir));
    const mistLight = u.mist.add(u.glow.mul(sunward).mul(0.35).mul(sunAir));
    const tHaze = exp(tauHaze.negate()).toVar();
    const tMist = exp(tauMist.negate()).toVar();
    // mix(haze, mix(mist, c, tMist), tHaze) = c·tMist·tHaze + mist·(1 − tMist)·tHaze + haze·(1 − tHaze)
    return {
        transmit: tMist.mul(tHaze),
        inscatter: mistLight.mul(tMist.oneMinus()).mul(tHaze).add(hazeLight.mul(tHaze.oneMinus())),
    };
}

/** Transmittance only (for things that must fade with the air: motes, chaff). */
export function airClarity(u, P) {
    const V = P.sub(u.eye);
    const d = max(length(V), 1e-3);
    const rd = V.div(d);
    const tau = layerDepth(u.hazeDensity.mul(1.0 / 15000), float(HAZE_HEIGHT), u.eye.y, rd.y, d)
        .add(layerDepth(u.mistDensity.mul(1.0 / 900), float(MIST_HEIGHT), u.eye.y.sub(MIST_FLOOR), rd.y, d));
    return exp(tau.negate());
}

/**
 * A surface's light (linear, before the air): the sun through the deck (its shadow at P), the
 * sky's fill by how far the normal faces up, the gold bounce off the fields by how far it faces
 * down. `shade` multiplies the sun (a terrain or self shadow, 1 = none). Returns { colour, sunlit }.
 */
export function lightSurface(u, noise, P, N, albedo, shade = float(1.0)) {
    const sunlit = deckShadow(u, noise, P).mul(u.sunUp).mul(shade).toVar();
    const ndl = max(dot(N, u.sunDir), 0.0);
    const sky = u.fill.mul(N.y.mul(0.45).add(0.55));
    const ground = u.bounce.mul(N.y.mul(-0.5).add(0.5));
    const colour = albedo.mul(u.sun.mul(ndl).mul(sunlit).add(sky).add(ground));
    return { colour, sunlit };
}

/**
 * Parhelion optics: every shared TSL helper Fn (spec §5.0).
 *
 * Rules every helper here follows (the dome WGSL-size gate in
 * tests/unit/parhelion-shader-size.test.js pins them):
 * - each Fn carries `.setLayout({ name, type, inputs })`, so the builder emits ONE real WGSL
 *   `fn` per helper instead of re-inlining its body at each call site;
 * - pure math: no texture sampling, no mx_* noise, no uniforms or other outer nodes captured
 *   (everything varying is passed as an argument; colours are built inside the body);
 * - parameters are read by array destructuring, never `args[0]`.
 *
 * Angles are radians. Direction terms (A, alpha, beta, az, el, phiM, phiO, xG) follow the
 * §5.0 "common per-fragment direction terms" block; see createDomeMaterial().
 */

import {
    Fn,
    abs,
    clamp,
    cos,
    dot,
    exp,
    float,
    floor,
    fract,
    length,
    max,
    min,
    mix,
    round,
    select,
    sign,
    sin,
    smoothstep,
    step,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { hash21 } from '../../rendering/odyssey/chapter-environments/shared/odyssey-tsl-noise.js';
import { DOG_AZ, E, R22 } from './parhelion-composition.js';

const TWO_PI = 6.283185;
const LUMA = [0.2126, 0.7152, 0.0722];

/** Shader literals: 5 decimals of angle is 0.0006° — rounding keeps the WGSL small. */
const round5 = (x) => Math.round(x * 1e5) / 1e5;
const R22S = round5(R22);
const ES = round5(E);
const DOG_AZS = round5(DOG_AZ);

const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/** sRGB hex → linear [r, g, b] at 4 significant digits (what three's `color(hex)` computes, shorter WGSL). */
export function linearRgb(hex) {
    return [16, 8, 0].map((shift) => Number(srgbToLinear(((hex >> shift) & 255) / 255).toPrecision(4)));
}

/** A linear colour constant node. Call it INSIDE Fn bodies so no helper captures an outer node. */
export function linearColor(hex) {
    return vec3(...linearRgb(hex));
}

const f = (name) => ({ name, type: 'float' });
const v2 = (name) => ({ name, type: 'vec2' });
const v3 = (name) => ({ name, type: 'vec3' });
const v4 = (name) => ({ name, type: 'vec4' });

// ---------------------------------------------------------------------------------------
// Profiles and colour utilities
// ---------------------------------------------------------------------------------------

/**
 * Arc cross-section: a Gaussian inner flank (width `si`) and an exponential outer tail
 * (length `lam`) — the hard-inside, soft-outside shape of every refraction halo.
 */
export const phProf = /* @__PURE__ */ Fn(([x, si, lam]) => {
    const inner = min(x, 0.0);
    const outer = max(x, 0.0);
    const gauss = exp(inner.mul(inner).div(si.mul(si)).negate());
    return gauss.mul(exp(outer.div(lam).negate()));
}).setLayout({
    name: 'ph_prof', type: 'float', inputs: [f('x'), f('si'), f('lam')],
});

/** Spectral ramp for beads, dust and prism flashes: #FF6A4A → #FFD27A → #FFFFFF → #9CC7F0. */
export const phSpectral = /* @__PURE__ */ Fn(([t]) => {
    const s = clamp(t, 0.0, 1.0).mul(3.0);
    const warm = mix(linearColor(0xFF6A4A), linearColor(0xFFD27A), clamp(s, 0.0, 1.0));
    const white = mix(warm, vec3(1.0), clamp(s.sub(1.0), 0.0, 1.0));
    return mix(white, linearColor(0x9CC7F0), clamp(s.sub(2.0), 0.0, 1.0));
}).setLayout({ name: 'ph_spectral', type: 'vec3', inputs: [f('t')] });

/** Luminance soft knee: untouched below 0.8·cap, rolls off asymptotically to `cap`. Hue-preserving. */
export const phSoftCap = /* @__PURE__ */ Fn(([c, cap]) => {
    const l = dot(c, vec3(LUMA[0], LUMA[1], LUMA[2]));
    const knee = cap.mul(0.8);
    const span = cap.sub(knee);
    // Branchless: below the knee the exp term is exp(0) = 1, so target = l exactly.
    const over = max(l.sub(knee), 0.0);
    const target = min(l, knee).add(span.mul(float(1.0).sub(exp(over.div(span).negate()))));
    return c.mul(target.div(max(l, 1e-4)));
}).setLayout({ name: 'ph_softCap', type: 'vec3', inputs: [v3('c'), f('cap')] });

/**
 * THE tone curve (§6): hue-preserving, exactly linear below 0.8 on the max channel (so the
 * palette hexes are display targets), a shoulder above it, and hot cores drift to white.
 */
export const phTone = /* @__PURE__ */ Fn(([c]) => {
    const m = max(c.x, max(c.y, c.z));
    const shoulder = float(0.8).add(float(0.2).mul(float(1.0).sub(exp(m.sub(0.8).div(0.2).negate()))));
    const mT = select(m.lessThan(0.8), m, shoulder);
    const s = c.mul(mT.div(max(m, 1e-4)));
    // vec3(mT, mT, mT), not vec3(mT): a select() lowered to a var loses the splat in r185 WGSL.
    return mix(s, vec3(mT, mT, mT), smoothstep(1.0, 3.0, m).mul(0.6));
}).setLayout({ name: 'ph_tone', type: 'vec3', inputs: [v3('c')] });

/** Static ±1 triangular dither (add /255 after the OETF). */
export const phTriDither = /* @__PURE__ */ Fn(([fc]) => hash21(fc).add(hash21(fc.add(17.31))).sub(1.0))
    .setLayout({ name: 'ph_triDither', type: 'float', inputs: [v2('fc')] });

// ---------------------------------------------------------------------------------------
// Screen-space masks (screenUV is y-down; rects are vec4(x0, y0, x1, y1))
// ---------------------------------------------------------------------------------------

/** Rounded (r 0.01) calm box in aspect-corrected space: 1 inside, feathered to 0 outside; 0 for an empty rect. */
export const phCalmBox = /* @__PURE__ */ Fn(([uv, rect, feather, aspect]) => {
    const asp = vec2(aspect, 1.0);
    const centre = rect.xy.add(rect.zw).mul(0.5);
    const half = rect.zw.sub(rect.xy).mul(0.5).mul(asp);
    const p = uv.sub(centre).mul(asp);
    // Outside distance only: everything inside the box is fully calm anyway.
    const sd = length(max(abs(p).sub(half).add(0.01), 0.0)).sub(0.01);
    const valid = step(1e-5, rect.z.sub(rect.x));
    return float(1.0).sub(smoothstep(0.0, feather, sd)).mul(valid);
}).setLayout({
    name: 'ph_calmBox', type: 'float', inputs: [v2('uv'), v4('rect'), f('feather'), f('aspect')],
});

/** Side-lane weight: 0 over the card's columns, 1 out in the lanes. */
export const phLaneW = /* @__PURE__ */ Fn(([uv, rect]) => {
    const outside = max(rect.x.sub(uv.x), uv.x.sub(rect.z));
    return smoothstep(0.03, 0.14, outside);
}).setLayout({ name: 'ph_laneW', type: 'float', inputs: [v2('uv'), v4('rect')] });

// ---------------------------------------------------------------------------------------
// Sky
// ---------------------------------------------------------------------------------------

/**
 * The shared horizon colour (dome under-horizon strip, ridge haze AND the far snow), so the
 * snow/sky seam is invisible. `d` is kept for the §5.0 signature; the haze is azimuthal only.
 */
export const phHaze = /* @__PURE__ */ Fn(([, sunward, warmth]) => {
    const gold = mix(linearColor(0xFFD49C), linearColor(0xFFBE78), warmth);
    return mix(linearColor(0xCFE3F2), gold, sunward);
}).setLayout({
    name: 'ph_haze', type: 'vec3', inputs: [v3('d'), f('sunward'), f('warmth')],
});

/** Sky OUTSIDE the 22° ring: pale ice → sunward gold low, cobalt → deep cobalt high; capped below bloom. */
export const phSkyOut = /* @__PURE__ */ Fn(([d, sunward, up, warmth]) => {
    // Gold hugs the sunward horizon; higher up the sky stays ice-blue (a gold/ice mix is grey).
    const goldMix = sunward.mul(warmth.mul(0.9).add(0.55)).mul(exp(max(d.y, 0.0).div(0.07).negate()));
    const low = mix(linearColor(0xA9C4E8), linearColor(0xF6D9A8), goldMix);
    // Deep corners: the far-from-sun top of the frame sinks to #142C66 (natural vignette).
    const deep = smoothstep(0.30, 0.50, d.y).add(float(1.0).sub(sunward).mul(0.5)).min(1.0);
    const high = mix(linearColor(0x1E3F8C), linearColor(0x142C66), deep);
    const band = exp(abs(d.y).div(0.03).negate()).mul(0.28);
    const sky = mix(low, high, up).add(phHaze(d, sunward, warmth).mul(band));
    return phSoftCap(sky, 0.82);
}).setLayout({
    name: 'ph_skyOut', type: 'vec3', inputs: [v3('d'), f('sunward'), f('up'), f('warmth')],
});

/**
 * The dusky lens INSIDE the ring (authored explicitly: the sky formula cannot produce it),
 * darkest near the hidden sun, lifting to #3E5288 at the ring, plus the cream aureole.
 */
export const phLens = /* @__PURE__ */ Fn(([a, warmth, breath]) => {
    const lift = smoothstep(round5(R22S - 0.13), round5(R22S - 0.012), a);
    const dusk = mix(linearColor(0x243259), linearColor(0x3E5288), lift.mul(lift));
    // Core (hidden by the stone) + a shoulder that leaks just past the stone's silhouette (A ≈ .2).
    const aureole = exp(a.div(0.05).negate()).mul(1.2).add(exp(a.div(0.11).negate()).mul(0.16));
    const cream = linearColor(0xFFE9C2).mul(aureole).mul(warmth.mul(0.5).add(1.0));
    return dusk.mul(warmth.mul(0.25).add(1.0)).add(cream.mul(breath));
}).setLayout({
    name: 'ph_lens', type: 'vec3', inputs: [f('a'), f('warmth'), f('breath')],
});

// ---------------------------------------------------------------------------------------
// Halo display
// ---------------------------------------------------------------------------------------

/**
 * The ice-halo colour ramp across an arc's cross-section, t 0 → 1 from the sunward edge out:
 * red-orange inner edge → gold → white-gold body → pale lavender-white. Authored, not
 * per-channel dispersion: offset R/G/B profiles make a RAINBOW (a green and a blue band),
 * which is exactly what a real 22° halo does not show — its colours stop at yellow-white.
 */
export const phHaloTint = /* @__PURE__ */ Fn(([t]) => {
    const s = clamp(t, 0.0, 1.0);
    const redGold = mix(linearColor(0xE0685A), linearColor(0xF2C14E), smoothstep(0.0, 0.34, s));
    const body = mix(redGold, linearColor(0xFFF6E6), smoothstep(0.26, 0.6, s));
    return mix(body, linearColor(0xE6E6F5), smoothstep(0.62, 1.0, s));
}).setLayout({ name: 'ph_haloTint', type: 'vec3', inputs: [f('t')] });

/**
 * The 22° ring: ONE intensity profile (hard inner flank, short outward decay; artistic width
 * ≈ 1.7× physical) coloured by ph_haloTint across the band, plus a pale lavender outer bleed.
 * `cphi2` brightens the sides (cos²φ), `veil` is the cirrostratus patchiness.
 */
export const phHalo = /* @__PURE__ */ Fn(([a, cphi2, veil, k]) => {
    const x = a.sub(R22S);
    const body = phProf(x.add(0.003), 0.0095, 0.02);
    const tint = phHaloTint(x.add(0.016).div(0.034));
    // The long outer tail is a pale LAVENDER bleed that starts at the ring (never in the lens).
    const bleedGate = smoothstep(-0.004, 0.012, x);
    const bleed = linearColor(0xD0D5F4).mul(exp(max(x, 0.0).div(0.05).negate()).mul(bleedGate).mul(0.2));
    const gain = cphi2.mul(0.28).add(0.72).mul(veil.mul(0.8).add(0.6));
    // Body ≈ 0.8 at the sides: gold-cream under the bloom threshold except in bright veil patches —
    // the hounds are the white-hot ones, so the display does not dissolve into a milky corona.
    return tint.mul(body).add(bleed).mul(gain.mul(k).mul(0.8));
}).setLayout({
    name: 'ph_halo', type: 'vec3', inputs: [f('a'), f('cphi2'), f('veil'), f('k')],
});

/**
 * Both sundogs (parhelia) at ±DOG_AZ on the sun's almucantar: white-gold blazes with a red
 * sunward edge and an ice-blue tail streaming outward. Core widths ≈ 1.6× physical.
 */
export const phDogs = /* @__PURE__ */ Fn(([az, el, flareL, flareR, tail, tint, k]) => {
    const dx = abs(az).sub(DOG_AZS).mul(cos(el));
    const dy = el.sub(ES);
    const dy2 = dy.mul(dy);
    // One nucleus profile coloured by the halo ramp: red-orange sunward edge → white-gold.
    // Nucleus: hard sunward flank (.0065) and a tight outward body (.013).
    const nx = dx.add(0.002);
    const flankX = min(nx, 0.0);
    const nucleus = exp(flankX.mul(flankX).div(4.225e-5).negate()).mul(exp(max(nx, 0.0).div(0.013).negate()));
    // A slightly wider colour band than the ring's: red-orange sunward, gold, then white-gold.
    const ramp = phHaloTint(dx.add(0.013).div(0.032));
    // Warm Hounds (tint): the inner edge deepens toward #FFB070.
    const core = ramp.mul(nucleus).mul(mix(vec3(1.0), vec3(1.0, 0.78, 0.55), tint));
    // The HDR blaze is compact (only it and the ring's body cross the 0.95 bloom threshold) …
    const blaze = core.mul(exp(dy2.div(0.00045).negate()).mul(1.7));
    // … while the soft glow and the ice-blue tail stay below it, streaming outward.
    const out = max(dx, 0.0);
    const gate = smoothstep(-0.008, 0.012, dx);
    const glowShape = exp(out.div(0.035).negate()).mul(exp(dy2.div(0.0012).negate()));
    const glow = linearColor(0xFFF1CF).mul(glowShape.mul(gate).mul(0.16));
    const tailLen = exp(out.div(tail.mul(0.10).add(0.06)).negate());
    const tailV = linearColor(0xB8D0FF).mul(tailLen.mul(exp(dy2.div(0.0002).negate())).mul(gate).mul(tail).mul(0.3));
    const flare = select(az.lessThan(0.0), flareL, flareR).add(1.0);
    return blaze.add(glow).add(tailV).mul(k.mul(flare));
}).setLayout({
    name: 'ph_dogs',
    type: 'vec3',
    inputs: [f('az'), f('el'), f('flareL'), f('flareR'), f('tail'), f('tint'), f('k')],
});

/** Parhelic line: the sun's almucantar, from just inside the dogs outward; `pcAz/pcAmp` a travelling pulse. */
export const phParhelic = /* @__PURE__ */ Fn(([az, el, pcAz, pcAmp, k]) => {
    const de = el.sub(ES);
    const band = exp(de.mul(de).div(1.4e-5).negate());
    const aaz = abs(az);
    // Starts AT the dogs (never inside the lens) and streams outward.
    const start = smoothstep(round5(DOG_AZS - 0.012), round5(DOG_AZS + 0.03), aaz);
    const dp = aaz.sub(pcAz);
    const pulse = pcAmp.mul(exp(dp.mul(dp).div(0.0009).negate()));
    return band.mul(start).mul(pulse.add(0.34)).mul(k);
}).setLayout({
    name: 'ph_parhelic', type: 'float', inputs: [f('az'), f('el'), f('pcAz'), f('pcAmp'), f('k')],
});

/** Upper tangent arc: gull wings touching the ring top, same ramp as the halo (red sunward edge). */
export const phUta = /* @__PURE__ */ Fn(([alpha, beta, k]) => {
    const du = beta.sub(alpha.mul(alpha).mul(1.8).add(R22S));
    const body = phProf(du.add(0.002), 0.006, 0.012);
    const tint = phHaloTint(du.add(0.01).div(0.022));
    const wings = smoothstep(0.42, 0.28, abs(alpha)).mul(step(0.0, beta));
    return tint.mul(body).mul(wings.mul(k).mul(1.4));
}).setLayout({ name: 'ph_uta', type: 'vec3', inputs: [f('alpha'), f('beta'), f('k')] });

/** Circumscribed-halo stand-in (the "crown" of a strong display): flattened outward at the sides. */
export const phCrown = /* @__PURE__ */ Fn(([a, cphi2, k]) => {
    const rc = cphi2.mul(0.12).add(1.0).mul(R22S);
    const x = a.sub(rc).sub(0.006);
    return exp(x.mul(x).div(6.4e-5).negate()).mul(cphi2.mul(0.65).add(0.35)).mul(k.mul(1.3));
}).setLayout({ name: 'ph_crown', type: 'float', inputs: [f('a'), f('cphi2'), f('k')] });

/** Sun pillar: a vertical column through the hidden sun; the stub shows above the stone's crown. */
export const phSunPillar = /* @__PURE__ */ Fn(([alpha, beta, k]) => {
    const ab = abs(beta);
    const column = exp(alpha.mul(alpha).div(0.00011025).negate());
    return column.mul(exp(ab.div(0.24).negate())).mul(smoothstep(0.02, 0.06, ab)).mul(k.mul(1.6));
}).setLayout({ name: 'ph_sunPillar', type: 'float', inputs: [f('alpha'), f('beta'), f('k')] });

/** Lowitz arcs: short bright spurs joining the dogs to the ring. */
export const phLowitz = /* @__PURE__ */ Fn(([a, sphi, k]) => {
    const x = a.sub(round5(R22S + 0.012));
    const s = abs(sphi).sub(0.18);
    return exp(x.mul(x).div(1.6e-5).negate()).mul(exp(s.mul(s).div(0.01).negate())).mul(k);
}).setLayout({ name: 'ph_lowitz', type: 'float', inputs: [f('a'), f('sphi'), f('k')] });

/**
 * One reaction arc slot (phiCenter, amp, width, mode) glowing ON the ring. Mode < .5 uses the
 * mirrored angle (bead pairs), otherwise the full angle; modes < 1.5 carry dispersion.
 */
export const phArcGlow = /* @__PURE__ */ Fn(([phiM, phiO, xG, slot]) => {
    const raw = select(slot.w.lessThan(0.5), phiM, phiO).sub(slot.x).toVar();
    const dp = raw.sub(round(raw.div(TWO_PI)).mul(TWO_PI)).toVar();
    const along = exp(dp.mul(dp).div(slot.z.mul(slot.z)).negate());
    const across = exp(xG.mul(xG).div(0.000256).negate());
    const g = slot.y.mul(along).mul(across).mul(3.0);
    const disp = phSpectral(clamp(dp.div(slot.z), -1.0, 1.0).mul(0.5).add(0.5)).mul(0.4).add(0.6);
    return select(slot.w.lessThan(1.5), disp, linearColor(0xFFF6E6)).mul(g);
}).setLayout({
    name: 'ph_arcGlow', type: 'vec3', inputs: [f('phiM'), f('phiO'), f('xG'), v4('slot')],
});

// ---------------------------------------------------------------------------------------
// Ground features drawn in the dome
// ---------------------------------------------------------------------------------------

/** 1D value noise from a sine hash (a real WGSL fn: the mountains call it several times). */
export const phNoise1 = /* @__PURE__ */ Fn(([x]) => {
    const i = floor(x);
    const fr = fract(x);
    const h0 = fract(sin(i.mul(127.1)).mul(43758.5453));
    const h1 = fract(sin(i.add(1.0).mul(127.1)).mul(43758.5453));
    return mix(h0, h1, fr.mul(fr).mul(float(3.0).sub(fr.mul(2.0))));
}).setLayout({ name: 'ph_noise1', type: 'float', inputs: [f('x')] });

/**
 * Ridged octave with its exact slope: vec2(v, dv), v = (1 − |2n − 1|)² (sharp crests where the
 * noise crosses its middle, squared for steep peaks) and dv = dv/dx from the noise's own
 * smoothstep derivative, so a peak knows which of its sides faces which way. The noise is
 * written out here (no nested laid-out call).
 */
export const phRidgedD = /* @__PURE__ */ Fn(([x]) => {
    const i = floor(x);
    const fr = fract(x);
    const h0 = fract(sin(i.mul(127.1)).mul(43758.5453));
    const h1 = fract(sin(i.add(1.0).mul(127.1)).mul(43758.5453));
    const n = mix(h0, h1, fr.mul(fr).mul(float(3.0).sub(fr.mul(2.0))));
    const dn = h1.sub(h0).mul(fr.mul(float(1.0).sub(fr)).mul(6.0));
    const t = n.mul(2.0).sub(1.0);
    const w = float(1.0).sub(abs(t));
    // d|t|/dx = sign(t)·2·dn; d(w²)/dx = 2w·dw/dx.
    return vec2(w.mul(w), w.mul(-4.0).mul(sign(t)).mul(dn));
}).setLayout({ name: 'ph_ridgedD', type: 'vec2', inputs: [f('x')] });

/** Mountain range constants (rad above the horizon), shared with the CPU mirror. */
export const MOUNTAINS = Object.freeze({
    FAR: Object.freeze({
        scale: 9.0, offset: 3.7, base: 0.011, amp: 0.085,
    }),
    NEAR: Object.freeze({
        scale: 14.0, offset: 11.2, base: 0.003, amp: 0.026,
    }),
    LEFT: 0.012,
});

/**
 * Two backlit mountain ranges on the horizon: vec4(rgb, coverage). The far range stands tall
 * (≈ 1–5°) and hazy, the nearer one is lower and darker; both are higher on the left
 * (asymmetry) — mirrored on the CPU by mountainHeightCpu(). Every peak has a side turned
 * toward the hidden sun's bearing (lit at a graze, pale and warm) and a shaded side (cobalt),
 * from the ranges' exact slopes; crests catch a thin gold rim that burns brightest toward the
 * sun (and out in the lanes, away from the card); the shaded faces carry faint couloirs, and
 * the foot of both ranges sinks into the horizon haze. `haze` is ph_haze for this direction,
 * `aa` one pixel's angle.
 */
export const phRidge = /* @__PURE__ */ Fn(([az, el, sunward, laneW, haze, aa, phase]) => {
    const left = smoothstep(-0.1, -0.6, az).mul(MOUNTAINS.LEFT);
    const kF = MOUNTAINS.FAR.scale;
    const kN = MOUNTAINS.NEAR.scale;
    const xF = az.mul(kF).add(MOUNTAINS.FAR.offset);
    // Broad massifs (a smooth envelope) carrying ridged peaks, with low saddles between them.
    const envF = smoothstep(0.15, 0.85, phNoise1(xF.mul(0.35).add(2.0)));
    const f1 = phRidgedD(xF);
    const f2 = phRidgedD(xF.mul(2.6).add(1.3));
    const hF = envF.mul(f1.x.mul(0.62).add(f2.x.mul(0.24)).add(0.1)).add(phNoise1(xF.mul(6.1).add(7.7)).mul(0.05));
    const sF = envF.mul(f1.y.mul(0.62).add(f2.y.mul(0.624))).mul(kF * MOUNTAINS.FAR.amp);
    const rhF = hF.mul(MOUNTAINS.FAR.amp).add(MOUNTAINS.FAR.base).add(left);
    const xN = az.mul(kN).add(MOUNTAINS.NEAR.offset);
    const envN = smoothstep(0.1, 0.9, phNoise1(xN.mul(0.3).add(5.0)));
    const n1 = phRidgedD(xN);
    const n2 = phRidgedD(xN.mul(2.7).add(4.1));
    const hN = envN.mul(n1.x.mul(0.7).add(0.1)).add(n2.x.mul(0.2));
    const sN = envN.mul(n1.y.mul(0.7)).add(n2.y.mul(0.54)).mul(kN * MOUNTAINS.NEAR.amp);
    const rhN = hN.mul(MOUNTAINS.NEAR.amp).add(MOUNTAINS.NEAR.base).add(left.mul(0.4));
    const dF = rhF.sub(el);
    const dN = rhN.sub(el);
    const above = step(-0.03, el);
    const coverF = smoothstep(aa.negate(), aa, dF).mul(above);
    const coverN = smoothstep(aa.negate(), aa, dN).mul(above);
    // Which side of each peak faces the sun's bearing (az 0): the slope falling toward it.
    const towardSun = az.sign().negate();
    // Wide, soft transitions: the split between a peak's lit and shaded sides must not read as
    // a vertical fold line down the face.
    const litF = smoothstep(-0.9, 0.9, sF.mul(towardSun).negate());
    const litN = smoothstep(-0.9, 0.9, sN.mul(towardSun).negate());
    // Gold rims: max(depth, 0) keeps exp() bounded above the crest (no Inf/NaN in the sky).
    const glow = sunward.mul(sunward).mul(1.3).add(0.05).mul(laneW.mul(0.5).add(0.5));
    const rimF = exp(max(dF, 0.0).div(0.0011).negate()).mul(glow).mul(litF.mul(0.7).add(0.3));
    const rimN = exp(max(dN, 0.0).div(0.0008).negate()).mul(glow).mul(litN.mul(0.7).add(0.3));
    // Couloirs: faint vertical ribs down the shaded snow faces.
    const rib = phNoise1(az.mul(170.0).add(5.0)).mul(0.16).add(0.92);
    const shadeF = mix(linearColor(0x566DA4), linearColor(0x46598F), smoothstep(0.0, 0.03, dF)).mul(rib);
    const shadeN = mix(linearColor(0x3A4C83), linearColor(0x2C3B6C), smoothstep(0.0, 0.012, dN)).mul(rib);
    const warmLit = mix(linearColor(0x8FA2CF), linearColor(0xD9C2AA), sunward.mul(sunward));
    const faceF = mix(shadeF, warmLit, litF.mul(0.32).mul(smoothstep(0.016, 0.0, dF)));
    const faceN = mix(shadeN, warmLit.mul(0.85), litN.mul(0.28).mul(smoothstep(0.007, 0.0, dN)));
    const gold = linearColor(0xFFDDA8);
    // Aerial perspective toward a COOL haze (the warm sunward haze would grey the blue faces).
    const coolHaze = mix(haze, linearColor(0xB4C8EA), 0.6);
    const colF = mix(mix(faceF, coolHaze, 0.28), gold, min(rimF, 1.0));
    const colN = mix(mix(faceN, coolHaze, 0.1), gold, min(rimN, 1.0));
    // The foot of both ranges sinks into the horizon haze (and below it the far snow is haze).
    const mist = smoothstep(0.007, -0.0005, el);
    const rgb = mix(mix(colF, colN, coverN), haze, mist);
    const cover = max(coverF, coverN);
    // Snow banners: spindrift torn off the far range's sharpest peaks, a glowing veil just above
    // the crest that drifts along the ridge (brightest toward the sun). Returned PREMULTIPLIED:
    // the caller composites sky · (1 − a) + rgb, so the banner adds light over the open sky.
    const aboveF = max(el.sub(rhF), 0.0);
    const peak = f1.x.mul(f1.x).mul(f1.x).mul(envF);
    const tear = phNoise1(az.mul(90.0).sub(phase.mul(9.0))).mul(0.75).add(0.25);
    const banner = exp(aboveF.div(0.0035).negate()).mul(float(1.0).sub(coverF)).mul(peak).mul(tear)
        .mul(sunward.mul(0.8).add(0.2))
        .mul(0.6);
    const bannerCol = mix(linearColor(0xDCE6F6), linearColor(0xFFE8C8), sunward);
    return vec4(rgb.mul(cover).add(bannerCol.mul(banner)), cover);
}).setLayout({
    name: 'ph_ridge',
    type: 'vec4',
    inputs: [f('az'), f('el'), f('sunward'), f('laneW'), v3('haze'), f('aa'), f('phase')],
});

/** The ice fog's colour (inline TSL, shared by ph_fog and ph_fogFar so the two never drift). */
function fogTint(sunward, warmth) {
    const gold = mix(linearColor(0xFFE4BC), linearColor(0xFFCF98), warmth);
    return mix(linearColor(0xC8D8F2), gold, sunward.mul(sunward)).mul(sunward.mul(0.32).add(0.98));
}

/** Bank opacity below the horizon, where ph_fog's body is solid (the far snow, the far stones). */
export const FOG_FLOOR = 0.8;

/**
 * Ice fog on the horizon: a luminous low bank lying over the far plain. vec4(rgb, amount) for
 * a direction at azimuth `az` and elevation `el` (rad). The bank's top rolls along the horizon
 * (≈ 0.25°–1.2°, two octaves of an inline sine-hash noise drifting with `phase`), a thin veil
 * trails above it, and below the horizon it is the far plain's own air. It glows gold toward
 * the hidden sun (forward scattering, `sunward`), cool white elsewhere; `warmth` is the Lower
 * Sun level. The dome lays it over the sky and the mountains' feet, and the snow and the far
 * stones fade into the same colour, so the horizon has no seam.
 */
export const phFog = /* @__PURE__ */ Fn(([az, el, sunward, warmth, phase]) => {
    const x = az.mul(7.0).add(phase.mul(0.6)).add(1.3);
    const i = floor(x);
    const fr = fract(x);
    const s = fr.mul(fr).mul(float(3.0).sub(fr.mul(2.0)));
    const n1 = mix(fract(sin(i.mul(127.1)).mul(43758.5453)), fract(sin(i.add(1.0).mul(127.1)).mul(43758.5453)), s);
    const x2 = x.mul(2.7).add(5.1);
    const i2 = floor(x2);
    const fr2 = fract(x2);
    const s2 = fr2.mul(fr2).mul(float(3.0).sub(fr2.mul(2.0)));
    const n2 = mix(fract(sin(i2.mul(127.1)).mul(43758.5453)), fract(sin(i2.add(1.0).mul(127.1)).mul(43758.5453)), s2);
    // Rolling banks: tall swells with low gaps between them, a finer lumpy edge on top.
    const top = smoothstep(0.2, 0.9, n1).mul(0.017).add(n2.mul(0.006)).add(0.003);
    // Thinning gradually upward through the bank (mist, not a painted band).
    const body = float(1.0).sub(smoothstep(top.mul(-0.2), top, el));
    // A thin veil above the bank; max(…, 0) keeps the exp bounded below the horizon.
    const wisp = exp(max(el.sub(top), 0.0).div(0.008).negate()).mul(0.22);
    const amount = max(body.mul(body).mul(FOG_FLOOR), wisp);
    const gold = mix(linearColor(0xFFE4BC), linearColor(0xFFCF98), warmth);
    // The bank's top catches the low sun: a gold-lit rim along its rolling edge.
    const rim = exp(abs(el.sub(top.mul(0.8))).div(0.0025).negate()).mul(sunward.mul(0.55).add(0.12));
    return vec4(fogTint(sunward, warmth).add(gold.mul(rim)), amount);
}).setLayout({
    name: 'ph_fog', type: 'vec4', inputs: [f('az'), f('el'), f('sunward'), f('warmth'), f('phase')],
});

/**
 * The horizon air for things ON the plain (the far snow, the far stones): the shared haze under
 * the ice fog at its solid below-horizon opacity — what ph_fog gives the dome just under the
 * horizon, without its rolling-bank noise.
 */
export const phFogFar = /* @__PURE__ */ Fn(([haze, sunward, warmth]) => mix(haze, fogTint(sunward, warmth), FOG_FLOOR))
    .setLayout({
        name: 'ph_fogFar', type: 'vec3', inputs: [v3('haze'), f('sunward'), f('warmth')],
    });

/**
 * The long shadow of one far stone on the snow: the sun stands straight down −z at 9.5°, so a
 * stone `s` = (x, z, halfWidth, height) casts a strip toward the camera (+z), height · cot E
 * long (≈ 6 heights), narrowing toward its tip as the stone does toward its top. Soft by its
 * penumbra (growing with distance from the foot) and never thinner than a pixel (`px`, metres).
 */
export const phFarShadow = /* @__PURE__ */ Fn(([pxz, s, px]) => {
    const d = pxz.sub(s.xy);
    const len = s.w.mul(5.97);
    const t = d.y;
    const hw = s.z.mul(float(1.0).sub(clamp(t.div(len), 0.0, 1.0).mul(0.55))).mul(1.05);
    const soft = max(t.mul(0.012).add(0.25), px);
    const across = float(1.0).sub(smoothstep(hw.sub(soft), hw.add(soft), abs(d.x)));
    // Darkest at the foot, fading toward the tip (penumbra and skylight fill grow with length).
    const fade = float(1.0).sub(clamp(t.div(len), 0.0, 1.0).mul(0.65));
    const span = smoothstep(-0.5, 0.5, t).mul(float(1.0).sub(smoothstep(len.mul(0.8), len, t))).mul(fade);
    return across.mul(span);
}).setLayout({
    name: 'ph_farShadow', type: 'float', inputs: [v2('pxz'), v4('s'), f('px')],
});

/**
 * One sastrugi blade per cell of a wind-aligned grid `g` (x along the wind, y across it, +y
 * toward the camera): a short, skewed, tapering crest — angular and broken, never a long
 * smooth contour. Low sun behind the blade: a crisp crest line, the lit stoss side away from
 * the camera, and a long cobalt lee shadow cast TOWARD the camera. `aa` is the antialias width
 * in cell units (from fwidth), `seed` decorrelates grids. Returns vec3(lee, stoss, crest).
 */
export const phSastrugi = /* @__PURE__ */ Fn(([g, aa, seed]) => {
    const cell = floor(g).add(seed);
    const fr = fract(g);
    const h = hash21(cell);
    const h2 = hash21(cell.add(17.3));
    const present = step(0.42, h);
    const cx = h2.sub(0.5).mul(0.4).add(0.5);
    const halfLen = fract(h.mul(7.31)).mul(0.32).add(0.12);
    const cy = fract(h2.mul(5.17)).mul(0.25).add(0.25);
    const skew = fract(h.mul(13.7)).sub(0.5).mul(0.9);
    const x = fr.x.sub(cx);
    const along = x.div(halfLen);
    const tip = abs(along);
    // Pointed wedge (linear taper), lopsided: the upwind prow end carries the deeper shadow.
    const taper = max(float(1.0).sub(tip), 0.0);
    const dy = fr.y.sub(cy.add(skew.mul(x)));
    const prow = along.mul(0.35).add(0.65);
    const leeLen = taper.mul(prow).mul(fract(h2.mul(3.3)).mul(0.3).add(0.3)).add(aa);
    const lee = smoothstep(aa.negate(), aa, dy).mul(float(1.0).sub(smoothstep(leeLen.mul(0.6), leeLen, dy)));
    const stoss = float(1.0).sub(smoothstep(0.0, taper.mul(0.3).add(aa), dy.negate())).mul(step(dy, 0.0));
    const crest = float(1.0).sub(smoothstep(0.0, aa.mul(1.2), abs(dy.add(aa.mul(0.6)))));
    const m = present.mul(step(0.001, taper));
    return vec3(lee.mul(min(taper.add(0.35), 1.0)), stoss.mul(taper), crest.mul(smoothstep(0.0, 0.3, taper))).mul(m);
}).setLayout({
    name: 'ph_sastrugi', type: 'vec3', inputs: [v2('g'), f('aa'), f('seed')],
});

// ---------------------------------------------------------------------------------------
// CPU mirrors of the dome's ground silhouette (composition checks and tests)
// ---------------------------------------------------------------------------------------

function fractCpu(x) {
    return x - Math.floor(x);
}

/** CPU port of od_hash21 (odyssey-tsl-noise.js). */
export function hash21Cpu(x, y) {
    let p3x = fractCpu(x * 0.1031);
    let p3y = fractCpu(y * 0.1031);
    let p3z = fractCpu(x * 0.1031);
    const d = p3x * (p3y + 33.33) + p3y * (p3z + 33.33) + p3z * (p3x + 33.33);
    p3x += d;
    p3y += d;
    p3z += d;
    return fractCpu((p3x + p3y) * p3z);
}

/** CPU port of od_noise2 (smooth value noise in ~[0,1]). */
export function noise2Cpu(x, y) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);
    const a = hash21Cpu(ix, iy);
    const b = hash21Cpu(ix + 1, iy);
    const c = hash21Cpu(ix, iy + 1);
    const d = hash21Cpu(ix + 1, iy + 1);
    const top = a + (b - a) * ux;
    const bottom = c + (d - c) * ux;
    return top + (bottom - top) * uy;
}

function smoothstepCpu(e0, e1, x) {
    const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
}

function fract1(x) {
    return x - Math.floor(x);
}

/** CPU port of the dome's inline 1D sine-hash value noise (float32 precision aside). */
function noise1Cpu(x) {
    const i = Math.floor(x);
    const fr = x - i;
    const h0 = fract1(Math.sin(i * 127.1) * 43758.5453);
    const h1 = fract1(Math.sin((i + 1) * 127.1) * 43758.5453);
    return h0 + (h1 - h0) * fr * fr * (3 - 2 * fr);
}

function ridgedCpu(x) {
    const v = 1 - Math.abs(noise1Cpu(x) * 2 - 1);
    return v * v;
}

/**
 * CPU mirror of ph_ridge's two crest heights (rad above the horizon) at azimuth `az`:
 * `{ far, near, top }`, `top` the taller of the two. The shader's sine hash runs in float32,
 * so a hashed octave can differ slightly; the shape (heights, left asymmetry) is what is shared.
 */
export function mountainHeightCpu(az) {
    const left = smoothstepCpu(-0.1, -0.6, az) * MOUNTAINS.LEFT;
    const xF = az * MOUNTAINS.FAR.scale + MOUNTAINS.FAR.offset;
    const envF = smoothstepCpu(0.15, 0.85, noise1Cpu(xF * 0.35 + 2.0));
    const hF = envF * (ridgedCpu(xF) * 0.62 + ridgedCpu(xF * 2.6 + 1.3) * 0.24 + 0.1)
        + noise1Cpu(xF * 6.1 + 7.7) * 0.05;
    const far = hF * MOUNTAINS.FAR.amp + MOUNTAINS.FAR.base + left;
    const xN = az * MOUNTAINS.NEAR.scale + MOUNTAINS.NEAR.offset;
    const envN = smoothstepCpu(0.1, 0.9, noise1Cpu(xN * 0.3 + 5.0));
    const hN = envN * (ridgedCpu(xN) * 0.7 + 0.1) + ridgedCpu(xN * 2.7 + 4.1) * 0.2;
    const near = hN * MOUNTAINS.NEAR.amp + MOUNTAINS.NEAR.base + left * 0.4;
    return { far, near, top: Math.max(far, near) };
}

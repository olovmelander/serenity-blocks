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
    const ramp = phHaloTint(dx.add(0.011).div(0.026));
    // Warm Hounds (tint): the inner edge deepens toward #FFB070.
    const core = ramp.mul(nucleus).mul(mix(vec3(1.0), vec3(1.0, 0.78, 0.55), tint));
    // The HDR blaze is compact (only it and the ring's body cross the 0.95 bloom threshold) …
    const blaze = core.mul(exp(dy2.div(0.00065).negate()).mul(3.6));
    // … while the soft glow and the ice-blue tail stay below it, streaming outward.
    const out = max(dx, 0.0);
    const gate = smoothstep(-0.008, 0.012, dx);
    const glowShape = exp(out.div(0.035).negate()).mul(exp(dy2.div(0.0012).negate()));
    const glow = linearColor(0xFFF1CF).mul(glowShape.mul(gate).mul(0.28));
    const tailLen = exp(out.div(tail.mul(0.10).add(0.06)).negate());
    const tailV = linearColor(0xB8D0FF).mul(tailLen.mul(exp(dy2.div(0.0002).negate())).mul(gate).mul(tail).mul(0.22));
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
    const band = exp(de.mul(de).div(3.721e-5).negate());
    const aaz = abs(az);
    // Starts AT the dogs (never inside the lens) and streams outward.
    const start = smoothstep(round5(DOG_AZS - 0.012), round5(DOG_AZS + 0.03), aaz);
    const dp = aaz.sub(pcAz);
    const pulse = pcAmp.mul(exp(dp.mul(dp).div(0.0009).negate()));
    return band.mul(start).mul(pulse.add(0.25)).mul(k);
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

/**
 * Distant ice ridges: vec4(rgb, coverage). Ridge height (rad above the horizon) for a ridge
 * noise sample `n`, higher on the left (asymmetry) — mirrored on the CPU by ridgeHeightCpu()
 * for uCairnBase. Backlit ice-blue faces, gold-tipped toward the sun (stronger out in the
 * lanes). The caller hazes the colour toward ph_haze.
 */
export const phRidge = /* @__PURE__ */ Fn(([az, el, sunward, laneW, n]) => {
    const peaks = float(1.0).sub(abs(n.mul(2.0).sub(1.0)));
    const left = smoothstep(-0.15, -0.55, az).mul(0.010);
    const rh = float(0.009).add(peaks.mul(0.020)).add(sin(az.mul(31.0)).mul(0.003)).add(left);
    const depth = rh.sub(el);
    const cover = float(1.0).sub(smoothstep(-0.0007, 0.0007, depth.negate())).mul(step(-0.03, el));
    // max(depth, 0): the spec's exp(−(rh − el)/.003) overflows to +Inf above the ridge (NaN sky).
    const glow = sunward.mul(exp(max(depth, 0.0).div(0.003).negate())).mul(laneW.mul(0.5).add(0.5));
    // Faces darken slightly with depth below the crest (backlit ice).
    const face = mix(linearColor(0x8FA6CF), linearColor(0x5F77AD), smoothstep(0.0, 0.016, depth));
    return vec4(mix(face, linearColor(0xFFD39A), glow), cover);
}).setLayout({
    name: 'ph_ridge', type: 'vec4', inputs: [f('az'), f('el'), f('sunward'), f('laneW'), f('n')],
});

/**
 * The cairn: four rime-capped blocks stacked like a resting S-piece — cells (0,0),(1,0),(1,1),(2,1)
 * — on the left ridge at az −0.46, standing on `ridgeTop`. vec4(rgb, coverage).
 */
export const phCairn = /* @__PURE__ */ Fn(([az, el, ridgeTop]) => {
    // Cell space: x 0..3 across, y 0..2 up (the bottom row sunk 0.3 cell into the ridge).
    const lp = vec2(az.add(0.46).div(0.0042).add(1.5), el.sub(ridgeTop).div(0.0042).add(0.3));
    const id = floor(lp);
    const shift = id.x.sub(id.y);
    // Occupied: rows 0–1, and column − row ∈ {0, 1} → (0,0),(1,0),(1,1),(2,1).
    const occ = step(abs(shift.sub(0.5)), 0.5).mul(step(abs(id.y.sub(0.5)), 0.5));
    const fp = fract(lp).sub(0.5);
    const sd = length(max(abs(fp).sub(0.34), 0.0)).sub(0.1);
    const cover = smoothstep(0.12, -0.12, sd).mul(occ);
    // Rime on exposed top faces only: every block but (1,0), which (1,1) covers.
    const exposed = float(1.0).sub(float(1.0).sub(id.y).mul(shift));
    const rime = smoothstep(0.18, 0.30, fp.y).mul(exposed);
    // (The spec's gold sun-edge rim is sub-pixel on 4 px cells: omitted to keep the dome small.)
    return vec4(mix(linearColor(0x2A3350), linearColor(0xD8E4F4), rime), cover);
}).setLayout({ name: 'ph_cairn', type: 'vec4', inputs: [f('az'), f('el'), f('ridgeTop')] });

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
// CPU mirrors (for uniforms computed once: uCairnBase)
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

/** Ridge noise sample coordinate (shared by the dome and the CPU mirror). */
export const RIDGE_NOISE = Object.freeze({ AZ_SCALE: 5.0, ROW: 3.7 });

/**
 * CPU mirror of ph_ridgeHeight(az, n) with the dome's ridge sample: noise2(vec2(az·5, 3.7)),
 * or the Minimal tier's sine stand-in when `useNoise` is false.
 */
export function ridgeHeightCpu(az, useNoise = true) {
    const n = useNoise
        ? noise2Cpu(az * RIDGE_NOISE.AZ_SCALE, RIDGE_NOISE.ROW)
        : Math.sin(az * RIDGE_NOISE.AZ_SCALE * 1.7 + 1.1) * 0.5 + 0.5;
    const peaks = 1 - Math.abs(n * 2 - 1);
    const left = smoothstepCpu(-0.15, -0.55, az) * 0.010;
    return 0.009 + peaks * 0.020 + Math.sin(az * 31) * 0.003 + left;
}

/** Cairn azimuth (rad): x ≈ 0.17 at 16:9, on the higher left ridge. */
export const CAIRN_AZ = -0.46;

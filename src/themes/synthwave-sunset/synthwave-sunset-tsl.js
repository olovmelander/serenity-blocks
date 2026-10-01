/**
 * Synthwave Sunset — shared TSL building blocks, palette and world constants.
 *
 * World frame: the sun sits at azimuth 0, straight down −z, and the neon grid scrolls toward +z,
 * so the grid's vanishing point IS the sun. The camera yaws (see synthwave-sunset-world.js) to
 * put the sun in the free screen zone beside the gameplay board.
 *
 * Every helper here carries a `setLayout`, so TSL emits it once as a real WGSL/GLSL function
 * instead of inlining its body at every call site. No `mx_noise_*`: MaterialX Perlin is a DXC
 * compile pathology on this project's machines — value noise over a Hoskins hash is enough for
 * cloud streaks.
 *
 * Colours are authored as sRGB hex and converted to the linear working space by THREE.Color, so
 * shader constants and uniforms are scene-linear. Values above 1.0 bloom (post threshold 1.0).
 *
 * Additive materials write PREMULTIPLIED colour with alpha 1: r185's AdditiveBlending is
 * (SrcAlpha, One), so writing (col·a, a) would apply the falloff twice.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    dot,
    exp,
    float,
    floor,
    fract,
    max,
    min,
    mix,
    smoothstep,
    sqrt,
    vec2,
    vec3,
} from 'three/tsl';

// ── World constants ─────────────────────────────────────────────────────────────

/** Grid cell size (world units). Highlight cells snap to it. */
export const GRID_SPACING = 1.5;
/** Grid scroll speed toward the camera (world units / s). */
export const SCROLL_SPEED = 5.0;
/** The scroll wraps at a whole number of cells, so the wrap is seamless in float32. */
export const SCROLL_WRAP = GRID_SPACING * 512;

/** Rest camera rig. The lens is Hor+: fixed vertical FOV, horizontal FOV capped. */
export const RIG = Object.freeze({
    x: 0,
    height: 5.2,
    z: 20,
    vfov: 58,
    hFovCap: 106,
    /** Where the horizon sits, as a fraction of the screen height from the top. */
    horizonFrac: 0.575,
    near: 0.5,
    far: 8000,
});

/** Sun disc: angular radius and how far its centre stands above the horizon (× radius). */
export const SUN = Object.freeze({
    radius: THREE.MathUtils.degToRad(8.6),
    lift: 0.64,
});

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

// ── Anti-aliased lines ──────────────────────────────────────────────────────────

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
 * brightness while the camera drifts instead of popping on and off, and many cells per pixel
 * converge to the true average (b − a) with no moiré.
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

// ── Atmosphere: one horizon colour shared by sky, floor fog, city and mountains ─

/**
 * Sun alignment of a horizontal direction: 1 looking straight at the sun (−z), falling to ~0 at
 * 60° off. `dz` = z component of the NORMALISED horizontal view direction.
 */
export const swSunAlign = /* @__PURE__ */ Fn(([dz]) => exp(float(1.0).add(dz).mul(-5.5)))
    .setLayout({ name: 'sw_sunAlign', type: 'float', inputs: [{ name: 'dz', type: 'float' }] });

/**
 * The horizon haze colour for a sun alignment `sa` (0..1): dusty rose away from the sun, a warm
 * coral glow toward it. The far fog and the sky's horizon stop are this exact colour, so the
 * floor, the skyline bases and the sky meet without a seam.
 */
export const swHazeColor = /* @__PURE__ */ Fn(([sa]) => {
    const side = rgb(0x9c2a6c);
    const sun = rgb(0xff7156, 1.25);
    return mix(side, sun, sa);
}).setLayout({ name: 'sw_hazeColor', type: 'vec3', inputs: [{ name: 'sa', type: 'float' }] });

/**
 * The sky gradient over elevation e = dir.y (no sun disc, clouds or stars). The horizon stop is
 * the haze colour; the ramp runs on sqrt(e) so the warm band hugs the horizon.
 */
export const swSkyGradient = /* @__PURE__ */ Fn(([e, sa]) => {
    const s = sqrt(max(e, 0.0));
    const c = swHazeColor(sa).toVar();
    c.assign(mix(c, mix(rgb(0xb3246f), rgb(0xe0386c), sa), smoothstep(0.02, 0.17, s)));
    c.assign(mix(c, rgb(0x6a1672), smoothstep(0.12, 0.32, s)));
    c.assign(mix(c, rgb(0x2a0c55), smoothstep(0.27, 0.47, s)));
    c.assign(mix(c, rgb(0x0b0626), smoothstep(0.42, 0.72, s)));
    return c;
}).setLayout({
    name: 'sw_skyGradient',
    type: 'vec3',
    inputs: [{ name: 'e', type: 'float' }, { name: 'sa', type: 'float' }],
});

/**
 * Distance + height fog toward the horizon haze. `rel` = worldPos − cameraPos, `y` = world
 * height, `falloff` = 1/scale-height. Dense along the ground, thinning with height, so skyline
 * bases melt into the glow while the rooftops stay dark and crisp. `sunDim` thins the haze in
 * front of the sun, so solid shapes there stay silhouettes (an art choice, not physics).
 * Returns the fogged colour.
 */
export const swApplyHaze = /* @__PURE__ */ Fn(([col, rel, y, density, falloff, sunDim]) => {
    const distH = sqrt(rel.x.mul(rel.x).add(rel.z.mul(rel.z)));
    const dz = rel.z.div(max(distH, 1e-3));
    const sa = swSunAlign(dz);
    const amount = float(1.0).sub(exp(distH.mul(density).negate()))
        .mul(exp(max(y, 0.0).mul(falloff).negate()))
        .mul(float(1.0).sub(sa.mul(sunDim)));
    return mix(col, swHazeColor(sa), min(amount, 1.0));
}).setLayout({
    name: 'sw_applyHaze',
    type: 'vec3',
    inputs: [
        { name: 'col', type: 'vec3' },
        { name: 'rel', type: 'vec3' },
        { name: 'y', type: 'float' },
        { name: 'density', type: 'float' },
        { name: 'falloff', type: 'float' },
        { name: 'sunDim', type: 'float' },
    ],
});

/** Max of the three channels. */
export const swMax3 = (c) => max(c.x, max(c.y, c.z));

/**
 * Neon Dusk — shared TSL building blocks, palette and world constants.
 *
 * World frame: the sun sits at azimuth 0 (straight down −z), sinking into a pass between neon
 * mountain ranges; a glass floor with a neon grid runs from the camera to their feet. The camera
 * yaws (neon-dusk-world.js) so the sun lands in the free screen zone beside the board.
 *
 * Every helper carries a `setLayout`, so TSL emits it once as a real WGSL/GLSL function. No
 * `mx_noise_*` (a DXC compile pathology on this project's machines): value noise over a Hoskins
 * hash.
 *
 * Colours are sRGB hex converted to linear by THREE.Color; values above 1.0 bloom.
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

/** Rest camera rig: low over the glass floor. The lens is Hor+ (fixed vertical FOV). */
export const RIG = Object.freeze({
    x: 0,
    height: 7,
    z: 30,
    vfov: 54,
    hFovCap: 104,
    /** Where the horizon sits, as a fraction of the screen height from the top. */
    horizonFrac: 0.56,
    near: 0.5,
    far: 9000,
});

/** Sun: angular radius and elevation of its centre above the horizon (radians). */
export const SUN = Object.freeze({
    radius: THREE.MathUtils.degToRad(9.5),
    elevation: THREE.MathUtils.degToRad(5.2),
});

/** Grid cell size on the floor (world units) and its scroll toward the camera. */
export const GRID_SPACING = 4;
export const SCROLL_SPEED = 6;
export const SCROLL_WRAP = GRID_SPACING * 512;

/** A linear-space vec3 constant from an sRGB hex, optionally scaled (HDR). */
export function rgb(hex, scale = 1) {
    const c = new THREE.Color(hex);
    return vec3(c.r * scale, c.g * scale, c.b * scale);
}

// ── Hashes / noise ──────────────────────────────────────────────────────────────

/** vec2 → [0,1) */
export const ndHash21 = /* @__PURE__ */ Fn(([pIn]) => {
    const p3 = fract(vec3(pIn.x, pIn.y, pIn.x).mul(0.1031)).toVar();
    p3.addAssign(dot(p3, p3.yzx.add(33.33)));
    return fract(p3.x.add(p3.y).mul(p3.z));
}).setLayout({ name: 'nd_hash21', type: 'float', inputs: [{ name: 'pIn', type: 'vec2' }] });

/** vec2 → vec2 in [0,1)² */
export const ndHash22 = /* @__PURE__ */ Fn(([pIn]) => {
    const p3 = fract(vec3(pIn.x, pIn.y, pIn.x).mul(vec3(0.1031, 0.103, 0.0973))).toVar();
    p3.addAssign(dot(p3, p3.yzx.add(33.33)));
    return fract(vec2(p3.x.add(p3.y).mul(p3.z), p3.x.add(p3.z).mul(p3.y)));
}).setLayout({ name: 'nd_hash22', type: 'vec2', inputs: [{ name: 'pIn', type: 'vec2' }] });

/** Smooth 2D value noise in [0,1]. */
export const ndNoise2 = /* @__PURE__ */ Fn(([pIn]) => {
    const i = floor(pIn).toVar();
    const f = fract(pIn).toVar();
    const u = f.mul(f).mul(float(3.0).sub(f.mul(2.0)));
    const a = ndHash21(i);
    const b = ndHash21(i.add(vec2(1.0, 0.0)));
    const c = ndHash21(i.add(vec2(0.0, 1.0)));
    const d = ndHash21(i.add(vec2(1.0, 1.0)));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}).setLayout({ name: 'nd_noise2', type: 'float', inputs: [{ name: 'pIn', type: 'vec2' }] });

/** Three-octave value fbm in ~[0,1]. */
export const ndFbm3 = /* @__PURE__ */ Fn(([pIn]) => ndNoise2(pIn).mul(0.54)
    .add(ndNoise2(pIn.mul(2.03).add(vec2(17.1, 3.7))).mul(0.3))
    .add(ndNoise2(pIn.mul(4.11).add(vec2(-9.3, 11.9))).mul(0.16)))
    .setLayout({ name: 'nd_fbm3', type: 'float', inputs: [{ name: 'pIn', type: 'vec2' }] });

// ── Anti-aliased lines ──────────────────────────────────────────────────────────

/**
 * Energy-conserving anti-aliased line (after Ben Golus' "pristine grid"): d = distance from the
 * line centre, hw = half-width, fw = fwidth of the continuous coordinate d is measured in. A line
 * thinner than a pixel is drawn one pixel wide at proportionally lower intensity, so distant
 * lines fade to their true average instead of crawling into moiré.
 */
export const ndLineAA = /* @__PURE__ */ Fn(([d, hw, fw]) => {
    const w = max(hw, fw.mul(0.5));
    const edge = fw.mul(0.75);
    return float(1.0).sub(smoothstep(w.sub(edge), w.add(edge), abs(d))).mul(hw.div(w));
}).setLayout({
    name: 'nd_lineAA',
    type: 'float',
    inputs: [{ name: 'd', type: 'float' }, { name: 'hw', type: 'float' }, { name: 'fw', type: 'float' }],
});

// ── Atmosphere: one horizon colour shared by sky, floor, mountains and mist ────

/** Sun alignment of a horizontal direction (dz = z of the NORMALISED horizontal direction). */
export const ndSunAlign = /* @__PURE__ */ Fn(([dz]) => exp(float(1.0).add(dz).mul(-6.0)))
    .setLayout({ name: 'nd_sunAlign', type: 'float', inputs: [{ name: 'dz', type: 'float' }] });

/** Horizon haze: dusk violet away from the sun, hot coral toward it. */
export const ndHazeColor = /* @__PURE__ */ Fn(([sa]) => mix(rgb(0x4e2b86), rgb(0xff5a6e, 1.15), sa))
    .setLayout({ name: 'nd_hazeColor', type: 'vec3', inputs: [{ name: 'sa', type: 'float' }] });

/**
 * Dusk sky over elevation e (no sun, clouds or stars): a hot band hugging the horizon, then
 * magenta, violet and a deep indigo zenith. Runs on sqrt(e) so the warm band stays thin.
 */
export const ndSkyGradient = /* @__PURE__ */ Fn(([e, sa]) => {
    const s = sqrt(max(e, 0.0));
    const c = ndHazeColor(sa).toVar();
    c.assign(mix(c, mix(rgb(0xb02a6c), rgb(0xff6f5a, 1.1), sa), smoothstep(0.0, 0.1, s)));
    c.assign(mix(c, mix(rgb(0x6e1a68), rgb(0xc8306a), sa), smoothstep(0.06, 0.2, s)));
    c.assign(mix(c, rgb(0x341266), smoothstep(0.15, 0.32, s)));
    c.assign(mix(c, rgb(0x150b42), smoothstep(0.27, 0.5, s)));
    c.assign(mix(c, rgb(0x060418), smoothstep(0.45, 0.85, s)));
    return c;
}).setLayout({
    name: 'nd_skyGradient',
    type: 'vec3',
    inputs: [{ name: 'e', type: 'float' }, { name: 'sa', type: 'float' }],
});

/**
 * Distance haze into the horizon colour; `rel` = worldPos − cameraPos, `k` = 1/distance scale
 * (Gaussian, so the mid-field stays contrasty and the haze closes in toward the horizon).
 */
export const ndApplyHaze = /* @__PURE__ */ Fn(([col, rel, k]) => {
    const dist = sqrt(rel.x.mul(rel.x).add(rel.z.mul(rel.z)));
    const sa = ndSunAlign(rel.z.div(max(dist, 1e-3)));
    const fk = dist.mul(k);
    const amount = float(1.0).sub(exp(fk.mul(fk).negate()));
    return mix(col, ndHazeColor(sa), min(amount, 1.0));
}).setLayout({
    name: 'nd_applyHaze',
    type: 'vec3',
    inputs: [{ name: 'col', type: 'vec3' }, { name: 'rel', type: 'vec3' }, { name: 'k', type: 'float' }],
});

/** Max of the three channels. */
export const ndMax3 = (c) => max(c.x, max(c.y, c.z));

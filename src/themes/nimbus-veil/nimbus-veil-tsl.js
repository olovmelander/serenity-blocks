/**
 * Nimbus Veil — shared TSL building blocks, palette and world constants.
 *
 * World frame: the sun sits at azimuth 0 (straight down −z), low over a sea of clouds; the
 * camera yaws (nimbus-veil-world.js) so the sun lands in the free screen zone beside the board.
 *
 * Every helper carries a `setLayout`, so TSL emits it once as a real WGSL/GLSL function. No
 * `mx_noise_*` (a DXC compile pathology on this project's machines): value noise over a Hoskins
 * hash, with ANALYTIC derivatives where the cloud sea needs lighting normals — one evaluation
 * per octave instead of three extra fbm calls for finite differences.
 *
 * Colours are sRGB hex converted to linear by THREE.Color; values above 1.0 bloom.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
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

/** Rest camera rig: flying low over the cloud sea. The lens is Hor+ (fixed vertical FOV). */
export const RIG = Object.freeze({
    x: 0,
    height: 16,
    z: 20,
    vfov: 56,
    hFovCap: 104,
    /** Where the horizon sits, as a fraction of the screen height from the top. */
    horizonFrac: 0.56,
    near: 0.5,
    far: 9000,
});

/** Sun: angular radius of the bright disc and its elevation above the horizon (radians). */
export const SUN = Object.freeze({
    radius: THREE.MathUtils.degToRad(2.4),
    elevation: THREE.MathUtils.degToRad(9.5),
});

/** Cloud-sea scroll (world units / s toward the camera) — slow flight over the clouds. */
export const SEA_SPEED = 2.6;
export const SEA_WRAP = 4096;

/** A linear-space vec3 constant from an sRGB hex, optionally scaled (HDR). */
export function rgb(hex, scale = 1) {
    const c = new THREE.Color(hex);
    return vec3(c.r * scale, c.g * scale, c.b * scale);
}

// ── Hashes / noise ──────────────────────────────────────────────────────────────

/** vec2 → [0,1) */
export const nvHash21 = /* @__PURE__ */ Fn(([pIn]) => {
    const p3 = fract(vec3(pIn.x, pIn.y, pIn.x).mul(0.1031)).toVar();
    p3.addAssign(dot(p3, p3.yzx.add(33.33)));
    return fract(p3.x.add(p3.y).mul(p3.z));
}).setLayout({ name: 'nv_hash21', type: 'float', inputs: [{ name: 'pIn', type: 'vec2' }] });

/** Smooth 2D value noise in [0,1]. */
export const nvNoise2 = /* @__PURE__ */ Fn(([pIn]) => {
    const i = floor(pIn).toVar();
    const f = fract(pIn).toVar();
    const u = f.mul(f).mul(float(3.0).sub(f.mul(2.0)));
    const a = nvHash21(i);
    const b = nvHash21(i.add(vec2(1.0, 0.0)));
    const c = nvHash21(i.add(vec2(0.0, 1.0)));
    const d = nvHash21(i.add(vec2(1.0, 1.0)));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}).setLayout({ name: 'nv_noise2', type: 'float', inputs: [{ name: 'pIn', type: 'vec2' }] });

/** Three-octave value fbm in ~[0,1]. */
export const nvFbm3 = /* @__PURE__ */ Fn(([pIn]) => nvNoise2(pIn).mul(0.54)
    .add(nvNoise2(pIn.mul(2.03).add(vec2(17.1, 3.7))).mul(0.3))
    .add(nvNoise2(pIn.mul(4.11).add(vec2(-9.3, 11.9))).mul(0.16)))
    .setLayout({ name: 'nv_fbm3', type: 'float', inputs: [{ name: 'pIn', type: 'vec2' }] });

/**
 * Value noise with analytic derivatives (Inigo Quilez): returns (value, d/dx, d/dy), value in
 * [0,1]. Quintic fade so the derivative is continuous (no lighting creases on the cloud tops).
 */
export const nvNoised = /* @__PURE__ */ Fn(([pIn]) => {
    const i = floor(pIn).toVar();
    const f = fract(pIn).toVar();
    const u = f.mul(f).mul(f).mul(f.mul(f.mul(6.0).sub(15.0)).add(10.0));
    const du = f.mul(f).mul(30.0).mul(f.mul(f.sub(2.0)).add(1.0));
    const a = nvHash21(i);
    const b = nvHash21(i.add(vec2(1.0, 0.0)));
    const c = nvHash21(i.add(vec2(0.0, 1.0)));
    const d = nvHash21(i.add(vec2(1.0, 1.0)));
    const k1 = b.sub(a);
    const k2 = c.sub(a);
    const k4 = a.sub(b).sub(c).add(d);
    const value = a.add(k1.mul(u.x)).add(k2.mul(u.y)).add(k4.mul(u.x).mul(u.y));
    const deriv = du.mul(vec2(k1.add(k4.mul(u.y)), k2.add(k4.mul(u.x))));
    return vec3(value, deriv.x, deriv.y);
}).setLayout({ name: 'nv_noised', type: 'vec3', inputs: [{ name: 'pIn', type: 'vec2' }] });

/**
 * Billowy cloud-top height field: four octaves of BILLOW noise |2n − 1| (rounded puffs with
 * sharp creases between them — the cumulus look), each octave damped by the accumulated slope
 * so the crowns stay rounded (eroded-fbm trick). Derivatives stay analytic:
 * d|2n − 1| = 2·sign(2n − 1)·dn. Returns (height in ~[0,1], dh/dx, dh/dz) in units of `p`.
 */
export const nvCloudField = /* @__PURE__ */ Fn(([p]) => {
    const sum = float(0.0).toVar();
    const grad = vec2(0.0).toVar();
    const amp = float(0.55).toVar();
    const q = vec2(p).toVar();
    const freq = float(1.0).toVar();
    // JS-unrolled: four octaves is small and fixed (no Loop needed).
    for (let o = 0; o < 4; o += 1) {
        const n = nvNoised(q);
        // Softened |x| = sqrt(x² + ε): the creases between puffs round off (a hard |x| reads
        // as crumpled paper / snow dunes, not cloud).
        const centred = n.x.mul(2.0).sub(1.0);
        const billow = sqrt(centred.mul(centred).add(0.09));
        const dB = n.yz.mul(centred.div(billow).mul(2.0));
        grad.addAssign(dB.mul(amp).mul(freq));
        const damp = float(1.0).div(float(1.0).add(dot(grad, grad).mul(0.05)));
        sum.addAssign(billow.mul(amp).mul(damp));
        q.assign(vec2(q.x.mul(1.6).sub(q.y.mul(1.2)), q.x.mul(1.2).add(q.y.mul(1.6))).add(vec2(7.3, -3.1)));
        freq.mulAssign(2.0);
        amp.mulAssign(0.42);
    }
    return vec3(sum, grad.x, grad.y);
}).setLayout({ name: 'nv_cloudField', type: 'vec3', inputs: [{ name: 'p', type: 'vec2' }] });

// ── Atmosphere: one horizon colour shared by sky, cloud sea and cumulus ───────

/** Sun alignment of a horizontal direction (dz = z of the NORMALISED horizontal direction). */
export const nvSunAlign = /* @__PURE__ */ Fn(([dz]) => exp(float(1.0).add(dz).mul(-3.2)))
    .setLayout({ name: 'nv_sunAlign', type: 'float', inputs: [{ name: 'dz', type: 'float' }] });

/** Horizon haze: soft lavender-rose away from the sun, warm gold toward it. */
export const nvHazeColor = /* @__PURE__ */ Fn(([sa]) => mix(rgb(0xb895bd), rgb(0xffcb92, 1.12), sa))
    .setLayout({ name: 'nv_hazeColor', type: 'vec3', inputs: [{ name: 'sa', type: 'float' }] });

/** Sky gradient over elevation e (no sun, no cirrus): haze → peach → lavender → azure. */
export const nvSkyGradient = /* @__PURE__ */ Fn(([e, sa]) => {
    const s = sqrt(max(e, 0.0));
    const c = nvHazeColor(sa).toVar();
    c.assign(mix(c, mix(rgb(0xe9b3b8), rgb(0xffc79a), sa), smoothstep(0.02, 0.2, s)));
    c.assign(mix(c, rgb(0xa39cd0), smoothstep(0.16, 0.4, s)));
    c.assign(mix(c, rgb(0x5f7fc6), smoothstep(0.33, 0.58, s)));
    c.assign(mix(c, rgb(0x2b4f9e), smoothstep(0.5, 0.82, s)));
    return c;
}).setLayout({
    name: 'nv_skyGradient',
    type: 'vec3',
    inputs: [{ name: 'e', type: 'float' }, { name: 'sa', type: 'float' }],
});

/** Distance fog into the horizon haze; `rel` = worldPos − cameraPos. */
export const nvApplyHaze = /* @__PURE__ */ Fn(([col, rel, k]) => {
    const dist = sqrt(rel.x.mul(rel.x).add(rel.z.mul(rel.z)));
    const sa = nvSunAlign(rel.z.div(max(dist, 1e-3)));
    const fk = dist.mul(k);
    const amount = float(1.0).sub(exp(fk.mul(fk).negate()));
    return mix(col, nvHazeColor(sa), min(amount, 1.0));
}).setLayout({
    name: 'nv_applyHaze',
    type: 'vec3',
    inputs: [{ name: 'col', type: 'vec3' }, { name: 'rel', type: 'vec3' }, { name: 'k', type: 'float' }],
});

/** Max of the three channels. */
export const nvMax3 = (c) => max(c.x, max(c.y, c.z));

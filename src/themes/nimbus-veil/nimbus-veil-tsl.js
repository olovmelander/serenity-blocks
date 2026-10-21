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
    abs,
    acos,
    clamp,
    dot,
    exp,
    float,
    floor,
    fract,
    log,
    max,
    min,
    mix,
    mod,
    smoothstep,
    sqrt,
    vec2,
    vec3,
} from 'three/tsl';

// ── World constants ─────────────────────────────────────────────────────────────

/** Rest camera rig: flying low over the cloud sea. The lens is Hor+ (fixed vertical FOV). */
export const RIG = Object.freeze({
    x: 0,
    height: 24,
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

/**
 * Cloud-sea scroll (world units / s toward the camera) — slow flight over the clouds. The sea's
 * field repeats every SEA_WRAP units along the scroll (every octave's cell size divides it and
 * its hash wraps), so the scroll's wrap is seamless.
 */
export const SEA_SPEED = 2.6;
export const SEA_WRAP = 1920;

/**
 * Towering cumulus in world polar coordinates (azimuth° with the sun at 0°, distance from the
 * rest camera, height). Placed for both the game view (camera yawed ~30° right, sun in the left
 * zone) and the centred menu view; the first ones matter most (lower tiers take a prefix).
 * `lean` is the downwind drift of the crown, in tower heights along +x.
 */
export const TOWERS = Object.freeze([
    {
        az: 16, d: 700, h: 270, lean: 0.10,
    }, // beside the sun
    {
        az: 62, d: 470, h: 240, lean: 0.08,
    }, // right zone (game view)
    {
        az: -36, d: 560, h: 210, lean: 0.12,
    }, // left of the sun (menu view)
    {
        az: 80, d: 390, h: 160, lean: 0.06,
    },
    {
        az: -12, d: 980, h: 150, lean: 0.1,
    }, // far, behind the sun's left
    {
        az: 38, d: 860, h: 190, lean: 0.09,
    },
    {
        az: -60, d: 640, h: 170, lean: 0.11,
    },
].map((t) => Object.freeze({
    ...t,
    x: RIG.x + Math.sin(THREE.MathUtils.degToRad(t.az)) * t.d,
    z: RIG.z - Math.cos(THREE.MathUtils.degToRad(t.az)) * t.d,
})));

/** A tower's half-width at a fraction `yn` of its height (body tapering into a round crown). */
export function towerHalfWidth(h, yn) {
    const body = 0.37 - 0.07 * yn;
    const crown = yn > 0.78 ? Math.sqrt(Math.max(0, 1 - ((yn - 0.78) / 0.32) ** 2)) : 1;
    return h * body * crown;
}

/** The sun's direction as plain numbers, for pure (laid-out) helpers. */
export const SUN_DIR = Object.freeze([0, Math.sin(SUN.elevation), -Math.cos(SUN.elevation)]);
/** tan(sun elevation): how fast a ray toward the sun climbs per unit of horizontal travel. */
export const SUN_TAN = Math.tan(SUN.elevation);

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

/** Hoskins hash, vec2 → [0,1), written inline (laid-out helpers stay flat: see the skill notes). */
const hash21Inline = (p) => {
    const p3 = fract(vec3(p.x, p.y, p.x).mul(0.1031)).toVar();
    p3.addAssign(dot(p3, p3.yzx.add(33.33)));
    return fract(p3.x.add(p3.y).mul(p3.z));
};

/** Hoskins hash, vec2 → vec3 in [0,1), inline. */
const hash32Inline = (p) => {
    const p3 = fract(vec3(p.x, p.y, p.x).mul(vec3(0.1031, 0.103, 0.0973))).toVar();
    p3.addAssign(dot(p3, p3.yxz.add(33.33)));
    return fract(vec3(p3.x, p3.x, p3.y).add(vec3(p3.y, p3.z, p3.z)).mul(vec3(p3.z, p3.y, p3.x)));
};

/**
 * Value noise with analytic derivatives (Inigo Quilez), periodic in y with `period` cells:
 * returns (value, d/dx, d/dy), value in [0,1]. Quintic fade so the derivative is continuous.
 */
export const nvNoisedP = /* @__PURE__ */ Fn(([pIn, period]) => {
    const i = floor(pIn).toVar();
    const f = fract(pIn).toVar();
    const u = f.mul(f).mul(f).mul(f.mul(f.mul(6.0).sub(15.0)).add(10.0));
    const du = f.mul(f).mul(30.0).mul(f.mul(f.sub(2.0)).add(1.0));
    const y0 = mod(i.y, period);
    const y1 = mod(i.y.add(1.0), period);
    const a = hash21Inline(vec2(i.x, y0));
    const b = hash21Inline(vec2(i.x.add(1.0), y0));
    const c = hash21Inline(vec2(i.x, y1));
    const d = hash21Inline(vec2(i.x.add(1.0), y1));
    const k1 = b.sub(a);
    const k2 = c.sub(a);
    const k4 = a.sub(b).sub(c).add(d);
    const value = a.add(k1.mul(u.x)).add(k2.mul(u.y)).add(k4.mul(u.x).mul(u.y));
    const deriv = du.mul(vec2(k1.add(k4.mul(u.y)), k2.add(k4.mul(u.x))));
    return vec3(value, deriv.x, deriv.y);
}).setLayout({
    name: 'nv_noisedP',
    type: 'vec3',
    inputs: [{ name: 'pIn', type: 'vec2' }, { name: 'period', type: 'float' }],
});

/** Sharpness of the domes' smooth union (1 / crease width, in cells). */
const DOME_K = 9.0;

/**
 * Cumulus heads: one round dome per jittered cell (profile r·(1 − t⁴): a flat crown and steep
 * flanks), joined by a smooth maximum so neighbours meet in soft creases. Periodic in y with
 * `period` cells. Returns (height, d/dx, d/dy) in CELL units; heights run 0 (the floor between
 * heads) to ~0.95; radii vary two to one, so the heads are not one size. The gradient is exact: the union's softmax weights blend each dome's own.
 */
export const nvDomes = /* @__PURE__ */ Fn(([pIn, period]) => {
    const i = floor(pIn).toVar();
    const f = fract(pIn).toVar();
    // The floor between heads is one more term of the union: height 0, weight e⁰.
    const sumW = float(1.0).toVar();
    const sumG = vec2(0.0).toVar();
    for (let gy = -1; gy <= 1; gy += 1) {
        for (let gx = -1; gx <= 1; gx += 1) {
            const o = hash32Inline(vec2(i.x.add(gx), mod(i.y.add(gy), period)));
            const d = f.sub(vec2(gx, gy)).sub(o.xy.mul(0.7).add(0.15)).toVar();
            const r = o.z.mul(0.45).add(0.5);
            const t2 = dot(d, d).div(r.mul(r));
            const inside = float(1.0).sub(smoothstep(0.995, 1.0, t2));
            const tc = min(t2, 1.0);
            const b = r.mul(float(1.0).sub(tc.mul(tc)));
            const w = exp(b.mul(DOME_K));
            sumW.addAssign(w);
            // ∇ r(1 − t⁴) = −4 t² d / r
            sumG.addAssign(d.mul(tc.mul(-4.0).div(r)).mul(w.mul(inside)));
        }
    }
    return vec3(log(sumW).div(DOME_K), sumG.div(sumW));
}).setLayout({
    name: 'nv_domes',
    type: 'vec3',
    inputs: [{ name: 'pIn', type: 'vec2' }, { name: 'period', type: 'float' }],
});

/** The domes' height alone (shadow taps). Same cells, same union, no gradient. */
export const nvDomesH = /* @__PURE__ */ Fn(([pIn, period]) => {
    const i = floor(pIn).toVar();
    const f = fract(pIn).toVar();
    const sumW = float(1.0).toVar();
    for (let gy = -1; gy <= 1; gy += 1) {
        for (let gx = -1; gx <= 1; gx += 1) {
            const o = hash32Inline(vec2(i.x.add(gx), mod(i.y.add(gy), period)));
            const d = f.sub(vec2(gx, gy)).sub(o.xy.mul(0.7).add(0.15));
            const r = o.z.mul(0.45).add(0.5);
            const tc = min(dot(d, d).div(r.mul(r)), 1.0);
            sumW.addAssign(exp(r.mul(float(1.0).sub(tc.mul(tc))).mul(DOME_K)));
        }
    }
    return log(sumW).div(DOME_K);
}).setLayout({
    name: 'nv_domesH',
    type: 'float',
    inputs: [{ name: 'pIn', type: 'vec2' }, { name: 'period', type: 'float' }],
});

// ── Atmosphere: one horizon colour shared by sky, cloud sea and cumulus ───────

/** Sun alignment of a horizontal direction (dz = z of the NORMALISED horizontal direction). */
export const nvSunAlign = (dz) => exp(float(1.0).add(dz).mul(-3.2));

/** Horizon haze: soft lavender-rose away from the sun, warm gold toward it. */
export const nvHazeColor = (sa) => mix(rgb(0xb895bd), rgb(0xffcb92, 1.12), sa);

/**
 * The sun's light in the air along a view direction (inline): a wide warm aureole, a tight core
 * glow and a band along the horizon under the sun. Continuous across the horizon, so the sky
 * above it and the haze over the cloud sea below it carry the same light. `pulse` = the gameplay
 * sun pulse.
 */
const sunGlowInline = (dir, pulse) => {
    const ang = acos(clamp(dot(dir, vec3(SUN_DIR[0], SUN_DIR[1], SUN_DIR[2])), -1.0, 1.0));
    const wide = exp(ang.mul(-2.6)).mul(pulse.mul(0.4).add(0.55));
    const core = exp(ang.mul(-14.0)).mul(pulse.mul(1.2).add(1.1));
    const front = smoothstep(0.0, 0.5, dir.z.negate());
    const band = exp(abs(dir.y).mul(-22.0)).mul(exp(abs(dir.x).mul(-2.2))).mul(front).mul(0.5);
    return rgb(0xffb070).mul(wide).add(rgb(0xffe2b0).mul(core)).add(rgb(0xffc18a).mul(band));
};

/** The colour of the air on the horizon along a direction (inline): haze plus the sun's glow. */
const airInline = (dir, pulse) => {
    const hLen = max(sqrt(dir.x.mul(dir.x).add(dir.z.mul(dir.z))), 1e-4);
    return nvHazeColor(nvSunAlign(dir.z.div(hLen))).add(sunGlowInline(dir, pulse));
};

export const nvSunGlow = /* @__PURE__ */ Fn(([dir, pulse]) => sunGlowInline(dir, pulse)).setLayout({
    name: 'nv_sunGlow',
    type: 'vec3',
    inputs: [{ name: 'dir', type: 'vec3' }, { name: 'pulse', type: 'float' }],
});

export const nvAir = /* @__PURE__ */ Fn(([dir, pulse]) => airInline(dir, pulse)).setLayout({
    name: 'nv_air',
    type: 'vec3',
    inputs: [{ name: 'dir', type: 'vec3' }, { name: 'pulse', type: 'float' }],
});

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

/**
 * Distance fog into the colour of the air on that bearing's horizon (nvAir), so whatever stands
 * in the distance dissolves into exactly the sky behind it; `rel` = worldPos − cameraPos.
 */
export const nvApplyHaze = /* @__PURE__ */ Fn(([col, rel, k, pulse]) => {
    const dist = sqrt(rel.x.mul(rel.x).add(rel.z.mul(rel.z)));
    const fk = dist.mul(k);
    const amount = float(1.0).sub(exp(fk.mul(fk).negate()));
    // The horizon on this bearing (level direction): the sea line's own colour.
    const level = vec3(rel.x, 0.0, rel.z).div(max(dist, 1e-3));
    return mix(col, airInline(level, pulse), min(amount, 1.0));
}).setLayout({
    name: 'nv_applyHaze',
    type: 'vec3',
    inputs: [
        { name: 'col', type: 'vec3' }, { name: 'rel', type: 'vec3' },
        { name: 'k', type: 'float' }, { name: 'pulse', type: 'float' },
    ],
});

/** Max of the three channels. */
export const nvMax3 = (c) => max(c.x, max(c.y, c.z));

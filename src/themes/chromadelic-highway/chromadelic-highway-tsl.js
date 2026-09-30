/**
 * Chromadelic Highway — shared TSL building blocks.
 *
 * Every reusable helper here carries a `setLayout` so TSL emits it ONCE as a real WGSL `fn`
 * instead of inlining the body at every call site (a layout-less Fn is an inline function;
 * see docs/R185_FAST_AND_BEAUTIFUL_PLAN_2026-08.md). No `mx_noise_*` anywhere: MaterialX
 * Perlin is a DXC compile pathology on this project's Windows machines.
 *
 * Additive materials in this theme write PREMULTIPLIED colour with alpha 1: r185's
 * AdditiveBlending is (SrcAlpha, One), so writing (col·a, a) would apply the falloff twice.
 */

import {
    Fn,
    abs,
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
    sin,
    smoothstep,
    step,
    vec2,
    vec3,
} from 'three/tsl';

// ── One travel clock ────────────────────────────────────────────────────────────
// Everything that moves along the road (rings, gate lines, dashes, glitter, rail packets,
// streaks, motes) reads the same `uTravel`. It is accumulated on the CPU in double precision
// and wrapped at TRAVEL_WRAP, a common multiple of every period used on the road, so the wrap
// is seamless and float32 error stays tiny (ulp 0.008 u) even after hours of play.

export const ROAD_NEAR_Z = 400;
export const ROAD_LENGTH = 2900;
export const ROAD_HALF_WIDTH = 100;
/** Ring lattice: rings live on z ∈ [TUNNEL_Z_FAR, TUNNEL_Z_NEAR), one every RING_SPACING. */
export const TUNNEL_Z_FAR = -2640;
export const TUNNEL_Z_NEAR = 160;
export const TUNNEL_SPAN = TUNNEL_Z_NEAR - TUNNEL_Z_FAR; // 2800 = 8 · 350
export const RING_SPACING = 350;
export const DASH_PERIOD = 120;
export const RAIL_PACKET_PERIOD = 280;
/**
 * Seamless wrap: rings need 350·n | WRAP for every tier's ring count n (all divide 240),
 * streaks/motes need 2800 | WRAP·k/30 (speeds quantised to k/30), dashes 120, rail packets 280
 * at 1.6x, glitter cells 8. 84000 = 240·350 satisfies all of them.
 */
export const TRAVEL_WRAP = 84_000;
/** Ring counts must divide this so the ring lattice wraps seamlessly. */
export const RING_COUNT_MODULUS = TRAVEL_WRAP / RING_SPACING; // 240
/** Base travel speed (units/s). World speed = TRAVEL_SPEED · worldSpeedFactor(pace). */
export const TRAVEL_SPEED = 200;

/** One world speed: 180 u/s at pace 1, 150 at the slowest, 285 at pace ≥ 2.43. */
export function worldSpeedFactor(pace) {
    return Math.min(1.5, Math.max(0.75, 0.9 + 0.35 * ((Number.isFinite(pace) ? pace : 1) - 1)));
}

// ── Hashes (Dave Hoskins' hash-without-sine family) ─────────────────────────────

/** float → [0,1) */
export const chdHash11 = /* @__PURE__ */ Fn(([pIn]) => {
    const p = fract(float(pIn).mul(0.1031)).toVar();
    p.mulAssign(p.add(33.33));
    p.mulAssign(p.add(p));
    return fract(p);
}).setLayout({ name: 'chd_hash11', type: 'float', inputs: [{ name: 'pIn', type: 'float' }] });

/** vec2 → [0,1) */
export const chdHash21 = /* @__PURE__ */ Fn(([pIn]) => {
    const p3 = fract(vec3(pIn.x, pIn.y, pIn.x).mul(0.1031)).toVar();
    p3.addAssign(dot(p3, p3.yzx.add(33.33)));
    return fract(p3.x.add(p3.y).mul(p3.z));
}).setLayout({ name: 'chd_hash21', type: 'float', inputs: [{ name: 'pIn', type: 'vec2' }] });

/** vec3 → [0,1) */
export const chdHash31 = /* @__PURE__ */ Fn(([pIn]) => {
    const p = fract(vec3(pIn).mul(0.1031)).toVar();
    p.addAssign(dot(p, p.zyx.add(31.32)));
    return fract(p.x.add(p.y).mul(p.z));
}).setLayout({ name: 'chd_hash31', type: 'float', inputs: [{ name: 'pIn', type: 'vec3' }] });

/** Smooth 2D value noise in [0,1]. */
export const chdNoise2 = /* @__PURE__ */ Fn(([pIn]) => {
    const i = floor(pIn).toVar();
    const f = fract(pIn).toVar();
    const u = f.mul(f).mul(float(3.0).sub(f.mul(2.0)));
    const a = chdHash21(i);
    const b = chdHash21(i.add(vec2(1.0, 0.0)));
    const c = chdHash21(i.add(vec2(0.0, 1.0)));
    const d = chdHash21(i.add(vec2(1.0, 1.0)));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}).setLayout({ name: 'chd_noise2', type: 'float', inputs: [{ name: 'pIn', type: 'vec2' }] });

// ── Anti-aliased lines ──────────────────────────────────────────────────────────

/**
 * Energy-conserving anti-aliased line (after Ben Golus' "pristine grid"): d = signed distance
 * from the line centre, hw = half-width, fw = fwidth of the CONTINUOUS coordinate d is measured
 * in (never of a fract()-wrapped one — the wrap spikes the derivative). When the line is thinner
 * than a pixel it is drawn one pixel wide at proportionally lower intensity, so distant lines fade
 * to their true average instead of crawling or fattening into a bright sheet.
 */
export const chdLineAA = /* @__PURE__ */ Fn(([d, hw, fw]) => {
    const w = max(hw, fw.mul(0.5));
    const edge = fw.mul(0.75);
    return float(1.0).sub(smoothstep(w.sub(edge), w.add(edge), abs(d))).mul(hw.div(w));
}).setLayout({
    name: 'chd_lineAA',
    type: 'float',
    inputs: [{ name: 'd', type: 'float' }, { name: 'hw', type: 'float' }, { name: 'fw', type: 'float' }],
});

// ── Colour ──────────────────────────────────────────────────────────────────────

/**
 * Smooth spectral rainbow (Inigo Quilez cosine palette): no hard hue corners and near-constant
 * luminance, so a flowing rainbow never flashes yellow/cyan bands. Hue by t (true mapping):
 *   0 red · 1/6 magenta · 1/4 violet · 1/3 blue · 5/12 azure · 1/2 cyan · 2/3 green ·
 *   3/4 lime · 5/6 yellow · 11/12 orange → 1 red.
 */
export const chdSpectrum = /* @__PURE__ */ Fn(([tIn]) => {
    const t = float(tIn);
    const phase = vec3(0.0, 0.33, 0.67);
    return vec3(0.5).add(vec3(0.5).mul(cos(t.add(phase).mul(6.28318))));
}).setLayout({ name: 'chd_spectrum', type: 'vec3', inputs: [{ name: 'tIn', type: 'float' }] });

/** Rec.709 luminance. */
export const chdLuma = /* @__PURE__ */ Fn(([c]) => dot(c, vec3(0.2126, 0.7152, 0.0722)))
    .setLayout({ name: 'chd_luma', type: 'float', inputs: [{ name: 'c', type: 'vec3' }] });

// ── Light waves (event language) ────────────────────────────────────────────────

/**
 * One travelling light wave at world z. Everything that depends only on the wave (its age,
 * envelope, front position, colour) is resolved on the CPU once per frame (see
 * ChromadelicWorld.updateWaves); per fragment only the gaussian front remains.
 *   A = (zFront, 1/width, energy, useLocal)   B = (r, g, b, whiteMix)
 * Returns (front·energy, energy).
 */
export const chdWaveTerm = /* @__PURE__ */ Fn(([z, A]) => {
    const d = z.sub(A.x).mul(A.y);
    return exp(d.mul(d).negate()).mul(A.z);
}).setLayout({
    name: 'chd_waveTerm',
    type: 'float',
    inputs: [{ name: 'z', type: 'float' }, { name: 'A', type: 'vec4' }],
});

/**
 * Sum the wave slots at world z (JS-unrolled over a small fixed slot count).
 * @returns {{ amount: Node<float>, color: Node<vec3> }} total front energy (capped at 1.2) and
 *   its colour (already weighted by the capped amount).
 */
export function chdWaves(z, waves, localColor) {
    let amount = float(0.0);
    let color = vec3(0.0);
    for (let i = 0; i < waves.count; i += 1) {
        const A = waves.uA.element(i);
        const B = waves.uB.element(i);
        const w = chdWaveTerm(z, A);
        const base = mix(B.xyz, localColor, A.w);
        const col = mix(base, vec3(1.0), B.w);
        amount = amount.add(w);
        color = color.add(col.mul(w));
    }
    const capped = min(amount, 1.2);
    return { amount: capped, color: color.div(max(amount, 0.0001)).mul(capped) };
}

// ── Screen-space helpers ────────────────────────────────────────────────────────

/** Max of the three channels (TSL has no max3). */
export const chdMax3 = (c) => max(c.x, max(c.y, c.z));

/**
 * Signed distance (px, positive outside) from p to a rounded box. `rect` = (x0, y0, x1, y1) in
 * drawing-buffer px with a top-left origin (p = screenUV · viewportPx on both backends).
 */
export const chdRoundBoxSdf = /* @__PURE__ */ Fn(([p, rect, radius]) => {
    const c = rect.xy.add(rect.zw).mul(0.5);
    const h = rect.zw.sub(rect.xy).mul(0.5);
    const q = abs(p.sub(c)).sub(h).add(radius);
    return length(max(q, vec2(0.0))).add(min(max(q.x, q.y), 0.0)).sub(radius);
}).setLayout({
    name: 'chd_roundBoxSdf',
    type: 'float',
    inputs: [{ name: 'p', type: 'vec2' }, { name: 'rect', type: 'vec4' }, { name: 'radius', type: 'float' }],
});

/**
 * Value-aware soft clip on the max channel: identity below L/2, an exponential shoulder that
 * approaches L above it. Hue is preserved (the colour is scaled, not clamped per channel).
 */
export const chdSoftClip = /* @__PURE__ */ Fn(([c, L]) => {
    const m = max(chdMax3(c), 1e-5);
    const k = L.mul(0.5);
    const shoulder = k.add(L.sub(k).mul(float(1.0).sub(exp(m.sub(k).div(L.sub(k)).negate()))));
    const mOut = mix(m, shoulder, step(k, m));
    return c.mul(mOut.div(m));
}).setLayout({
    name: 'chd_softClip',
    type: 'vec3',
    inputs: [{ name: 'c', type: 'vec3' }, { name: 'L', type: 'float' }],
});

// ── Road curve (GPU twin of ChromadelicWorld.sampleRoadCurve) ──────────────────

/**
 * Lateral wander of the highway, in world units, for a point at world z. MUST stay
 * formula-identical to the CPU sampler (`sampleRoadCurve`): the road, rails and particles
 * are bent on the GPU while rings, planets and the camera sample the same curve on the CPU.
 *   t = max(0, (200 - z) / 2700);  s = t*t;  ts = time * 0.075
 *   x = sin(t*2.5+ts)*260*s + sin(t*1.2+ts*0.5)*160*s + cos(t*1.8+ts*0.75)*100*s
 *   y = sin(t*1.5+ts*0.33)*30*s
 */
export const chdRoadCurve = /* @__PURE__ */ Fn(([z, time]) => {
    const t = max(float(0.0), float(200.0).sub(z).div(2700.0));
    const s = t.mul(t);
    const ts = time.mul(0.075);
    const x = sin(t.mul(2.5).add(ts)).mul(260.0)
        .add(sin(t.mul(1.2).add(ts.mul(0.5))).mul(160.0))
        .add(cos(t.mul(1.8).add(ts.mul(0.75))).mul(100.0))
        .mul(s);
    const y = sin(t.mul(1.5).add(ts.mul(0.33))).mul(30.0).mul(s);
    return vec3(x, y, float(0.0));
}).setLayout({
    name: 'chd_roadCurve',
    type: 'vec3',
    inputs: [{ name: 'z', type: 'float' }, { name: 'time', type: 'float' }],
});

/** CPU twin of chdSpectrum. */
export function spectrumRGB(t, out = { r: 0, g: 0, b: 0 }) {
    out.r = 0.5 + 0.5 * Math.cos(2 * Math.PI * t);
    out.g = 0.5 + 0.5 * Math.cos(2 * Math.PI * (t + 0.33));
    out.b = 0.5 + 0.5 * Math.cos(2 * Math.PI * (t + 0.67));
    return out;
}

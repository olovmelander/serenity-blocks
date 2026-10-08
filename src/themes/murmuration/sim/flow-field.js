/* eslint-disable import/no-unresolved */
/**
 * Murmuration — the flow field the swarm rides.
 *
 * A sum of transverse shear waves (Kraichnan's kinematic turbulence): each wave moves the
 * medium along a direction D at right angles to its wave vector K, so every term — and
 * each octave's sum — is divergence-free. Particles carried by it do not pile up or thin
 * out; they fold into ribbons and sheets the way a flock or a plume of ink does.
 *
 *   v(p, t) = Σ aᵢ · Dᵢ · cos(Kᵢ · p + ωᵢ t + φᵢ)
 *
 * Two octaves. The fine octave is sampled at a point displaced by the coarse one, which
 * bends its straight wave fronts into eddies — at the price of a little divergence (a few
 * per cent of the shear), which is too small to see as clumping.
 *
 * The table below is the single source for both backends: `flowFieldNode` emits it as TSL
 * constants for the compute shader, `sampleFlowField` evaluates the same sum on the CPU
 * (WebGL2). One cosine per wave, no lattice noise, so the compute pipeline compiles fast.
 */
import { cos, dot, vec3 } from 'three/tsl';

/** How far (in seconds of coarse flow) the fine octave's sample point is carried. */
export const FLOW_WARP = 0.55;

function wave(kx, ky, kz, ax, ay, az, wavelength, amplitude, speed, phase) {
    const kLen = Math.hypot(kx, ky, kz) || 1;
    const k = [kx / kLen, ky / kLen, kz / kLen];
    // D = K × A, normalised: perpendicular to K whatever the helper axis is.
    let d = [
        k[1] * az - k[2] * ay,
        k[2] * ax - k[0] * az,
        k[0] * ay - k[1] * ax,
    ];
    const dLen = Math.hypot(d[0], d[1], d[2]) || 1;
    d = d.map((c) => (c / dLen) * amplitude);
    const scale = (Math.PI * 2) / wavelength;
    return Object.freeze({
        k: Object.freeze(k.map((c) => c * scale)),
        d: Object.freeze(d),
        speed,
        phase,
    });
}

// Coarse octave: the slow weather of the swarm. Wavelengths of 9–16 world units, against a
// swarm about 19 across — two or three folds are in view at any time.
export const FLOW_COARSE = Object.freeze([
    wave(0.86, 0.42, 0.28, 0, 0, 1, 15.5, 1.00, 0.21, 0.4),
    wave(-0.38, 0.88, 0.27, 1, 0, 0, 10.5, 0.82, -0.17, 2.1),
    wave(0.31, -0.24, 0.92, 0, 1, 0, 12.5, 0.74, 0.13, 4.4),
]);

// Fine octave: the eddies inside the folds.
export const FLOW_FINE = Object.freeze([
    wave(0.62, 0.71, -0.33, 0, 0, 1, 5.6, 0.50, 0.46, 1.3),
    wave(-0.74, 0.33, 0.58, 0, 1, 0, 4.3, 0.42, -0.39, 3.7),
    wave(0.21, -0.83, 0.52, 1, 0, 0, 6.7, 0.46, 0.33, 5.2),
    wave(-0.48, -0.52, -0.71, 0, 0, 1, 3.6, 0.34, -0.51, 0.9),
]);

// ─── CPU ───────────────────────────────────────────────────────────────────
// A cosine table keeps the WebGL2 step at a few nanoseconds per wave.
const LUT_BITS = 11;
const LUT_SIZE = 1 << LUT_BITS;
const LUT_MASK = LUT_SIZE - 1;
const LUT_SCALE = LUT_SIZE / (Math.PI * 2);
const COS_LUT = new Float32Array(LUT_SIZE);
for (let i = 0; i < LUT_SIZE; i += 1) COS_LUT[i] = Math.cos((i / LUT_SIZE) * Math.PI * 2);

/** cos(x) from the table; exact to about 0.3 %. */
export function fastCos(x) {
    // eslint-disable-next-line no-bitwise
    return COS_LUT[Math.floor(x * LUT_SCALE) & LUT_MASK];
}

// The waves flattened to six floats each (k xyz, d xyz), coarse first, and their phases
// for the current step: the per-mote loop then costs three multiplies and a table read
// per wave.
const WAVES = [...FLOW_COARSE, ...FLOW_FINE];
const COARSE_COUNT = FLOW_COARSE.length;
const WAVE_COUNT = WAVES.length;
const FLAT = new Float64Array(WAVE_COUNT * 6);
WAVES.forEach((w, i) => {
    FLAT.set([w.k[0], w.k[1], w.k[2], w.d[0], w.d[1], w.d[2]], i * 6);
});
const PHASE = new Float64Array(WAVE_COUNT);

/** Fix the field's clock for a batch of samples (once per simulation step). */
export function prepareFlowField(time) {
    for (let i = 0; i < WAVE_COUNT; i += 1) PHASE[i] = WAVES[i].speed * time + WAVES[i].phase;
}

/**
 * The flow velocity at a point for the time given to `prepareFlowField`, written into
 * `out` (a 3-array). No allocation.
 */
export function sampleFlowPrepared(x, y, z, out, coarseGain = 1, fineGain = 1) {
    /* eslint-disable no-bitwise */
    let vx = 0; let vy = 0; let vz = 0;
    for (let i = 0; i < COARSE_COUNT; i += 1) {
        const o = i * 6;
        const c = COS_LUT[((FLAT[o] * x + FLAT[o + 1] * y + FLAT[o + 2] * z + PHASE[i]) * LUT_SCALE) & LUT_MASK];
        vx += FLAT[o + 3] * c; vy += FLAT[o + 4] * c; vz += FLAT[o + 5] * c;
    }
    const wx = x + vx * FLOW_WARP; const wy = y + vy * FLOW_WARP; const wz = z + vz * FLOW_WARP;
    let fx = 0; let fy = 0; let fz = 0;
    for (let i = COARSE_COUNT; i < WAVE_COUNT; i += 1) {
        const o = i * 6;
        const c = COS_LUT[((FLAT[o] * wx + FLAT[o + 1] * wy + FLAT[o + 2] * wz + PHASE[i]) * LUT_SCALE) & LUT_MASK];
        fx += FLAT[o + 3] * c; fy += FLAT[o + 4] * c; fz += FLAT[o + 5] * c;
    }
    /* eslint-enable no-bitwise */
    out[0] = vx * coarseGain + fx * fineGain;
    out[1] = vy * coarseGain + fy * fineGain;
    out[2] = vz * coarseGain + fz * fineGain;
    return out;
}

/**
 * The flow velocity at a point and time, written into `out` (a 3-array). No allocation.
 * @param {number} x @param {number} y @param {number} z @param {number} time
 * @param {number[]|Float32Array} out
 */
export function sampleFlowField(x, y, z, time, out, coarseGain = 1, fineGain = 1) {
    prepareFlowField(time);
    return sampleFlowPrepared(x, y, z, out, coarseGain, fineGain);
}

// ─── TSL ───────────────────────────────────────────────────────────────────
function sumWaves(waves, point, time) {
    let total = null;
    waves.forEach((w) => {
        const phase = dot(point, vec3(w.k[0], w.k[1], w.k[2])).add(time.mul(w.speed)).add(w.phase);
        const term = vec3(w.d[0], w.d[1], w.d[2]).mul(cos(phase));
        total = total ? total.add(term) : term;
    });
    return total;
}

/**
 * The same field as a TSL expression. Call inside a `Fn`; `point` is a vec3 node in world
 * space, `time` a float node; the gains weigh the two octaves (floats or float nodes).
 */
export function flowFieldNode(point, time, coarseGain = 1, fineGain = 1) {
    const coarse = sumWaves(FLOW_COARSE, point, time).toVar();
    const fine = sumWaves(FLOW_FINE, point.add(coarse.mul(FLOW_WARP)), time);
    return coarse.mul(coarseGain).add(fine.mul(fineGain));
}

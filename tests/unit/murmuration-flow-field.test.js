import { describe, expect, it } from 'vitest';
import {
    FLOW_COARSE, FLOW_FINE, FLOW_WARP, fastCos, prepareFlowField, sampleFlowField, sampleFlowPrepared,
} from '../../src/themes/murmuration/sim/flow-field.js';

/** A repeatable source of sample points (an LCG), so a failure names the same point twice. */
function sampler(seed = 20261008) {
    let state = seed;
    const next = () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0; // eslint-disable-line no-bitwise
        return state / 4294967296;
    };
    return () => ({
        x: (next() - 0.5) * 30, y: (next() - 0.5) * 16, z: (next() - 0.5) * 14, t: next() * 600,
    });
}

/** One octave straight from the table, with the real cosine. */
function sumWaves(waves, x, y, z, t) {
    const out = [0, 0, 0];
    for (const w of waves) {
        const c = Math.cos(w.k[0] * x + w.k[1] * y + w.k[2] * z + w.speed * t + w.phase);
        out[0] += w.d[0] * c; out[1] += w.d[1] * c; out[2] += w.d[2] * c;
    }
    return out;
}
const coarseOnly = (x, y, z, t) => sumWaves(FLOW_COARSE, x, y, z, t);
const fineOnly = (x, y, z, t) => sumWaves(FLOW_FINE, x, y, z, t);
/** The documented field: the coarse octave plus the fine one sampled where the coarse flow carries the point. */
function reference(x, y, z, t) {
    const c = coarseOnly(x, y, z, t);
    const f = fineOnly(x + c[0] * FLOW_WARP, y + c[1] * FLOW_WARP, z + c[2] * FLOW_WARP, t);
    return [c[0] + f[0], c[1] + f[1], c[2] + f[2]];
}
const cpuField = (x, y, z, t) => [...sampleFlowField(x, y, z, t, [0, 0, 0])];

/** Central differences: the divergence and the size of the whole velocity gradient at a point. */
function gradient(field, {
    x, y, z, t,
}, h) {
    const px = field(x + h, y, z, t); const mx = field(x - h, y, z, t);
    const py = field(x, y + h, z, t); const my = field(x, y - h, z, t);
    const pz = field(x, y, z + h, t); const mz = field(x, y, z - h, t);
    const rows = [px.map((v, i) => v - mx[i]), py.map((v, i) => v - my[i]), pz.map((v, i) => v - mz[i])]
        .map((row) => row.map((v) => v / (2 * h)));
    return { divergence: rows[0][0] + rows[1][1] + rows[2][2], shear: Math.hypot(...rows.flat()) };
}

function meanGradient(field, h, samples = 600) {
    const point = sampler();
    let divergence = 0;
    let shear = 0;
    let worst = 0;
    for (let i = 0; i < samples; i += 1) {
        const g = gradient(field, point(), h);
        divergence += Math.abs(g.divergence);
        shear += g.shear;
        worst = Math.max(worst, Math.abs(g.divergence));
    }
    return { divergence: divergence / samples, shear: shear / samples, worst };
}

const amplitude = (waves) => waves.reduce((sum, w) => sum + Math.hypot(...w.d), 0);

describe('murmuration flow field: the wave table', () => {
    it('moves the medium at right angles to every wave vector', () => {
        // D ⟂ K is what makes each wave, and so each octave, divergence-free.
        for (const w of [...FLOW_COARSE, ...FLOW_FINE]) {
            const kLen = Math.hypot(...w.k);
            const dLen = Math.hypot(...w.d);
            expect(kLen).toBeGreaterThan(0);
            expect(dLen).toBeGreaterThan(0);
            expect(Math.abs(w.k[0] * w.d[0] + w.k[1] * w.d[1] + w.k[2] * w.d[2]) / (kLen * dLen)).toBeLessThan(1e-12);
            expect(Number.isFinite(w.speed) && Number.isFinite(w.phase)).toBe(true);
        }
    });

    it('keeps every wave of the fine octave shorter than any wave of the coarse one', () => {
        const wavelengths = (waves) => waves.map((w) => (Math.PI * 2) / Math.hypot(...w.k));
        expect(Math.max(...wavelengths(FLOW_FINE))).toBeLessThan(Math.min(...wavelengths(FLOW_COARSE)));
    });
});

describe('murmuration flow field: the CPU sampler', () => {
    it('is finite everywhere and never faster than its amplitudes allow', () => {
        const limit = amplitude(FLOW_COARSE) + amplitude(FLOW_FINE);
        const point = sampler();
        const out = [0, 0, 0];
        let fastest = 0;
        for (let i = 0; i < 4000; i += 1) {
            const p = point();
            expect(sampleFlowField(p.x * 4, p.y * 4, p.z * 4, p.t * 20 - 3000, out)).toBe(out);
            expect(out.every(Number.isFinite)).toBe(true);
            fastest = Math.max(fastest, Math.hypot(...out));
        }
        expect(fastest).toBeLessThanOrEqual(limit + 1e-9);
        // It is a flow, not a trickle: somewhere it runs at a fair share of that.
        expect(fastest).toBeGreaterThan(limit * 0.25);
        // It writes into whatever three-slot buffer it is handed.
        const typed = sampleFlowField(1, 2, 3, 4, new Float32Array(3));
        const plain = sampleFlowField(1, 2, 3, 4, [0, 0, 0]);
        expect([...typed]).toEqual(plain.map(Math.fround));
    });

    it('evaluates the table: coarse waves, plus fine waves at the point the coarse flow carries it to', () => {
        const point = sampler();
        let worst = 0;
        for (let i = 0; i < 4000; i += 1) {
            const p = point();
            const cpu = cpuField(p.x, p.y, p.z, p.t);
            const exact = reference(p.x, p.y, p.z, p.t);
            worst = Math.max(worst, Math.hypot(cpu[0] - exact[0], cpu[1] - exact[1], cpu[2] - exact[2]));
        }
        // The cosine table costs a fraction of a percent of the field's speed; a wrong k, d, phase
        // or a missing warp would cost tens of percent.
        expect(worst).toBeLessThan((amplitude(FLOW_COARSE) + amplitude(FLOW_FINE)) * 0.006);
    });

    it('agrees with the prepared pair it is built from', () => {
        const point = sampler(7);
        const a = [0, 0, 0];
        const b = [0, 0, 0];
        for (let i = 0; i < 500; i += 1) {
            const p = point();
            sampleFlowField(p.x, p.y, p.z, p.t, a);
            prepareFlowField(p.t);
            sampleFlowPrepared(p.x, p.y, p.z, b);
            expect(b).toEqual(a);
        }
        // The prepared clock holds for a whole batch of samples, until it is set again.
        prepareFlowField(12);
        const first = [...sampleFlowPrepared(1, 2, 3, [0, 0, 0])];
        sampleFlowPrepared(-4, 0.5, 2, [0, 0, 0]);
        expect([...sampleFlowPrepared(1, 2, 3, [0, 0, 0])]).toEqual(first);
        expect(first).toEqual(cpuField(1, 2, 3, 12));
        prepareFlowField(40);
        expect([...sampleFlowPrepared(1, 2, 3, [0, 0, 0])]).toEqual(cpuField(1, 2, 3, 40));
        expect(cpuField(1, 2, 3, 40)).not.toEqual(first);
    });

    it('weighs the two octaves with their own gains', () => {
        const field = (p, coarse, fine) => [...sampleFlowField(p.x, p.y, p.z, p.t, [0, 0, 0], coarse, fine)];
        const point = sampler(3);
        const coarseLimit = amplitude(FLOW_COARSE) * 0.006;
        for (let i = 0; i < 300; i += 1) {
            const p = point();
            const both = cpuField(p.x, p.y, p.z, p.t);
            const coarse = field(p, 1, 0);
            const fine = field(p, 0, 1);
            expect(field(p, 1, 1)).toEqual(both); // the default
            expect(field(p, 0, 0).map(Math.abs)).toEqual([0, 0, 0]);
            const exact = coarseOnly(p.x, p.y, p.z, p.t);
            for (let c = 0; c < 3; c += 1) {
                // Coarse alone is the coarse table.
                expect(Math.abs(coarse[c] - exact[c])).toBeLessThan(coarseLimit);
                // The gains only weigh the sum; the fine octave stays carried by the full coarse flow.
                expect(coarse[c] + fine[c]).toBeCloseTo(both[c], 9);
                expect(field(p, 2, 0.5)[c]).toBeCloseTo(2 * coarse[c] + 0.5 * fine[c], 9);
            }
            prepareFlowField(p.t);
            expect([...sampleFlowPrepared(p.x, p.y, p.z, [0, 0, 0], 2, 0.5)]).toEqual(field(p, 2, 0.5));
        }
    });

    it('varies with time and with place, smoothly', () => {
        const here = cpuField(2, -1, 0.5, 10);
        expect(cpuField(2, -1, 0.5, 14)).not.toEqual(here);
        expect(cpuField(5, -1, 0.5, 10)).not.toEqual(here);
        expect(cpuField(2, -1, 0.5, 10)).toEqual(here);
        // A frame later, a hair away: nearly the same velocity.
        const next = cpuField(2.01, -1, 0.5, 10 + 1 / 60);
        expect(Math.hypot(next[0] - here[0], next[1] - here[1], next[2] - here[2])).toBeLessThan(0.05);
        // It never settles: over a minute the velocity at one point swings through a wide range.
        let low = Infinity;
        let high = -Infinity;
        for (let t = 0; t < 60; t += 0.5) {
            const [vx] = cpuField(2, -1, 0.5, t);
            low = Math.min(low, vx);
            high = Math.max(high, vx);
        }
        expect(high - low).toBeGreaterThan(1);
    });
});

describe('murmuration flow field: divergence', () => {
    it('is divergence-free octave by octave', () => {
        // Exact for a sum of transverse waves; what is left is the central difference's own error.
        expect(meanGradient(coarseOnly, 1e-3).worst).toBeLessThan(1e-6);
        expect(meanGradient(fineOnly, 1e-3).worst).toBeLessThan(1e-6);
        // And it is a real shear, not a field that is flat because it is zero.
        expect(meanGradient(coarseOnly, 1e-3).shear).toBeGreaterThan(0.2);
        expect(meanGradient(fineOnly, 1e-3).shear).toBeGreaterThan(0.2);
    });

    it('is divergence-free on the CPU too, for the coarse octave on its own', () => {
        // The sampler reads a cosine TABLE: a step function, whose derivative over a tiny step is
        // noise. Over several table cells the central difference is the field's own gradient again.
        const cpuCoarse = (x, y, z, t) => [...sampleFlowField(x, y, z, t, [0, 0, 0], 1, 0)];
        const coarse = meanGradient(cpuCoarse, 0.25);
        expect(coarse.shear).toBeGreaterThan(0.2);
        expect(coarse.divergence).toBeLessThan(coarse.shear * 0.02);
        expect(coarse.worst).toBeLessThan(coarse.shear * 0.1);
    });

    it('stays nearly so once the fine octave is warped: the warp costs a few percent of the shear', () => {
        // NOT exactly divergence-free. The fine octave is sampled at p + FLOW_WARP · coarse(p), and
        // composing a divergence-free field with a non-uniform displacement is no longer
        // divergence-free: div = -FLOW_WARP · Σ sin(φ_fine) · D_fine · ∇(K_fine · coarse). Measured
        // (2026-10) it averages about 7 % of the velocity gradient, where the un-warped sum is 0 %:
        // the swarm is carried almost, not exactly, without compression. So this asserts "small" —
        // an upper bound that a truly divergence-free warp would also pass — and not "zero".
        const warped = meanGradient(reference, 1e-3);
        expect(warped.divergence).toBeLessThan(warped.shear * 0.15);

        const h = 0.25; // several cells of the cosine table, so its steps do not read as gradient
        const cpu = meanGradient(cpuField, h);
        expect(cpu.shear).toBeGreaterThan(0.5);
        expect(cpu.divergence).toBeLessThan(cpu.shear * 0.15);
        expect(cpu.worst).toBeLessThan(cpu.shear);
    });
});

describe('murmuration flow field: fastCos', () => {
    it('tracks Math.cos within 1 % over any phase the simulation can reach', () => {
        let worst = 0;
        for (let i = 0; i <= 40000; i += 1) {
            const x = -1000 + i * 0.05 + 0.0123;
            worst = Math.max(worst, Math.abs(fastCos(x) - Math.cos(x)));
        }
        expect(worst).toBeLessThan(0.01);
        // Hours into a session the phase is large; the table still wraps cleanly.
        for (const x of [1e5 + 0.3, -1e5 - 0.3, 2.5e6]) expect(Math.abs(fastCos(x) - Math.cos(x))).toBeLessThan(0.01);
        expect(fastCos(0)).toBe(1);
        expect(fastCos(Math.PI)).toBeCloseTo(-1, 4);
        expect(fastCos(-Math.PI / 2)).toBeCloseTo(0, 2);
        expect(fastCos(Math.PI * 2 * 7)).toBeCloseTo(1, 4);
        // Even, like the real thing, to within one table step.
        expect(fastCos(-1.234)).toBeCloseTo(fastCos(1.234), 2);
    });
});

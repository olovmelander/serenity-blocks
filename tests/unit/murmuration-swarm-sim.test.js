import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import { Vector3 } from 'three/webgpu';
import {
    EMITTER_COUNT, FLUID_BUDGETS, FluidParticleSim, IMPULSE_TYPE, MAX_IMPULSES, NATIVE_FLUID_COUNTS, getFluidBudget,
} from '../../src/themes/murmuration/sim/fluid-particles.js';

const { RADIAL, VORTEX } = IMPULSE_TYPE;
/** The swarm as the theme builds it on the High tier (landscape). */
const SWARM = Object.freeze({
    cpu: true, focalRadius: 9.5, gravityStrength: 0.65, turbulence: 0.6,
});
const EPS = 1e-4;

/** A swarm with the flow and the walls off: only impulses and formations move a mote. */
function makeStill(count = 1) {
    const sim = new FluidParticleSim(count, { cpu: true, gravityStrength: 0, turbulence: 0 });
    sim.positionData.fill(0);
    sim.velocityData.fill(0);
    for (let i = 0; i < count; i += 1) sim.velocityData[i * 4 + 3] = 100;
    sim.uDamping.value = 1;
    return sim;
}

function place(sim, i, x, y, z) {
    sim.positionData.set([x, y, z], i * 4);
}

/** A mote in swarm space: half-extent units about the focal point; `off` = distance off the tilted disc. */
function swarmSpace(sim, i) {
    const focal = sim.uFocalPoint.value;
    const extent = sim.uExtent.value;
    const tilt = sim.uTilt.value;
    const x = (sim.positionData[i * 4] - focal.x) / extent.x;
    const y = (sim.positionData[i * 4 + 1] - focal.y) / extent.y;
    const z = (sim.positionData[i * 4 + 2] - focal.z) / extent.z;
    return {
        x, y, z, r: Math.hypot(x, y), off: z - (x * tilt.x + y * tilt.y),
    };
}

const snapshot = (sim) => ({
    positions: Array.from(sim.positionData),
    velocities: Array.from(sim.velocityData),
    colors: Array.from(sim.colorData),
});

function step(sim, frames, from = 0, params = undefined) {
    let time = from;
    for (let i = 0; i < frames; i += 1) {
        time += 1 / 60;
        sim.update(1 / 60, time, params);
        sim.stepCPU();
    }
    return time;
}

/** Make every mote die on the next step. */
function expireAll(sim) {
    for (let i = 0; i < sim.count; i += 1) {
        sim.positionData[i * 4 + 3] = 0.999;
        sim.velocityData[i * 4 + 3] = 0.001;
    }
}

afterEach(() => { vi.restoreAllMocks(); });

describe('murmuration swarm: budgets', () => {
    it('carries more motes on the native path than the CPU is asked to step', () => {
        expect(Object.keys(NATIVE_FLUID_COUNTS)).toEqual(Object.keys(FLUID_BUDGETS));
        const names = Object.keys(FLUID_BUDGETS);
        names.forEach((name, i) => {
            const cpu = getFluidBudget(name);
            const native = getFluidBudget(name, { native: true });
            expect(cpu).toEqual(FLUID_BUDGETS[name]);
            expect(cpu).not.toBe(FLUID_BUDGETS[name]); // a copy the caller may change
            // Only the count differs: the swarm is the same size and held the same way.
            expect(native).toEqual({ ...FLUID_BUDGETS[name], count: NATIVE_FLUID_COUNTS[name] });
            expect(native.count).toBeGreaterThan(cpu.count);
            if (i > 0) {
                expect(cpu.count).toBeGreaterThan(getFluidBudget(names[i - 1]).count);
                expect(native.count).toBeGreaterThan(getFluidBudget(names[i - 1], { native: true }).count);
            }
        });
        // Anything but `native: true` is the CPU budget; an unknown tier is High.
        expect(getFluidBudget('Low', { native: 'yes' }).count).toBe(FLUID_BUDGETS.Low.count);
        expect(getFluidBudget('nope')).toEqual(FLUID_BUDGETS.High);
        expect(getFluidBudget(undefined, { native: true }).count).toBe(NATIVE_FLUID_COUNTS.High);
    });
});

describe('murmuration swarm: the free swarm on the CPU', () => {
    it('composes its first frame from the seed, and reset(seed) brings that frame back', () => {
        const sim = new FluidParticleSim(400, { ...SWARM, seed: 11 });
        const twin = new FluidParticleSim(400, { ...SWARM, seed: 11 });
        const first = snapshot(sim);
        expect(snapshot(twin)).toEqual(first);
        expect(snapshot(new FluidParticleSim(400, { ...SWARM, seed: 12 })).positions).not.toEqual(first.positions);

        sim.pushImpulse(new Vector3(2, 1, 0), 6, null, RADIAL, { speed: 9, flash: 1 });
        step(sim, 40);
        expect(snapshot(sim).positions).not.toEqual(first.positions);
        sim.reset(11);
        expect(snapshot(sim)).toEqual(first);
        // Nothing of the old run is left behind: it now steps exactly as a new swarm does.
        step(sim, 5);
        step(twin, 5);
        expect(snapshot(sim)).toEqual(snapshot(twin));

        // No seed keeps the one it has; another seed is another swarm.
        sim.reset();
        expect(snapshot(sim)).toEqual(first);
        sim.reset(12);
        expect(snapshot(sim).positions).not.toEqual(first.positions);
        sim.reset(11);
        expect(snapshot(sim)).toEqual(first);
    });

    it('starts as dust and ribbons already trailing from their sources', () => {
        const sim = new FluidParticleSim(3000, SWARM);
        const ambient = sim.uAmbient.value;
        const sources = sim.uEmitters.array;
        const extent = sim.uExtent.value;
        let dust = 0;
        const ribbon = [];
        for (let i = 0; i < sim.count; i += 1) {
            const j = i * 4;
            const q = swarmSpace(sim, i);
            expect(Number.isFinite(q.x + q.y + q.z)).toBe(true);
            expect(Math.max(Math.abs(q.x), Math.abs(q.y), Math.abs(q.z))).toBeLessThan(2);
            expect(sim.positionData[j + 3]).toBeGreaterThanOrEqual(0); // age
            expect(sim.positionData[j + 3]).toBeLessThan(1);
            expect(sim.velocityData[j + 3]).toBeGreaterThan(1); // lifetime, seconds
            expect(sim.colorData[j + 2]).toBe(0); // no flash before the first wave
            if (sim.colorData[j + 1] <= ambient) {
                dust += 1;
            } else {
                const source = sources[i % EMITTER_COUNT];
                ribbon.push({
                    flown: sim.positionData[j + 3] * sim.velocityData[j + 3],
                    away: Math.hypot(
                        (sim.positionData[j] - source.x) / extent.x,
                        (sim.positionData[j + 1] - source.y) / extent.y,
                    ),
                });
            }
        }
        // The ambient share of the motes is dust; the rest ride a ribbon.
        expect(dust / sim.count).toBeGreaterThan(ambient - 0.05);
        expect(dust / sim.count).toBeLessThan(ambient + 0.05);
        // A mote that has only just left is still at its source; the old ones have been carried off.
        ribbon.sort((a, b) => a.flown - b.flown);
        const mean = (motes) => motes.reduce((sum, mote) => sum + mote.away, 0) / motes.length;
        const young = mean(ribbon.slice(0, Math.floor(ribbon.length / 20)));
        const old = mean(ribbon.slice(-Math.floor(ribbon.length / 4)));
        expect(young).toBeLessThan(old * 0.5);
    });

    it.each([
        ['at rest', {}, undefined],
        ['stirred hard by a long chain', {}, { turbulence: 1.3, gyre: 0.9 }],
        ['in a phone\'s tall frame', { extent: new Vector3(2.47, 4.55, 4.37) }, undefined],
    ])('stays in its ring for ten seconds %s', (name, options, params) => {
        const sim = new FluidParticleSim(300, { ...SWARM, ...options });
        const first = snapshot(sim).positions;
        let time = 0;
        for (let second = 0; second < 10; second += 1) {
            time = step(sim, 60, time, params);
            const all = [...sim.positionData, ...sim.velocityData, ...sim.colorData];
            expect(all.every(Number.isFinite), `finite after ${second + 1} s`).toBe(true);
            for (let i = 0; i < sim.count; i += 1) {
                const q = swarmSpace(sim, i);
                // No escape: a mote may lean on a soft wall, never leave the neighbourhood.
                expect(Math.max(Math.abs(q.x), Math.abs(q.y), Math.abs(q.z))).toBeLessThan(2);
                expect(Math.hypot(sim.velocityData[i * 4], sim.velocityData[i * 4 + 1], sim.velocityData[i * 4 + 2]))
                    .toBeLessThanOrEqual(sim.uMaxSpeed.value + EPS);
                expect(sim.colorData[i * 4 + 3]).toBeGreaterThanOrEqual(0); // energy
                expect(sim.colorData[i * 4 + 3]).toBeLessThanOrEqual(1);
            }
        }
        // It flew: this was not a swarm standing still inside its bounds.
        let moved = 0;
        for (let i = 0; i < sim.count; i += 1) {
            moved += Math.hypot(
                sim.positionData[i * 4] - first[i * 4],
                sim.positionData[i * 4 + 1] - first[i * 4 + 1],
            );
        }
        expect(moved / sim.count).toBeGreaterThan(0.5);
        sim.dispose();
    });
});

describe('murmuration swarm: what moves a free mote', () => {
    /** One mote in the middle of the ring, on the disc, at rest: no wall touches it. */
    function adrift(options = {}) {
        const sim = new FluidParticleSim(1, { ...SWARM, ...options });
        const extent = sim.uExtent.value;
        const tilt = sim.uTilt.value;
        place(sim, 0, 0.6 * extent.x, 0, 0.6 * tilt.x * extent.z);
        sim.velocityData.set([0, 0, 0, 100]);
        sim.positionData[3] = 0;
        return sim;
    }
    const drift = (sim) => {
        const from = [...sim.positionData.slice(0, 3)];
        step(sim, 60);
        return Math.hypot(sim.positionData[0] - from[0], sim.positionData[1] - from[1], sim.positionData[2] - from[2]);
    };

    it('is the gyre and the two octaves of the flow, each with its own gain', () => {
        const still = adrift({ gyre: 0, flowCoarse: 0, flowFine: 0 });
        expect(still.uFlowGains.value.toArray()).toEqual([0, 0]);
        expect(drift(still)).toBe(0);
        // Any one of the three carries it.
        expect(drift(adrift({ flowCoarse: 0, flowFine: 0 }))).toBeGreaterThan(0.05);
        expect(drift(adrift({ gyre: 0, flowFine: 0 }))).toBeGreaterThan(0.05);
        expect(drift(adrift({ gyre: 0, flowCoarse: 0 }))).toBeGreaterThan(0.01);
        // By default both octaves are on.
        expect(adrift().uFlowGains.value.toArray()).toEqual([1, 1]);
    });

    it('gives each mote its own idea of where the walls are, so the rim frays', () => {
        // Two motes at the same place on the nominal outer edge, nothing moving them but the walls.
        const sim = new FluidParticleSim(2, {
            ...SWARM, gyre: 0, flowCoarse: 0, flowFine: 0,
        });
        const extent = sim.uExtent.value;
        for (let i = 0; i < 2; i += 1) {
            place(sim, i, sim.uRing.value.y * extent.x, 0, sim.uRing.value.y * sim.uTilt.value.x * extent.z);
            sim.velocityData.set([0, 0, 0, 100], i * 4);
            sim.positionData[i * 4 + 3] = 0;
        }
        sim.colorData[0] = 0.02; // seedA
        sim.colorData[4] = 0.98;
        step(sim, 60);
        const [a, b] = [swarmSpace(sim, 0).r, swarmSpace(sim, 1).r];
        expect(Math.abs(a - b)).toBeGreaterThan(0.01);
        // Neither is thrown anywhere: the walls are soft.
        expect(Math.max(a, b)).toBeLessThanOrEqual(sim.uRing.value.y + EPS);
        expect(Math.min(a, b)).toBeGreaterThan(sim.uRing.value.y * 0.5);
    });
});

describe('murmuration swarm: sources and rebirth', () => {
    it('keeps its sources inside the ring, wandering slowly', () => {
        const sim = new FluidParticleSim(EMITTER_COUNT, SWARM);
        const sources = sim.uEmitters.array;
        expect(sources).toHaveLength(EMITTER_COUNT);
        const ring = sim.uRing.value;
        const extent = sim.uExtent.value;
        const tilt = sim.uTilt.value;
        const at = (time) => {
            sim.update(1 / 60, time);
            return sources.map((s) => ({ x: s.x, y: s.y, z: s.z }));
        };
        let before = at(0);
        const start = before;
        // No two ribbons start from the same place.
        const places = start.map((source) => `${source.x.toFixed(3)},${source.y.toFixed(3)}`);
        expect(new Set(places).size).toBe(EMITTER_COUNT);
        let wandered = 0;
        for (let time = 1; time <= 240; time += 1) {
            const now = at(time);
            for (let k = 0; k < EMITTER_COUNT; k += 1) {
                const source = now[k];
                const qx = (source.x - sim.uFocalPoint.value.x) / extent.x;
                const qy = (source.y - sim.uFocalPoint.value.y) / extent.y;
                const qz = (source.z - sim.uFocalPoint.value.z) / extent.z;
                const r = Math.hypot(qx, qy);
                expect(r).toBeGreaterThan(ring.x);
                expect(r).toBeLessThan(ring.y);
                expect(Math.abs(qz - (qx * tilt.x + qy * tilt.y))).toBeLessThan(0.8); // within the disc
                expect(sources[k].w).toBeGreaterThan(0); // the spread a ribbon is born with
                // A source drifts; it never jumps (a jump would cut its ribbon).
                expect(Math.hypot(source.x - before[k].x, source.y - before[k].y, source.z - before[k].z))
                    .toBeLessThan(extent.x * 0.15);
                wandered = Math.max(wandered, Math.hypot(source.x - start[k].x, source.y - start[k].y));
            }
            before = now;
        }
        // Over minutes they do go somewhere.
        expect(wandered).toBeGreaterThan(extent.x * 0.2);

        // The spread follows the swarm's size: a phone's narrow loop gets finer sources.
        const wide = sources[0].w;
        sim.setExtent(2.47, 4.55, 4.37);
        sim.update(1 / 60, 241);
        expect(sources[0].w).toBeLessThan(wide);
        expect(sources[0].w).toBeGreaterThan(0);
        expect(Math.abs(sources[0].x - sim.uFocalPoint.value.x)).toBeLessThan(2.47);
    });

    it('rebirths a ribbon mote at its own source and a dust mote anywhere in the ring', () => {
        const sim = new FluidParticleSim(600, SWARM);
        const ambient = sim.uAmbient.value;
        // Even motes ride a ribbon, odd motes are dust.
        for (let i = 0; i < sim.count; i += 1) sim.colorData[i * 4 + 1] = i % 2 ? ambient * 0.5 : (1 + ambient) / 2;
        expireAll(sim);
        sim.update(1 / 60, 3.7);
        sim.stepCPU();
        const sources = sim.uEmitters.array;
        const ring = sim.uRing.value;
        const dustAngles = new Set();
        for (let i = 0; i < sim.count; i += 1) {
            const j = i * 4;
            expect(sim.positionData[j + 3]).toBe(0);
            expect([...sim.velocityData.slice(j, j + 3)]).toEqual([0, 0, 0]);
            if (i % 2 === 0) {
                const source = sources[i % EMITTER_COUNT];
                expect(Math.abs(sim.positionData[j] - source.x)).toBeLessThanOrEqual(source.w + EPS);
                expect(Math.abs(sim.positionData[j + 1] - source.y)).toBeLessThanOrEqual(source.w + EPS);
                expect(Math.abs(sim.positionData[j + 2] - source.z)).toBeLessThanOrEqual(source.w + EPS);
            } else {
                const q = swarmSpace(sim, i);
                expect(q.r).toBeGreaterThanOrEqual(ring.x - EPS);
                expect(q.r).toBeLessThanOrEqual(ring.y + EPS);
                expect(Math.abs(q.off)).toBeLessThanOrEqual(0.8 + EPS);
                dustAngles.add(Math.floor(((Math.atan2(q.y, q.x) + Math.PI) / (Math.PI * 2)) * 8) % 8);
            }
        }
        // Dust is reborn all round the ring, not at the sources.
        expect(dustAngles.size).toBe(8);
        // Every source feeds a ribbon.
        const fed = new Set();
        for (let i = 0; i < sim.count; i += 2) fed.add(i % EMITTER_COUNT);
        expect(fed.size).toBeGreaterThan(1);
    });

    it('lets `ambientShare` turn the whole swarm into dust, or into ribbons', () => {
        const nearSource = (sim) => {
            const sources = sim.uEmitters.array;
            let near = 0;
            for (let i = 0; i < sim.count; i += 1) {
                const source = sources[i % EMITTER_COUNT];
                const offset = Math.max(
                    Math.abs(sim.positionData[i * 4] - source.x),
                    Math.abs(sim.positionData[i * 4 + 1] - source.y),
                    Math.abs(sim.positionData[i * 4 + 2] - source.z),
                );
                if (offset <= source.w + EPS) near += 1;
            }
            return near;
        };
        const rebirth = (ambientShare) => {
            const sim = new FluidParticleSim(300, { ...SWARM, ambientShare });
            expect(sim.uAmbient.value).toBe(ambientShare);
            expireAll(sim);
            sim.update(1 / 60, 9.1);
            sim.stepCPU();
            return nearSource(sim);
        };
        expect(rebirth(0)).toBe(300);
        expect(rebirth(1)).toBeLessThan(60); // only the dust that happens to land beside a source
    });

    it('rebirths a mote that a formation holds on its target, posed as the formation is', () => {
        const sim = makeStill(2);
        sim.targetData.set([1, 0.5, 0, 1, /* a free mote: */ 3, 3, 3, 0]);
        sim.setShapeStrength(1);
        sim.setShapePose(Math.PI / 2, 2);
        expireAll(sim);
        sim.update(1 / 60, 1);
        sim.stepCPU();
        // Scaled by two, then a quarter turn about the vertical axis.
        expect(sim.positionData[0]).toBeCloseTo(0, 5);
        expect(sim.positionData[1]).toBeCloseTo(1, 5);
        expect(sim.positionData[2]).toBeCloseTo(-2, 5);
        expect(sim.positionData[3]).toBe(0);
        // The free one went back to the swarm instead of to where its (unweighted) target would be.
        expect(Math.hypot(sim.positionData[4] - 6, sim.positionData[5] - 6, sim.positionData[6] + 6))
            .toBeGreaterThan(1);
        expect(sim.positionData[7]).toBe(0);
    });
});

describe('murmuration swarm: impulses', () => {
    it('sends a wave\'s ring outward while its push and its light fade', () => {
        const sim = makeStill();
        const slot = sim.pushImpulse(new Vector3(1, 2, 3), 5, null, RADIAL, {
            speed: 8, width: 1.2, flash: 0.9, decay: 2,
        });
        const strength = () => sim._impulsePositions[slot].value.w;
        const ring = () => sim._impulseWaves[slot].value;
        expect(ring().x).toBe(0);
        expect(ring().y).toBeGreaterThan(0); // a width is what makes it a wave
        sim.decayImpulses(0.1);
        const radius = ring().x;
        const after = { strength: strength(), flash: ring().z };
        expect(radius).toBeGreaterThan(0);
        expect(after.strength).toBeLessThan(5);
        expect(after.flash).toBeLessThan(0.9);
        // The light fades with the push.
        expect(after.flash / 0.9).toBeCloseTo(after.strength / 5, 6);
        sim.decayImpulses(0.1);
        expect(ring().x).toBeCloseTo(radius * 2, 6);
        expect(strength()).toBeLessThan(after.strength);

        // The same wave in ten small steps is in the same place.
        const fine = makeStill();
        const fineSlot = fine.pushImpulse(new Vector3(1, 2, 3), 5, null, RADIAL, {
            speed: 8, width: 1.2, flash: 0.9, decay: 2,
        });
        for (let i = 0; i < 20; i += 1) fine.decayImpulses(0.01);
        expect(fine._impulseWaves[fineSlot].value.x).toBeCloseTo(ring().x, 5);
        expect(fine._impulsePositions[fineSlot].value.w).toBeCloseTo(strength(), 5);

        // update() is what drives it in the theme's frame.
        sim.update(1 / 60, 1);
        expect(ring().x).toBeGreaterThan(radius * 2);

        // It retires itself, and its slot is the next one handed out.
        for (let i = 0; i < 200; i += 1) sim.decayImpulses(0.033);
        expect(strength()).toBe(0);
        expect(ring().z).toBe(0);
        expect(sim.pushImpulse(new Vector3(), 1)).toBe(slot);
    });

    it('keeps a blunt impulse where it is, and lets it die sooner than a wave', () => {
        const sim = makeStill();
        const blunt = sim.pushImpulse(new Vector3(), 5, null, VORTEX);
        const wave = sim.pushImpulse(new Vector3(), 5, null, RADIAL, {});
        expect(blunt).not.toBe(wave);
        expect(sim._impulseWaves[blunt].value.y).toBe(0);
        sim.decayImpulses(0.2);
        expect(sim._impulseWaves[blunt].value.x).toBe(0);
        expect(sim._impulseWaves[wave].value.x).toBeGreaterThan(0);
        expect(sim._impulsePositions[blunt].value.w).toBeLessThan(sim._impulsePositions[wave].value.w);
    });

    it('lights and pushes a mote on the ring, and leaves one far from it alone', () => {
        const sim = makeStill(3);
        place(sim, 0, 3, 0, 0); // on the ring
        place(sim, 1, 14, 0, 0); // the ring has not reached it
        place(sim, 2, 0.2, 0, 0); // the ring has passed it
        sim.pushImpulse(new Vector3(), 4, null, RADIAL, {
            radius: 3, speed: 0, width: 0.5, flash: 1, decay: 0.2,
        });
        sim.update(1 / 240, 1); // a short step: the light it leaves is read before it fades
        sim.stepCPU();
        expect(sim.colorData[2]).toBeGreaterThan(0.3);
        expect(sim.velocityData[0]).toBeGreaterThan(0); // outward
        expect(sim.colorData[4 + 2]).toBe(0);
        expect(sim.velocityData[4]).toBe(0);
        expect(sim.colorData[8 + 2]).toBe(0);
        expect(sim.velocityData[8]).toBe(0);

        // Once the wave has gone the flash dies away on its own.
        const lit = sim.colorData[2];
        for (let i = 0; i < MAX_IMPULSES; i += 1) sim._impulsePositions[i].value.w = 0;
        step(sim, 120, 1);
        expect(sim.colorData[2]).toBeLessThan(lit * 0.05);
        expect(sim.colorData[2]).toBeGreaterThanOrEqual(0);
    });

    it('lays a squashed ring down as an ellipse along the rows', () => {
        const sim = makeStill(3);
        const squash = 2.5;
        place(sim, 0, 3, 0, 0); // along the row: on the ring
        place(sim, 1, 0, 3, 0); // the same distance above it: far outside
        place(sim, 2, 0, 3 / squash, 0); // the ellipse's short axis
        sim.pushImpulse(new Vector3(), 4, null, RADIAL, {
            radius: 3, speed: 0, width: 0.4, flash: 1, squash, decay: 0.2,
        });
        sim.update(1 / 240, 1);
        sim.stepCPU();
        expect(sim.colorData[2]).toBeGreaterThan(0.3);
        expect(sim.colorData[4 + 2]).toBe(0);
        expect(sim.colorData[8 + 2]).toBeGreaterThan(0.3);
        // The push is still straight out from the origin.
        expect(sim.velocityData[8 + 1]).toBeGreaterThan(0);
        expect(sim.velocityData[8]).toBe(0);
    });

    it('draws a wave as a ring on screen: depth barely counts toward its distance', () => {
        const sim = makeStill(3);
        place(sim, 0, 3, 0, 0); // on the ring, in the focal plane
        place(sim, 1, 3, 0, 2); // the same place on screen, deeper in the swarm
        place(sim, 2, 5, 0, 0); // as far off the ring, but across the screen
        sim.pushImpulse(new Vector3(), 4, null, RADIAL, {
            radius: 3, speed: 0, width: 0.5, flash: 1, decay: 0.2,
        });
        sim.update(1 / 240, 1);
        sim.stepCPU();
        expect(sim.colorData[2]).toBeGreaterThan(0.3);
        expect(sim.colorData[4 + 2]).toBeGreaterThan(sim.colorData[2] * 0.6);
        expect(sim.colorData[8 + 2]).toBeLessThan(sim.colorData[2] * 0.001);
    });

    it('replaces the weakest impulse when all the slots are busy', () => {
        const sim = makeStill();
        const strengths = [5, 3, 8, 1.5, 6, 7, 4, 2];
        expect(strengths).toHaveLength(MAX_IMPULSES);
        const slots = strengths.map((strength, i) => sim.pushImpulse(new Vector3(i, 0, 0), strength));
        expect(new Set(slots).size).toBe(MAX_IMPULSES);

        const weakest = slots[strengths.indexOf(Math.min(...strengths))];
        expect(sim.pushImpulse(new Vector3(9, 9, 9), 4.5, new Vector3(0, 0, -1), VORTEX)).toBe(weakest);
        slots.forEach((slot, i) => {
            const held = sim._impulsePositions[slot].value;
            if (slot === weakest) {
                expect(held.toArray()).toEqual([9, 9, 9, 4.5]);
                expect(sim._impulseParams[slot].value.toArray()).toEqual([0, 0, -1, VORTEX]);
            } else {
                expect(held.toArray()).toEqual([i, 0, 0, strengths[i]]);
            }
        });
        // The next one takes the next weakest: nothing is dropped, nothing grows.
        const next = slots[strengths.indexOf(2)];
        expect(sim.pushImpulse(new Vector3(), 9)).toBe(next);
        expect(sim._impulsePositions).toHaveLength(MAX_IMPULSES);
    });
});

describe('murmuration swarm: formations', () => {
    const spans = (sim) => {
        let width = 0;
        let height = 0;
        for (let i = 0; i < sim.count; i += 1) {
            width = Math.max(width, Math.abs(sim.targetData[i * 4]));
            height = Math.max(height, Math.abs(sim.targetData[i * 4 + 1]));
        }
        return { width, height };
    };

    it('scales an authored shape down to the frame it is given, and never up', () => {
        const sim = new FluidParticleSim(1500, { cpu: true });
        expect(sim.setShape('torus', { jitter: 0 })).toBe(true);
        expect(sim.currentShape).toBe('torus');
        const authored = Array.from(sim.targetData);
        const full = spans(sim);
        expect(sim.shapeFitScale).toBe(1); // no frame yet: as authored

        // A phone: the width is what binds.
        const frame = { width: full.width * 0.25, height: full.height * 0.6 };
        sim.setShapeFit(frame.width, frame.height);
        sim.setShape('torus', { jitter: 0 });
        expect(sim.shapeFitScale).toBeCloseTo(0.25, 6);
        expect(spans(sim).width).toBeCloseTo(frame.width, 4);
        expect(spans(sim).height).toBeLessThanOrEqual(frame.height + EPS);
        // One scale for all three axes: the figure keeps its proportions.
        for (let i = 0; i < sim.count; i += 1) {
            const j = i * 4;
            expect(sim.targetData[j]).toBeCloseTo(authored[j] * 0.25, 4);
            expect(sim.targetData[j + 1]).toBeCloseTo(authored[j + 1] * 0.25, 4);
            expect(sim.targetData[j + 2]).toBeCloseTo(authored[j + 2] * 0.25, 4);
            expect(sim.targetData[j + 3]).toBe(authored[j + 3]);
        }
        // A short, wide frame: the height binds instead.
        sim.setShapeFit(full.width * 2, full.height * 0.5);
        sim.setShape('torus', { jitter: 0 });
        expect(sim.shapeFitScale).toBeCloseTo(0.5, 6);
        expect(spans(sim).height).toBeCloseTo(full.height * 0.5, 4);

        // Room to spare, or no frame at all: as authored.
        for (const [width, height] of [[full.width * 3, full.height * 3], [0, 0], [-1, NaN]]) {
            sim.setShapeFit(width, height);
            sim.setShape('torus', { jitter: 0 });
            expect(sim.shapeFitScale).toBe(1);
            expect(Array.from(sim.targetData)).toEqual(authored);
        }
    });

    it('tells the renderer how large the fitted figure is, for its colour gradient', () => {
        const sim = new FluidParticleSim(1500, { cpu: true });
        const before = sim.uShapeSpan.value;
        expect(before).toBeGreaterThan(0);

        sim.setShape('torus', { jitter: 0 });
        const full = spans(sim);
        expect(sim.uShapeSpan.value).toBeCloseTo(Math.max(full.width, full.height), 5);

        // Fitted to a quarter of its width: the span follows the figure, not the authoring.
        sim.setShapeFit(full.width * 0.25, full.height);
        sim.setShape('torus', { jitter: 0 });
        expect(sim.uShapeSpan.value).toBeCloseTo(Math.max(full.width, full.height) * 0.25, 5);

        // A frame small enough to crush the figure never gives a span near zero (the
        // renderer divides by it), and releasing the figure keeps the last span for its fade.
        sim.setShapeFit(0.01, 0.01);
        sim.setShape('torus', { jitter: 0 });
        expect(sim.uShapeSpan.value).toBe(0.5);
        sim.setShape('free');
        expect(sim.uShapeSpan.value).toBe(0.5);
    });

    it('scatters each target a little, the same way every time', () => {
        const sim = new FluidParticleSim(1500, { cpu: true });
        sim.setShapeFit(3, 3);
        sim.setShape('torus', { jitter: 0 });
        const lattice = Array.from(sim.targetData);
        const { width, height } = spans(sim);

        const jitter = 0.1;
        sim.setShape('torus', { jitter });
        const scattered = Array.from(sim.targetData);
        let moved = 0;
        let farthest = 0;
        for (let i = 0; i < sim.count; i += 1) {
            const j = i * 4;
            const offset = Math.hypot(
                scattered[j] - lattice[j],
                scattered[j + 1] - lattice[j + 1],
                scattered[j + 2] - lattice[j + 2],
            );
            if (offset > 1e-6) moved += 1;
            farthest = Math.max(farthest, offset);
            expect(scattered[j + 3]).toBe(lattice[j + 3]);
        }
        // Nearly every mote is off its lattice point, none by more than the jitter asked for.
        expect(moved).toBeGreaterThan(sim.count * 0.95);
        expect(farthest).toBeGreaterThan(jitter * 0.1);
        expect(farthest).toBeLessThanOrEqual(jitter + EPS);
        // So the figure still fits its frame, to within that scatter.
        expect(spans(sim).width).toBeLessThanOrEqual(width + jitter + EPS);
        expect(spans(sim).height).toBeLessThanOrEqual(height + jitter + EPS);

        // Deterministic: the same call lands every mote in the same place, on any swarm.
        sim.setShape('torus', { jitter });
        expect(Array.from(sim.targetData)).toEqual(scattered);
        const twin = new FluidParticleSim(1500, { cpu: true });
        twin.setShapeFit(3, 3);
        twin.setShape('torus', { jitter });
        expect(Array.from(twin.targetData)).toEqual(scattered);

        // There is a default scatter too.
        sim.setShape('torus');
        expect(Array.from(sim.targetData)).not.toEqual(lattice);
    });

    it('draws a twinned formation as a mirrored pair either side of the focal point', () => {
        const sim = makeStill(64);
        sim.setShapeFit(9, 5);
        sim.setShapeLayout({
            twin: true, offsetX: 6, halfWidth: 2, halfHeight: 4,
        });
        expect(sim.setShape('torus', { jitter: 0 })).toBe(true);
        // Each copy is fitted to its own box, not to the whole frame.
        expect(spans(sim).width).toBeLessThanOrEqual(2 + EPS);
        expect(sim.uShapeTwin.value.toArray()).toEqual([1, 6]);

        // Two motes with the same target: the seed decides which copy a mote belongs to.
        sim.targetData.set([1, 0.5, 0.25, 1, 1, 0.5, 0.25, 1]);
        sim.colorData[0] = 0.9;
        sim.colorData[4] = 0.1;
        sim.setShapeStrength(1);
        expireAll(sim);
        sim.update(1 / 60, 1);
        sim.stepCPU();
        expect([...sim.positionData.slice(0, 3)]).toEqual([7, 0.5, 0.25]);
        // The other copy is its mirror image, not a translation.
        expect([...sim.positionData.slice(4, 7)]).toEqual([-7, 0.5, 0.25]);

        // A new layout waits for the next formation: the figure on screen keeps the one it has.
        sim.setShapeLayout({ twin: false });
        expect(sim.uShapeTwin.value.x).toBe(1);
        sim.setShape('torus', { jitter: 0 });
        expect(sim.uShapeTwin.value.toArray()).toEqual([0, 0]);
        expect(spans(sim).width).toBeGreaterThan(2);
        expect(spans(sim).width).toBeLessThanOrEqual(9 + EPS);
    });

    it('keeps one centred figure when asked to, or when the pair has nowhere to go', () => {
        const sim = makeStill(64);
        sim.setShapeFit(9, 5);
        sim.setShapeLayout({
            twin: true, offsetX: 6, halfWidth: 2, halfHeight: 4,
        });
        // The game-over heart asks for the centre whatever the layout is.
        sim.setShape('heart', { jitter: 0, layout: 'center' });
        expect(sim.uShapeTwin.value.toArray()).toEqual([0, 0]);
        expect(spans(sim).width).toBeGreaterThan(2);
        sim.targetData.set([1, 0.5, 0, 1, 1, 0.5, 0, 1]);
        sim.colorData[0] = 0.9;
        sim.colorData[4] = 0.1;
        sim.setShapeStrength(1);
        expireAll(sim);
        sim.update(1 / 60, 1);
        sim.stepCPU();
        expect([...sim.positionData.slice(0, 3)]).toEqual([1, 0.5, 0]);
        expect([...sim.positionData.slice(4, 7)]).toEqual([1, 0.5, 0]);

        // A pair with no offset is not a pair; nor is no layout at all.
        for (const layout of [{ twin: true, offsetX: 0 }, { twin: 'yes', offsetX: 6 }, {}, undefined]) {
            sim.setShapeLayout(layout);
            sim.setShape('torus');
            expect(sim.uShapeTwin.value.x).toBe(0);
        }
    });

    it('leaves the dust in the flow when a figure is asked to keep it', () => {
        const sim = new FluidParticleSim(400, { cpu: true });
        const ambient = sim.uAmbient.value;
        const held = () => {
            let dust = 0;
            let ribbon = 0;
            for (let i = 0; i < sim.count; i += 1) {
                if (sim.targetData[i * 4 + 3] > 0) {
                    if (sim.colorData[i * 4 + 1] <= ambient) dust += 1;
                    else ribbon += 1;
                }
            }
            return { dust, ribbon };
        };
        // By default (the game-over heart) the whole swarm gathers.
        sim.setShape('heart');
        const whole = held();
        expect(whole.dust).toBeGreaterThan(0);
        expect(whole.dust + whole.ribbon).toBe(sim.count);
        // A figure drawn for a play forms from the ribbons, in front of dust that keeps moving.
        sim.setShape('torus', { keepDust: true });
        expect(held()).toEqual({ dust: 0, ribbon: whole.ribbon });
        // And the next figure that wants everyone gets everyone back.
        sim.setShape('heart');
        expect(held()).toEqual(whole);
    });

    it('refuses an unknown shape, and releases on \'free\'', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const sim = new FluidParticleSim(64, { cpu: true });
        sim.setShape('heart');
        const heart = Array.from(sim.targetData);
        const { version } = sim.targetBuffer;
        expect(sim.setShape('nope')).toBe(false);
        expect(warn).toHaveBeenCalledOnce();
        expect(sim.currentShape).toBe('heart');
        expect(Array.from(sim.targetData)).toEqual(heart);
        expect(sim.targetBuffer.version).toBe(version);

        expect(sim.setShape('free')).toBe(true);
        expect(sim.currentShape).toBe('free');
        expect(sim.targetBuffer.version).toBeGreaterThan(version);
        for (let i = 0; i < sim.count; i += 1) expect(sim.targetData[i * 4 + 3]).toBe(0);
    });
});

describe('murmuration swarm: the board\'s hole', () => {
    it('sizes the ring\'s inner radius to the board, within limits', () => {
        const sim = new FluidParticleSim(4, SWARM);
        const extent = sim.uExtent.value.x;
        const outer = sim.uRing.value.y;
        const hole = (halfWidth) => {
            sim.setBoardZone({ halfExtents: new Vector3(halfWidth, 4, 0.4) });
            return sim.uRing.value.x;
        };
        const widths = [0.001, 0.05, 1, 2, 3, 4, 6, 9, 50, 5000];
        const holes = widths.map(hole);
        for (let i = 1; i < holes.length; i += 1) expect(holes[i]).toBeGreaterThanOrEqual(holes[i - 1]);
        // Always a hole, and always a ring left round it.
        expect(holes[0]).toBeGreaterThan(0);
        expect(holes.at(-1)).toBeLessThan(outer * 0.75);
        // Clamped at both ends: a speck of a board and no board are the same hole, as are huge ones.
        expect(holes[1]).toBe(holes[0]);
        expect(holes.at(-2)).toBe(holes.at(-1));
        // In between the hole follows the board: about as wide as the board, never wider.
        for (const halfWidth of [2, 3, 4]) {
            const world = hole(halfWidth) * extent;
            expect(world).toBeLessThanOrEqual(halfWidth);
            expect(world).toBeGreaterThan(halfWidth * 0.75);
        }
        // It is a share of the swarm's width, so a narrower swarm gives the same board a larger share.
        const wide = hole(2);
        sim.setExtent(extent / 2, sim.uExtent.value.y, sim.uExtent.value.z);
        expect(hole(2)).toBeGreaterThan(wide);
    });

    it('keeps what it was told and ignores what makes no sense', () => {
        const sim = new FluidParticleSim(4, SWARM);
        const inner = sim.uRing.value.x;
        expect(() => sim.setBoardZone()).not.toThrow();
        sim.setBoardZone({ halfExtents: new Vector3(0, 0, 0), strength: NaN, softness: 'soft' });
        sim.setBoardZone({ halfExtents: new Vector3(-3, 1, 1) });
        sim.setBoardZone({ halfExtents: new Vector3(NaN, 1, 1) });
        expect(sim.uRing.value.x).toBe(inner);
        sim.setBoardZone({ center: new Vector3(1, 2, -1) });
        expect(sim.uBoardCenter.value.toArray()).toEqual([1, 2, -1]);
        expect(sim.uRing.value.x).toBe(inner);
    });
});

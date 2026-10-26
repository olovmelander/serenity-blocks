/**
 * Koi Pond — what floats answers what happens in the pond (koi-pond-drift.js), and a koi coming
 * up goes for it (koi-pond-school.js setFood).
 */
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import {
    FloatDrift, KIND_LEAF, KIND_PAD, PULSE_SLOTS,
} from '../../src/themes/koi-pond/koi-pond-drift.js';
import {
    FLOATER_LIVE_STRIDE, LILY_MOTION_ROWS, PAD_LIVE_STRIDE, planFloaters, planFlora,
} from '../../src/themes/koi-pond/koi-pond-flora.js';
import { CHAIN_RING, KoiSchool, MEAL_REACH } from '../../src/themes/koi-pond/koi-pond-school.js';
import { WAVE_SPEED } from '../../src/themes/koi-pond/koi-pond-light.js';
import { POND, mulberry32, waterDepth } from '../../src/themes/koi-pond/koi-pond-core.js';
import { planGarden } from '../../src/themes/koi-pond/koi-pond-garden.js';
import { QUALITY, QUALITY_NAMES } from '../../src/themes/koi-pond/koi-pond-quality.js';
import { KoiPondWorld, REST_RIG, fovForAspect } from '../../src/themes/koi-pond/koi-pond-world.js';
import { fallbackLayout } from '../../src/themes/koi-pond/koi-pond-composition.js';

vi.setConfig({ testTimeout: 30_000 }); // a few tests build a whole pond

const DT = 1 / 60;
const ROCKS = planGarden().standing;
const TIER = QUALITY.High;
const FLORA = planFlora({ pads: TIER.pads, lotus: TIER.lotus, rocks: ROCKS });
const LEAVES = planFloaters(TIER.floaters, { pads: FLORA.pads });

const make = () => new FloatDrift({
    pads: FLORA.pads, lilies: FLORA.lilies, leaves: LEAVES, rocks: ROCKS, waveSpeed: WAVE_SPEED,
});
/** A drift of one leaf (or one pad) in open water, so nothing else gets in the way. */
const OPEN = { x: -4.2, z: 0.6 };
const oneLeaf = (at = OPEN) => new FloatDrift({
    leaves: [{
        x: at.x, z: at.z, size: 0.12, turn: 0.3, tone: 0.5, petal: 0, phase: 0, rate: 0.85,
    }],
});
/** Where a lone leaf rests at t = 0 (on its slow loop, not at its anchor). */
const restOf = (drift) => ({ x: drift.x[0], z: drift.z[0] });
const onePad = (at = OPEN) => new FloatDrift({
    pads: [{
        x: at.x, z: at.z, radius: 0.35, turn: 0.2, tone: 0.5, age: 0.2,
    }],
});

function run(drift, seconds, each = null) {
    const steps = Math.round(seconds / DT);
    for (let s = 0; s < steps; s++) {
        each?.(s);
        drift.step(DT);
    }
}

/** Everything the renderer reads from a drift. */
function snapshot(drift) {
    return ['x', 'z', 'turn', 'dip', 'tiltX', 'tiltZ', 'wet'].map((key) => Array.from(drift[key]));
}

/** A stand-in for KoiSchool: what the drift reads of the koi. */
function fakeSchool(fish) {
    return {
        count: fish.length,
        airborne: () => false,
        x: fish.map((f) => f.x),
        y: fish.map((f) => f.y),
        z: fish.map((f) => f.z),
        heading: fish.map((f) => f.heading),
        speed: fish.map((f) => f.speed),
        fish: fish.map((f) => ({ length: f.length })),
    };
}

/** The angle round the chain's ring (the way the koi swim it is the angle increasing). */
const ringAngle = (x, z) => Math.atan2((z - CHAIN_RING.z) / CHAIN_RING.radiusZ, (x - CHAIN_RING.x) / CHAIN_RING.radiusX);
const unwrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

describe('koi pond: where things float', () => {
    it.each(QUALITY_NAMES)('lays the %s tier\'s fallen leaves in water, none on a pad, the same every time', (name) => {
        const tier = QUALITY[name];
        const flora = planFlora({ pads: tier.pads, lotus: tier.lotus, rocks: ROCKS });
        const leaves = planFloaters(tier.floaters, { pads: flora.pads });
        expect(leaves.length).toBe(tier.floaters);
        leaves.forEach((leaf) => {
            expect(waterDepth(leaf.x, leaf.z)).toBeGreaterThanOrEqual(0.05);
            flora.pads.forEach((pad) => {
                expect(Math.hypot(pad.x - leaf.x, pad.z - leaf.z)).toBeGreaterThanOrEqual(pad.radius + leaf.size * 0.5);
            });
            expect(leaf.size).toBeGreaterThan(0);
            expect([0, 1]).toContain(leaf.petal);
        });
        expect(planFloaters(tier.floaters, { pads: flora.pads })).toEqual(leaves);
        // Every lily names the pad it stands on, and stands on it.
        flora.lilies.forEach((lily) => {
            const pad = flora.pads[lily.pad];
            expect(pad).toBeDefined();
            expect(Math.hypot(pad.x - lily.x, pad.z - lily.z)).toBeLessThanOrEqual(pad.radius + 1e-6);
        });
    });

    it('takes every pad and then every leaf as a body, and stands each lily where it was planted', () => {
        const drift = make();
        expect(drift.padCount).toBe(FLORA.pads.length);
        expect(drift.leafCount).toBe(LEAVES.length);
        expect(drift.count).toBe(FLORA.pads.length + LEAVES.length);
        for (let i = 0; i < drift.count; i++) expect(drift.kind[i]).toBe(i < drift.padCount ? KIND_PAD : KIND_LEAF);
        FLORA.lilies.forEach((lily, k) => {
            const at = drift.lilyAt(k);
            expect(at.x).toBeCloseTo(lily.x, 6);
            expect(at.z).toBeCloseTo(lily.z, 6);
            expect(at.turn).toBe(0);
        });
    });
});

describe('koi pond drift: still water', () => {
    it('keeps every pad at its stalk and lets each leaf wander its slow loop, turning lazily', () => {
        const drift = make();
        const turns = Array.from(drift.turn);
        run(drift, 20);
        const state = drift.state();
        expect(state.padSwing).toBeLessThan(1e-3);
        // (A leaf trails its moving resting place a little; a pad's rim can shoulder one aside.)
        expect(state.leafStray).toBeLessThan(0.4);
        expect(state).toMatchObject({ pulses: 0, nibbles: 0, wet: 0 });
        let turned = 0;
        for (let i = drift.padCount; i < drift.count; i++) if (Math.abs(drift.turn[i] - turns[i]) > 0.01) turned += 1;
        expect(turned).toBeGreaterThan(drift.leafCount * 0.5);
        for (let i = 0; i < drift.padCount; i++) expect(drift.turn[i]).toBeCloseTo(turns[i], 6);
    });

    it('is deterministic: the same calls move everything the same way, and reset puts it all back', () => {
        const a = make();
        const b = make();
        const play = (drift) => run(drift, 6, (s) => {
            if (s === 30) drift.pulse(-4, 0.5, { amp: 0.085, radius: 0.34, foam: 0.9 });
            if (s === 120) drift.nibble(drift.x[drift.padCount + 3] + 0.05, drift.z[drift.padCount + 3]);
            drift.env.windX = s > 200 ? 0.08 : 0;
        });
        play(a);
        play(b);
        expect(snapshot(a)).toEqual(snapshot(b));
        a.reset(0);
        expect(snapshot(a)).toEqual(snapshot(make()));
    });
});

describe('koi pond drift: rings', () => {
    it('shoves what floats outward as a splash\'s front passes, never before the waves get there', () => {
        const drift = make();
        // (The same pond with no splash: what the leaves' own slow wander does meanwhile.)
        const still = make();
        const pad = FLORA.pads[0];
        const x = pad.x + 0.9;
        const { z } = pad;
        const start = { x: Float32Array.from(drift.x), z: Float32Array.from(drift.z) };
        const firstMove = new Float32Array(drift.count).fill(-1);
        drift.pulse(x, z, { amp: 0.085, radius: 0.34, foam: 0.9 });
        run(drift, 3, (s) => {
            still.step(DT);
            for (let i = 0; i < drift.count; i++) {
                const off = Math.hypot(drift.x[i] - still.x[i], drift.z[i] - still.z[i]);
                if (firstMove[i] < 0 && off > 0.005) firstMove[i] = s * DT;
            }
        });
        let near = 0;
        let outward = 0;
        for (let i = 0; i < drift.count; i++) {
            const before = Math.hypot(start.x[i] - x, start.z[i] - z);
            if (before > 2.5) continue;
            near += 1;
            const after = Math.hypot(drift.x[i] - x, drift.z[i] - z);
            if (after > before + 0.01) outward += 1;
            // Far out it moves only once the front has come (fronts are FRONT wide, 0.3 m).
            if (before > 2 && firstMove[i] >= 0) expect(firstMove[i]).toBeGreaterThanOrEqual((before - 1.3) / WAVE_SPEED - 0.05);
        }
        expect(near).toBeGreaterThan(5);
        expect(outward / near).toBeGreaterThan(0.75);
        expect(drift.state().pulses).toBe(1);
    });

    it('lets a struck pad swing on its stalk and come back, never further than its stalk reaches', () => {
        const drift = make();
        const pad = FLORA.pads[2];
        let swing = 0;
        drift.pulse(pad.x + 0.5, pad.z, { amp: 0.085, radius: 0.34, foam: 0.9 });
        run(drift, 4, () => {
            swing = Math.max(swing, Math.hypot(drift.x[2] - pad.x, drift.z[2] - pad.z));
        });
        expect(swing).toBeGreaterThan(0.03);
        expect(swing).toBeLessThan(0.12 + pad.radius * 0.6 + 0.1);
        run(drift, 16);
        expect(Math.hypot(drift.x[2] - pad.x, drift.z[2] - pad.z)).toBeLessThan(0.03);
    });

    it('pushes under, rocks and wets what lies where a splash strikes; it bobs back up', () => {
        const drift = oneLeaf();
        const at = restOf(drift);
        drift.pulse(at.x + 0.1, at.z, { amp: 0.06, radius: 0.25, foam: 0.6 });
        run(drift, 0.12);
        expect(drift.dip[0]).toBeLessThan(-0.004);
        expect(drift.wet[0]).toBeGreaterThan(0.5);
        expect(Math.hypot(drift.tiltX[0], drift.tiltZ[0])).toBeGreaterThan(0.005);
        run(drift, 5);
        expect(Math.abs(drift.dip[0])).toBeLessThan(0.002);
        expect(drift.wet[0]).toBeLessThan(0.5);
    });

    it('lets a koi\'s kiss go by: too small to move anything, it takes no slot', () => {
        const drift = make();
        drift.pulse(-4, 0.5, { amp: 0.0035, radius: 0.07 });
        expect(drift.state().pulses).toBe(0);
        // A slot goes to whichever front has the least push left.
        for (let k = 0; k < PULSE_SLOTS + 4; k++) drift.pulse(-4 + k * 0.1, 0.5, { amp: 0.05, radius: 0.2 });
        expect(drift.state().pulses).toBe(PULSE_SLOTS + 4);
        expect(drift.pulses.every((p) => p.power > 0)).toBe(true);
    });
});

describe('koi pond drift: the koi', () => {
    it('lets a koi mouth a leaf within reach: tugged toward the mouth, pulled under and spun', () => {
        const drift = oneLeaf();
        const control = oneLeaf();
        const at = restOf(drift);
        expect(drift.nibble(at.x + 0.12, at.z, 1, Math.PI)).toBe(0);
        run(drift, 0.15);
        expect(drift.dip[0]).toBeLessThan(-0.01);
        expect(Math.abs(drift.spin[0])).toBeGreaterThan(1);
        expect(drift.wet[0]).toBeGreaterThan(0.9);
        run(drift, 0.5);
        run(control, 0.65);
        expect(drift.x[0]).toBeGreaterThan(control.x[0] + 0.02);
        expect(drift.state().nibbles).toBe(1);
        // Nothing within reach: nothing taken.
        expect(drift.nibble(drift.x[0] + 1.5, drift.z[0], 1, 0)).toBe(-1);
        expect(drift.state().nibbles).toBe(1);
    });

    it('lets a koi mouth a pad\'s rim: the rim toward the mouth dips and the pad is yanked toward it', () => {
        const drift = onePad();
        const mouth = { x: OPEN.x + 0.4, z: OPEN.z };
        expect(drift.nibble(mouth.x, mouth.z, 1, Math.PI)).toBe(0);
        run(drift, 0.1);
        // (The rock is a slope: the rim toward the mouth, +x, lies lower.)
        expect(drift.tiltX[0]).toBeLessThan(-0.01);
        run(drift, 0.4);
        expect(drift.x[0]).toBeGreaterThan(OPEN.x + 0.02);
        expect(Math.abs(drift.turn[0] - 0.2)).toBeGreaterThan(0.02);
    });

    it('parts what floats over a koi\'s back and carries it along; a koi deep down leaves it be', () => {
        const at = restOf(oneLeaf());
        const swim = (depth) => {
            const drift = oneLeaf();
            const fish = {
                x: at.x - 0.3, y: -depth, z: at.z + 0.05, heading: 0, speed: 0.5, length: 1,
            };
            const school = fakeSchool([fish]);
            drift.env.school = school;
            run(drift, 1.2, () => {
                school.x[0] += 0.5 * DT;
            });
            return { dx: drift.x[0] - at.x, dz: drift.z[0] - at.z, spin: drift.spin[0] };
        };
        const control = oneLeaf();
        run(control, 1.2);
        const shallow = swim(0.06);
        const deep = swim(0.6);
        expect(shallow.dx - (control.x[0] - at.x)).toBeGreaterThan(0.05);
        // (The back passes a little to one side of it: it is parted to the other.)
        expect(shallow.dz - (control.z[0] - at.z)).toBeLessThan(-0.01);
        expect(deep.dx).toBeCloseTo(control.x[0] - at.x, 6);
        expect(deep.dz).toBeCloseTo(control.z[0] - at.z, 6);
    });

    it('lifts and rocks a pad a koi passes just under, the side over its back highest', () => {
        const drift = onePad();
        const school = fakeSchool([{
            x: OPEN.x + 0.15, y: -0.05, z: OPEN.z, heading: Math.PI / 2, speed: 0.3, length: 0.9,
        }]);
        drift.env.school = school;
        run(drift, 0.6);
        expect(drift.dip[0]).toBeGreaterThan(0.002);
        expect(drift.tiltX[0]).toBeGreaterThan(0.005);
    });
});

describe('koi pond drift: the water and the air', () => {
    it('lets the chain\'s ring carry the leaves round the board the way the koi swim it, and lets them drift back', () => {
        const drift = make();
        Object.assign(drift.env, {
            ringX: CHAIN_RING.x, ringZ: CHAIN_RING.z, ringRX: CHAIN_RING.radiusX, ringRZ: CHAIN_RING.radiusZ, swirl: 1,
        });
        const onRing = [];
        for (let i = drift.padCount; i < drift.count; i++) {
            const qx = (drift.x[i] - CHAIN_RING.x) / CHAIN_RING.radiusX;
            const qz = (drift.z[i] - CHAIN_RING.z) / CHAIN_RING.radiusZ;
            if (Math.abs(Math.hypot(qx, qz) - 1) < 0.25) onRing.push(i);
        }
        expect(onRing.length).toBeGreaterThan(5);
        const angle = onRing.map((i) => ringAngle(drift.x[i], drift.z[i]));
        const turned = onRing.map(() => 0);
        run(drift, 10, () => {
            onRing.forEach((i, k) => {
                const now = ringAngle(drift.x[i], drift.z[i]);
                turned[k] += unwrap(now - angle[k]);
                angle[k] = now;
            });
        });
        const mean = turned.reduce((a, b) => a + b, 0) / turned.length;
        expect(mean).toBeGreaterThan(0.3);
        // The current stops: each creeps back toward where it fell.
        const strayed = drift.state().leafStray;
        const away = (i) => Math.hypot(drift.homeX[i] - drift.anchorX[i], drift.homeZ[i] - drift.anchorZ[i]);
        const before = onRing.map(away);
        drift.env.swirl = 0;
        run(drift, 40);
        const after = onRing.map(away);
        expect(after.reduce((a, b) => a + b, 0)).toBeLessThan(before.reduce((a, b) => a + b, 0) * 0.5);
        expect(strayed).toBeGreaterThan(0);
    });

    it('lets the breeze blow the leaves downwind and the pads barely; the hush stills it', () => {
        const meanX = (drift, from, to) => {
            let sum = 0;
            for (let i = from; i < to; i++) sum += drift.x[i];
            return sum / Math.max(1, to - from);
        };
        const calm = make();
        const windy = make();
        const hushed = make();
        windy.env.windX = 0.1;
        Object.assign(hushed.env, { windX: 0.1, still: 1 });
        [calm, windy, hushed].forEach((drift) => run(drift, 4));
        const leaves = (d) => meanX(d, d.padCount, d.count);
        const pads = (d) => meanX(d, 0, d.padCount);
        expect(leaves(windy) - leaves(calm)).toBeGreaterThan(0.15);
        expect(pads(windy) - pads(calm)).toBeLessThan(0.05);
        expect(Math.abs(leaves(hushed) - leaves(calm))).toBeLessThan(1e-6);
    });

    it('never runs aground or leaves the pond, and never produces a number that is not one, played hard', () => {
        const drift = make();
        const rand = mulberry32(99);
        Object.assign(drift.env, {
            ringX: CHAIN_RING.x, ringZ: CHAIN_RING.z, ringRX: CHAIN_RING.radiusX, ringRZ: CHAIN_RING.radiusZ,
        });
        run(drift, 60, (s) => {
            drift.env.swirl = s % 1200 < 600 ? 1 : 0;
            drift.env.windX = Math.cos(s * 0.01) * 0.12;
            drift.env.windZ = Math.sin(s * 0.013) * 0.12;
            drift.env.stir = 4;
            if (s % 20 === 0) {
                drift.pulse(POND.minX + rand() * (POND.maxX - POND.minX), POND.minZ + rand() * (POND.maxZ - POND.minZ), {
                    amp: 0.12, radius: 0.5, foam: 1,
                });
            }
            if (s % 7 === 0) {
                const i = Math.floor(rand() * drift.count);
                drift.nibble(drift.x[i] + 0.05, drift.z[i], 1.2, rand() * 6);
            }
            if (s % 30 === 0) {
                for (let i = 0; i < drift.count; i++) {
                    const values = [drift.x[i], drift.z[i], drift.turn[i], drift.dip[i], drift.tiltX[i], drift.tiltZ[i], drift.wet[i]];
                    expect(values.every(Number.isFinite)).toBe(true);
                    expect(waterDepth(drift.x[i], drift.z[i])).toBeGreaterThan(0.02);
                    expect(drift.x[i]).toBeGreaterThanOrEqual(POND.minX);
                    expect(drift.x[i]).toBeLessThanOrEqual(POND.maxX);
                    expect(drift.z[i]).toBeGreaterThanOrEqual(POND.minZ);
                    expect(drift.z[i]).toBeLessThanOrEqual(POND.maxZ);
                }
                for (let p = 0; p < drift.padCount; p++) {
                    const pad = FLORA.pads[p];
                    expect(Math.hypot(drift.x[p] - pad.x, drift.z[p] - pad.z)).toBeLessThan(0.12 + pad.radius * 0.6 + 0.25);
                }
            }
        });
    });
});

describe('koi pond drift: for the renderer', () => {
    it('writes eight numbers a pad and a leaf, and two rows a lily that carry it with its pad', () => {
        const drift = make();
        drift.pulse(FLORA.pads[0].x + 0.3, FLORA.pads[0].z, { amp: 0.085, radius: 0.34, foam: 0.9 });
        run(drift, 0.5);
        const pads = new Float32Array(drift.padCount * PAD_LIVE_STRIDE);
        const leaves = new Float32Array(drift.leafCount * FLOATER_LIVE_STRIDE);
        drift.writePads(pads, PAD_LIVE_STRIDE);
        drift.writeLeaves(leaves, FLOATER_LIVE_STRIDE);
        const check = (out, o, i) => {
            expect(Array.from(out.slice(o, o + 8))).toEqual(Array.from(new Float32Array([
                drift.x[i], drift.z[i], drift.turn[i], drift.dip[i], drift.tiltX[i], drift.tiltZ[i], drift.wet[i], 0,
            ])));
        };
        check(pads, 0, 0);
        check(leaves, 3 * FLOATER_LIVE_STRIDE, drift.padCount + 3);

        const rows = Array.from({ length: FLORA.lilies.length * LILY_MOTION_ROWS }, () => new THREE.Vector4());
        drift.reset(0);
        drift.writeLilies(rows);
        rows.forEach((row) => expect(row.toArray().every((v) => Math.abs(v) < 1e-9)).toBe(true));
        // Its pad moves and turns: the lily goes with it, turned about the pad's middle.
        const p = FLORA.lilies[0].pad;
        drift.x[p] += 0.1;
        drift.turn[p] += 0.3;
        drift.dip[p] = -0.004;
        drift.writeLilies(rows);
        const at = drift.lilyAt(0);
        expect(rows[0].x).toBeCloseTo(at.x - FLORA.lilies[0].x, 6);
        expect(rows[0].y).toBeCloseTo(at.z - FLORA.lilies[0].z, 6);
        expect(rows[0].z).toBeCloseTo(0.3, 6);
        expect(rows[0].w).toBeCloseTo(-0.004, 6);
        const off = Math.hypot(FLORA.lilies[0].x - FLORA.pads[p].x, FLORA.lilies[0].z - FLORA.pads[p].z);
        expect(Math.hypot(at.x - drift.x[p], at.z - drift.z[p])).toBeCloseTo(off, 6);
    });
});

describe('koi school: going for what floats', () => {
    it('brings a koi up to what floats near it, and kisses it when its mouth gets there', () => {
        const drift = make();
        const school = new KoiSchool({ count: TIER.koi, rocks: ROCKS });
        school.setFood(drift);
        const kisses = [];
        for (let s = 0; s < 90 * 60; s++) {
            school.step(DT);
            school.events.forEach((event) => {
                if (event.type === 'kiss') kisses.push(event);
            });
        }
        expect(kisses.length).toBeGreaterThan(20);
        const going = kisses.filter((kiss) => kiss.meal >= 0);
        // (Most leaves lie under the maple: koi whose loops are far from them come up empty.)
        expect(going.length).toBeGreaterThan(kisses.length * 0.25);
        const reached = going.filter((kiss) => {
            const gap = Math.hypot(drift.x[kiss.meal] - kiss.x, drift.z[kiss.meal] - kiss.z) - drift.radius[kiss.meal];
            return gap <= 0.12 + kiss.power * 0.06 + 1e-6;
        });
        // (One that has not got there by the time it turns down kisses the water where it is.)
        expect(reached.length).toBeGreaterThan(going.length * 0.33);
        // Without food a koi kisses where it is, naming nothing.
        const plain = new KoiSchool({ count: TIER.koi, rocks: ROCKS });
        const named = [];
        for (let s = 0; s < 40 * 60; s++) {
            plain.step(DT);
            plain.events.forEach((event) => {
                if (event.type === 'kiss') named.push(event.meal);
            });
        }
        expect(named.length).toBeGreaterThan(0);
        expect(named.every((meal) => meal === -1)).toBe(true);
        expect(MEAL_REACH).toBeGreaterThan(0.5);
    });

    it('forgets its food when told to, and goes on as a school that never had any', () => {
        const a = new KoiSchool({ count: 8, rocks: ROCKS });
        const b = new KoiSchool({ count: 8, rocks: ROCKS });
        a.setFood(make());
        a.setFood(null);
        for (let s = 0; s < 600; s++) {
            a.step(DT);
            b.step(DT);
        }
        expect(Array.from(a.x)).toEqual(Array.from(b.x));
        expect(Array.from(a.meal).every((m) => m === -1)).toBe(true);
    });
});

describe('koi pond world: what floats', () => {
    const worlds = [];
    afterEach(() => {
        worlds.splice(0).forEach((world) => world.dispose());
    });
    function makeWorld(quality = 'Low') {
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(fovForAspect(16 / 9), 16 / 9, REST_RIG.near, REST_RIG.far);
        const world = new KoiPondWorld({ scene, quality, capture: true }).build();
        world.bindCamera(camera);
        world.setViewport(1600, 900, 16 / 9);
        world.setLayout(fallbackLayout(1600, 900), 16 / 9);
        world.seek(0);
        world.update({ time: 0, delta: 0 }, camera);
        worlds.push(world);
        return { world, camera };
    }
    function play(world, camera, seconds, step = DT) {
        const t0 = world.time;
        const n = Math.round(seconds / step);
        for (let i = 1; i <= n; i++) {
            const sim = { time: t0 + i * step, delta: step };
            world.updateCamera(camera, sim);
            world.update(sim, camera);
        }
    }

    it('hands every splash to what floats and what floats to the GPU, every frame', () => {
        const { world, camera } = makeWorld();
        const { drift } = world;
        expect(world.school.food).toBe(drift);
        play(world, camera, 1);
        world.onLock({ rows: [18, 17], u: 0.2, hardDrop: true });
        expect(drift.state().pulses).toBeGreaterThan(0);
        play(world, camera, 2);
        expect(drift.state().pulses).toBeGreaterThanOrEqual(4); // the piece and its three pebbles
        expect(world.getState().floating).toEqual(drift.state());
        expect(world.pads.live[0]).toBe(drift.x[0]);
        expect(world.pads.live[1]).toBe(drift.z[0]);
        expect(world.floaters.live[0]).toBe(drift.x[drift.padCount]);
        const p = world.flora.lilies[0].pad;
        expect(world.lilies.motion[0].w).toBe(drift.dip[p]);
    });

    it('moves what floats the same way however the frames fall', () => {
        const slow = makeWorld();
        const fast = makeWorld();
        // (No lock: without a renderer the world's queue of landings runs on the frame's clock.
        // A chain, the koi's breaches and kisses and the fronts they send all run on the steps.)
        slow.world.onCombo(9);
        fast.world.onCombo(9);
        play(slow.world, slow.camera, 3, 1 / 30);
        play(fast.world, fast.camera, 3, 1 / 240);
        expect(snapshot(fast.world.drift)).toEqual(snapshot(slow.world.drift));
    });

    it('calms the jolts under reduced motion', () => {
        const full = makeWorld();
        const calm = makeWorld();
        calm.world.setReducedMotion(true);
        expect(calm.world.drift.motion).toBe(0);
        // How far everything within two metres of a splash has been moved by it.
        const shoved = ({ world, camera }) => {
            const { drift } = world;
            const x0 = Float32Array.from(drift.x);
            const z0 = Float32Array.from(drift.z);
            drift.pulse(-4, 0.5, { amp: 0.085, radius: 0.34, foam: 0.9 });
            play(world, camera, 0.5);
            let sum = 0;
            for (let i = 0; i < drift.count; i++) {
                if (Math.hypot(x0[i] + 4, z0[i] - 0.5) < 2) sum += Math.hypot(drift.x[i] - x0[i], drift.z[i] - z0[i]);
            }
            return sum;
        };
        expect(shoved(calm)).toBeLessThan(shoved(full) * 0.85);
    });
});

/**
 * THE GUST'S FIELDFARES (world/odyssey-wake-fieldfares.js, 2026-11-22): the birds the turn's gust
 * lifts out of the broadleaf crowns, drawn as the Blender fieldfare instead of alpha-cut
 * silhouettes. The model itself is held with the other Blender birds (odyssey-blender-birds.test.js);
 * here, through the vertex stage's CPU twins, how it flies the wake's route:
 *  - the route is the wake's own, with its true velocity and acceleration;
 *  - the body faces along its flight (a right-handed frame, never flipping), climbs and dives
 *    within a bird's limits, and banks into its turns only once it has the speed;
 *  - it beats out of the crown, flies in bursts and bounds, glides in and flutters into the next
 *    crown, every change without a corner;
 * and the draw: one instanced mesh per wake, built clean for WebGPU and the WebGL2 fallback.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { uniform, vec3 } from 'three/tsl';
import {
    ODYSSEY_TURN_WAKE, planTurnWake, turnWakeBirdAt,
} from '../../src/rendering/odyssey/world/odyssey-turn-wake.js';
import {
    WAKE_FIELDFARES, createWakeFieldfares, wakeFieldfareFrameAt, wakeFieldfareMotionAt, wakeFieldfarePoseAt,
    wakeFieldfareRhythmAt, wakeFieldfareSpan,
} from '../../src/rendering/odyssey/world/odyssey-wake-fieldfares.js';
import { decodeBirdModel } from '../../src/rendering/odyssey/composition/odyssey-bird-rig.js';
import { ODYSSEY_SEA_LEVEL, odysseyWorldHeight } from '../../src/rendering/odyssey/world/odyssey-world-height.js';
import { build, unassignedReads } from './helpers/tsl-node-build.js';

const BACKENDS = [['WGSL', THREE.WGSLNodeBuilder], ['GLSL', THREE.GLSLNodeBuilder]];
const F = WAKE_FIELDFARES;

// A stand of trees on the real island round the wake's focus, as the wake's own test plants it.
const trees = [];
for (let i = 0; i < 160; i += 1) {
    const x = ODYSSEY_TURN_WAKE.focus[0] + ((((i * 37) % 23) - 11) * 22);
    const z = ODYSSEY_TURN_WAKE.focus[1] + ((((i * 53) % 19) - 9) * 20);
    const y = odysseyWorldHeight(x, z);
    if (y > ODYSSEY_SEA_LEVEL + 2) {
        trees.push({
            x, y, z, top: y + 11 + ((i * 7) % 9), broad: i % 3 !== 0,
        });
    }
}
const { birds } = planTurnWake(trees, odysseyWorldHeight, { leaves: 0 });

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => (a[0] * b[0]) + (a[1] * b[1]) + (a[2] * b[2]);
const cross = (a, b) => [(a[1] * b[2]) - (a[2] * b[1]), (a[2] * b[0]) - (a[0] * b[2]), (a[0] * b[1]) - (a[1] * b[0])];
const len = (a) => Math.hypot(...a);

/** Worst |f''| over [t0, t0 + T] sampled every h (central differences). */
function worstAcc(f, t0, T, h) {
    let worst = 0;
    let a = f(t0 - h);
    let b = f(t0);
    for (let t = t0 + h; t < t0 + T; t += h) {
        const c = f(t);
        worst = Math.max(worst, Math.abs((a - (2 * b) + c) / (h * h)));
        a = b;
        b = c;
    }
    return worst;
}
/** A motion with a corner shows ~4x the acceleration at 960 Hz as at 240; a smooth one ~1x. */
const cornerRatio = (f, t0, T) => {
    const coarse = worstAcc(f, t0, T, 1 / 240);
    return coarse < 1e-3 ? 1 : worstAcc(f, t0, T, 1 / 960) / coarse;
};

describe("the gust's fieldfares: their flight (CPU twins of the vertex stage)", () => {
    it('has a party of birds to fly, each its own size', () => {
        expect(birds.length).toBe(ODYSSEY_TURN_WAKE.birds.parties * ODYSSEY_TURN_WAKE.birds.each);
        birds.forEach((b) => {
            const span = wakeFieldfareSpan(b);
            expect(span).toBeGreaterThanOrEqual(F.span[0]);
            expect(span).toBeLessThanOrEqual(F.span[1]);
        });
    });

    it("flies the wake's route, with its true velocity and acceleration", () => {
        const h = 1e-3;
        birds.forEach((b) => {
            for (let s = 1; s < 20; s += 1) {
                const age = (s / 20) * b.life;
                const m = wakeFieldfareMotionAt(b, age);
                const at = turnWakeBirdAt(b, age);
                expect(m.position[0]).toBeCloseTo(at.x, 6);
                expect(m.position[1]).toBeCloseTo(at.y, 6);
                expect(m.position[2]).toBeCloseTo(at.z, 6);
                const p0 = wakeFieldfareMotionAt(b, age - h);
                const p1 = wakeFieldfareMotionAt(b, age + h);
                const v = sub(p1.position, p0.position).map((d) => d / (2 * h));
                const acc = sub(p1.velocity, p0.velocity).map((d) => d / (2 * h));
                expect(len(sub(v, m.velocity))).toBeLessThan(1e-3 * Math.max(1, len(m.velocity)));
                expect(len(sub(acc, m.acceleration))).toBeLessThan(1e-3 * Math.max(1, len(m.acceleration)));
            }
        });
    });

    it('faces along its flight in a right-handed frame, climbing and diving like a bird, never flipping', () => {
        birds.forEach((b) => {
            let prev = null;
            for (let age = 0; age <= b.life; age += 1 / 60) {
                const fr = wakeFieldfareFrameAt(b, age);
                [fr.forward, fr.left, fr.up].forEach((v) => expect(len(v)).toBeCloseTo(1, 9));
                expect(Math.abs(dot(fr.forward, fr.left))).toBeLessThan(1e-9);
                expect(Math.abs(dot(fr.forward, fr.up))).toBeLessThan(1e-9);
                // left x up = forward, as the bird frame (x left, y up, z forward).
                expect(len(sub(cross(fr.left, fr.up), fr.forward))).toBeLessThan(1e-9);
                expect(fr.pitch).toBeGreaterThanOrEqual(F.pitch[0] - 1e-12);
                expect(fr.pitch).toBeLessThanOrEqual(F.pitch[1] + 1e-12);
                expect(Math.abs(fr.roll)).toBeLessThanOrEqual(F.bankMax + 1e-12);
                // Its heading goes the way it flies wherever it is really travelling.
                const v = wakeFieldfareMotionAt(b, age).velocity;
                const speedH = Math.hypot(v[0], v[2]);
                if (speedH > 8) {
                    const along = (fr.forward[0] * v[0]) + (fr.forward[2] * v[2]);
                    expect(along).toBeGreaterThan(0.7 * speedH * Math.cos(fr.pitch));
                }
                // No snap: at 60 frames a second the body turns by a few degrees a frame at most.
                if (prev) expect(Math.acos(Math.min(1, dot(prev, fr.forward)))).toBeLessThan(0.08);
                prev = fr.forward;
            }
        });
    });

    it('banks into its turns once it has the speed, and lifts and settles level', () => {
        let banked = 0;
        birds.forEach((b) => {
            expect(Math.abs(wakeFieldfareFrameAt(b, 0).roll)).toBeLessThan(0.12);
            let most = 0;
            for (let age = 0; age <= b.life; age += 0.1) {
                most = Math.max(most, Math.abs(wakeFieldfareFrameAt(b, age).roll));
            }
            if (most > 0.2) banked += 1;
        });
        expect(banked / birds.length).toBeGreaterThan(0.6);
    });

    it('turns, banks and pitches without a corner', () => {
        birds.slice(0, 12).forEach((b) => {
            const t0 = 0.05;
            const T = b.life - 0.1;
            [0, 1, 2].forEach((k) => {
                const f = (t) => wakeFieldfareFrameAt(b, t).forward[k];
                expect(cornerRatio(f, t0, T), `forward ${k}`).toBeLessThan(2);
            });
            expect(cornerRatio((t) => wakeFieldfareFrameAt(b, t).roll, t0, T), 'roll').toBeLessThan(2);
        });
    });

    it('beats out of the crown, bursts and bounds on the way, glides in and flutters into the next crown', () => {
        const [, l1, , f1] = F.landing;
        birds.forEach((b) => {
            expect(wakeFieldfareRhythmAt(b, 0.2).weight).toBeCloseTo(1, 6);
            expect(wakeFieldfareRhythmAt(b, 0.2).bound).toBeCloseTo(0, 6);
            // The glide in: wings spread, no beat, no bound.
            const glide = wakeFieldfareRhythmAt(b, b.life - l1);
            expect(glide.weight).toBeLessThan(0.02);
            expect(glide.bound).toBeLessThan(0.02);
            // The flutter into the crown.
            expect(wakeFieldfareRhythmAt(b, b.life - f1 + 0.05).weight).toBeGreaterThan(0.98);
            // On the way: both bursts of beats and bounds with the wings drawn in.
            let beating = 0;
            let bounding = 0;
            let n = 0;
            for (let age = F.takeoff[1]; age < b.life - F.landing[0]; age += 0.05) {
                const r = wakeFieldfareRhythmAt(b, age);
                if (r.weight > 0.9) beating += 1;
                if (r.bound > 0.6) bounding += 1;
                n += 1;
            }
            expect(beating / n).toBeGreaterThan(0.35);
            expect(bounding / n).toBeGreaterThan(0.15);
            expect(bounding / n).toBeLessThan(0.5);
        });
    });

    it('moves its wings, its heave and its tail without a corner, through beats, bounds and landings', () => {
        const channels = ['lift', 'sweep', 'bend', 'fold', 'curl', 'heave', 'tailSpread', 'tailTwist'];
        birds.slice(0, 8).forEach((b) => {
            channels.forEach((ch) => {
                const f = (t) => wakeFieldfarePoseAt(b, t)[ch];
                expect(cornerRatio(f, 0.05, b.life - 0.1), ch).toBeLessThan(2);
            });
        });
    });

    it('beats at a thrush pace and keeps its tail within what the model was checked for', () => {
        const model = decodeBirdModel('fieldfare');
        expect(model.flight.rate).toBeGreaterThan(4);
        expect(model.flight.rate).toBeLessThan(7);
        birds.forEach((b) => {
            for (let age = 0; age <= b.life; age += 0.1) {
                const p = wakeFieldfarePoseAt(b, age);
                expect(p.tailSpread).toBeLessThanOrEqual(0.34 + 1e-9);
                expect(Math.abs(p.tailTwist)).toBeLessThanOrEqual(0.30 + 1e-9);
            }
        });
    });
});

describe("the gust's fieldfares: the draw", () => {
    const fieldfares = createWakeFieldfares({
        birds,
        time: uniform(0),
        uWake: uniform(new THREE.Vector4(0, ODYSSEY_TURN_WAKE.focus[0], ODYSSEY_TURN_WAKE.focus[1], 0)),
        skyColour: vec3(0.71, 0.81, 0.91),
        lightAt: () => ({ sun: vec3(1.0, 0.93, 0.8), direct: uniform(1) }),
        toOutput: (c) => c,
    });

    it('is nothing without birds, and one instanced Blender fieldfare per bird', () => {
        expect(createWakeFieldfares({
            birds: [], time: uniform(0), uWake: uniform(new THREE.Vector4()), skyColour: vec3(1), toOutput: (c) => c,
        })).toBeNull();
        const { mesh } = fieldfares;
        expect(mesh.name).toBe('odyssey-world-turn-wake-fieldfares');
        expect(mesh.geometry.instanceCount).toBe(birds.length);
        expect(mesh.geometry.index.count).toBe(decodeBirdModel('fieldfare').triangleCount * 3);
        // Every attribute is a vertex buffer on WebGPU; a pipeline binds at most eight.
        expect(Object.keys(mesh.geometry.attributes).length).toBeLessThanOrEqual(8);
        expect(mesh.material.transparent).toBe(false);
        expect(mesh.material.side).toBe(THREE.DoubleSide);
        expect(mesh.frustumCulled).toBe(false);
    });

    BACKENDS.forEach(([label, Builder]) => {
        it(`builds clean (${label})`, () => {
            const out = build(Builder, fieldfares.mesh);
            expect(out.thrown, `${out.thrown?.stack ?? ''}`).toBeUndefined();
            expect(out.heard).toEqual([]);
            ['vertex', 'fragment'].forEach((stage) => {
                expect(typeof out[stage]).toBe('string');
                expect(out[stage]).not.toMatch(/\bNaN\b|\bInfinity\b|object Object/);
            });
            if (label === 'WGSL') {
                expect(unassignedReads(out.vertex), 'vertex').toEqual([]);
                expect(unassignedReads(out.fragment), 'fragment').toEqual([]);
            }
        }, 60_000);
    });
});

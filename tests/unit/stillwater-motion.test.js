/**
 * Stillwater — the small toolkit the two figures are moved with (stillwater-motion.js).
 *
 * The troll and the spirit are posed every frame from springs, a two-bone solver, a change of
 * frame and a pendulum. What their motion relies on is pinned here, not the rates it is tuned
 * with: a spring settles without overshoot and lands on the same state whatever the frame rate, a
 * limb keeps its length and reaches what it can, a rotation takes one frame onto another, what
 * hangs hangs down and stays bounded, and a schedule of moments is the same on every replay.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import {
    Pendulum, Spring3, clamp, ease, momentNear, rotationBetweenFrames, smoothstep, solveTwoBone, spring, springAngle,
    springTo, wrapAngle,
} from '../../src/themes/stillwater/stillwater-motion.js';
import { mulberry32 } from '../../src/themes/stillwater/stillwater-core.js';

/** A random unit-ish vector from a seeded stream. */
const randomVector = (rand, scale = 1) => new THREE.Vector3(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1)
    .multiplyScalar(scale);

/** Step a scalar spring `steps` times by `dt`. */
function stepSpring(state, target, halfLife, dt, steps) {
    for (let i = 0; i < steps; i++) springTo(state, target, halfLife, dt);
    return state;
}

describe('stillwater motion: small maths', () => {
    it('clamps, wraps an angle into (−π, π], eases and smooths', () => {
        expect([clamp(-2, 0, 1), clamp(0.4, 0, 1), clamp(9, 0, 1)]).toEqual([0, 0.4, 1]);
        for (const a of [0, 1, -1, Math.PI, -Math.PI, 3 * Math.PI, -3 * Math.PI, 7, -7, 100.5, -1e3]) {
            const w = wrapAngle(a);
            expect(w, String(a)).toBeGreaterThan(-Math.PI);
            expect(w, String(a)).toBeLessThanOrEqual(Math.PI);
            // The same direction: it differs from the angle by whole turns.
            const turns = (a - w) / (2 * Math.PI);
            expect(Math.abs(turns - Math.round(turns)), String(a)).toBeLessThan(1e-9);
        }
        expect(wrapAngle(Math.PI)).toBe(Math.PI);
        expect(wrapAngle(-Math.PI)).toBe(Math.PI);
        expect(wrapAngle(7)).toBeCloseTo(7 - 2 * Math.PI, 12);
        // Easing is frame-rate independent: two half steps close the same share as one whole step.
        const half = ease(3, 0.05);
        expect(1 - (1 - half) ** 2).toBeCloseTo(ease(3, 0.1), 12);
        expect(ease(3, 0)).toBe(0);
        expect([0, 1, 2, 3, 4].map((v) => smoothstep(1, 3, v))).toEqual([0, 0, 0.5, 1, 1]);
        // Equal edges are a step, not a division by zero.
        expect(Number.isFinite(smoothstep(2, 2, 2))).toBe(true);
    });
});

describe('stillwater motion: springs', () => {
    it('settles from rest without ever passing its target, closer at every step', () => {
        for (const [from, to, halfLife] of [[0, 1, 0.3], [5, -2, 0.06], [-1, -1.5, 1.2]]) {
            const s = spring(from);
            expect(s).toEqual({ x: from, v: 0 });
            let gap = Math.abs(to - from);
            // (Long enough for any of them to come all the way in: twenty half-lives.)
            for (let i = 0; i < Math.ceil(20 * halfLife * 60); i++) {
                springTo(s, to, halfLife, 1 / 60);
                const now = Math.abs(to - s.x);
                expect(now, `${from} → ${to}, step ${i}`).toBeLessThanOrEqual(gap + 1e-15);
                // Never beyond the target: it comes in from the side it started on.
                expect(Math.sign(to - s.x) * Math.sign(to - from), `${from} → ${to}`).toBeGreaterThanOrEqual(0);
                gap = now;
            }
            expect(Math.abs(to - s.x)).toBeLessThan(1e-6 * Math.max(1, Math.abs(to - from)));
            expect(Math.abs(s.v)).toBeLessThan(1e-5);
        }
    });

    it('lands on the same state whatever the frame rate: one step of a second is a hundred of a hundredth', () => {
        const rand = mulberry32(41);
        for (let k = 0; k < 40; k++) {
            const x = rand() * 10 - 5;
            const v = rand() * 10 - 5;
            const target = rand() * 10 - 5;
            const halfLife = 0.05 + rand() * 1.5;
            const one = springTo({ x, v }, target, halfLife, 1);
            const many = stepSpring({ x, v }, target, halfLife, 0.01, 100);
            const label = `x ${x.toFixed(2)}, v ${v.toFixed(2)} → ${target.toFixed(2)} (${halfLife.toFixed(2)} s)`;
            expect(Math.abs(one.x - many.x), label).toBeLessThan(1e-9);
            expect(Math.abs(one.v - many.v), label).toBeLessThan(1e-9);
            // And the same again at a frame rate that does not divide the second.
            const odd = stepSpring({ x, v }, target, halfLife, 1 / 7, 7);
            expect(Math.abs(one.x - odd.x), label).toBeLessThan(1e-9);
        }
    });

    it('stands still for a frame of no time, and takes a frame that is not a number for none', () => {
        for (const dt of [0, -0.1, NaN, undefined]) {
            const s = { x: 0.3, v: 2 };
            expect(springTo(s, 1, 0.2, dt)).toBe(s);
            expect(s, String(dt)).toEqual({ x: 0.3, v: 2 });
        }
        // A half-life of nothing is a very quick spring, not a division by zero.
        const quick = springTo({ x: 0, v: 0 }, 1, 0, 1 / 60);
        expect(Number.isFinite(quick.x)).toBe(true);
        expect(quick.x).toBeCloseTo(1, 6);
    });

    it('turns an angle the short way round, and keeps it in (−π, π]', () => {
        // From just below π to just above −π: the short way crosses π, never 0.
        const s = spring(3.0);
        let nearest = Infinity;
        for (let i = 0; i < 300; i++) {
            springAngle(s, -3.0, 0.2, 1 / 60);
            expect(s.x).toBeGreaterThan(-Math.PI);
            expect(s.x).toBeLessThanOrEqual(Math.PI);
            nearest = Math.min(nearest, Math.abs(s.x));
        }
        expect(nearest).toBeGreaterThan(2.9);
        expect(s.x).toBeCloseTo(-3.0, 5);
        // A target given whole turns away is the same target.
        const a = spring(0.5);
        const b = spring(0.5);
        for (let i = 0; i < 60; i++) {
            springAngle(a, 1.2, 0.3, 1 / 60);
            springAngle(b, 1.2 + 6 * Math.PI, 0.3, 1 / 60);
        }
        expect(b.x).toBeCloseTo(a.x, 9);
    });

    it('springs three numbers at once, each as a spring of its own, and is set at rest', () => {
        const three = new Spring3(1, 2, 3);
        expect(three.x).toEqual([1, 2, 3]);
        expect(three.v).toEqual([0, 0, 0]);
        const singles = [spring(1), spring(2), spring(3)];
        const target = [-1, 0.5, 9];
        for (let i = 0; i < 50; i++) {
            three.step(target[0], target[1], target[2], 0.25, 1 / 30);
            singles.forEach((s, k) => springTo(s, target[k], 0.25, 1 / 30));
        }
        singles.forEach((s, k) => {
            expect(three.x[k]).toBe(s.x);
            expect(three.v[k]).toBe(s.v);
        });
        expect(three.set(4, 5, 6)).toBe(three);
        expect(three.x).toEqual([4, 5, 6]);
        expect(three.v).toEqual([0, 0, 0]);
    });
});

describe('stillwater motion: a limb of two bones', () => {
    const mid = new THREE.Vector3();
    const end = new THREE.Vector3();

    it('keeps both bones their lengths, and puts the end on a target it can reach', () => {
        const rand = mulberry32(7);
        for (let k = 0; k < 200; k++) {
            const a = randomVector(rand, 2);
            const l1 = 0.2 + rand();
            const l2 = 0.2 + rand();
            const pole = randomVector(rand);
            // A target strictly inside the ring the limb can reach.
            const lo = Math.abs(l1 - l2);
            const hi = l1 + l2;
            const distance = lo + (hi - lo) * (0.02 + 0.96 * rand());
            const t = a.clone().add(randomVector(rand).normalize().multiplyScalar(distance));
            const missed = solveTwoBone(a, t, l1, l2, pole, mid, end);
            const label = `limb ${k}`;
            expect(mid.distanceTo(a), label).toBeCloseTo(l1, 9);
            expect(end.distanceTo(mid), label).toBeCloseTo(l2, 9);
            expect(end.distanceTo(t), label).toBeLessThan(1e-9);
            expect(missed, label).toBe(0);
        }
    });

    it('reaches out along the line toward a target too far, and says how far it fell short', () => {
        const rand = mulberry32(8);
        for (let k = 0; k < 100; k++) {
            const a = randomVector(rand, 2);
            const l1 = 0.2 + rand();
            const l2 = 0.2 + rand();
            const way = randomVector(rand).normalize();
            const distance = (l1 + l2) * (1.05 + rand() * 3);
            const t = a.clone().addScaledVector(way, distance);
            const missed = solveTwoBone(a, t, l1, l2, randomVector(rand), mid, end);
            const label = `limb ${k}`;
            expect(mid.distanceTo(a), label).toBeCloseTo(l1, 9);
            expect(end.distanceTo(mid), label).toBeCloseTo(l2, 6);
            // On the line from the root to the target, as far along it as the limb goes.
            const along = end.clone().sub(a);
            expect(along.clone().normalize().dot(way), label).toBeCloseTo(1, 6);
            expect(along.length(), label).toBeCloseTo(l1 + l2, 3);
            expect(missed, label).toBeCloseTo(distance - along.length(), 9);
            expect(missed, label).toBeGreaterThan(0);
        }
    });

    it('bends the middle joint toward the pole', () => {
        const rand = mulberry32(9);
        for (let k = 0; k < 200; k++) {
            const a = randomVector(rand, 2);
            const l1 = 0.3 + rand();
            const l2 = 0.3 + rand();
            const way = randomVector(rand).normalize();
            const t = a.clone().addScaledVector(way, (l1 + l2) * (0.3 + rand() * 0.6));
            const pole = randomVector(rand);
            // (A pole along the line says nothing about which way to bend.)
            const side = pole.clone().addScaledVector(way, -pole.dot(way));
            if (side.length() < 0.05) continue;
            solveTwoBone(a, t, l1, l2, pole, mid, end);
            expect(mid.clone().sub(a).dot(side), `limb ${k}`).toBeGreaterThan(0);
        }
    });

    it('stays finite with a pole along the limb, a target at its root, or bones of one length', () => {
        const a = new THREE.Vector3(0, 1, 0);
        const cases = [
            [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -1, 0), 0.5, 0.5],
            [new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1), 0.5, 0.5],
            [new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1), 0.4, 0.7],
            [new THREE.Vector3(0.3, 0.4, 0), new THREE.Vector3(0, 0, 0), 0.5, 0.5],
        ];
        for (const [t, pole, l1, l2] of cases) {
            const missed = solveTwoBone(a, t, l1, l2, pole, mid, end);
            expect([...mid.toArray(), ...end.toArray(), missed].every(Number.isFinite)).toBe(true);
            expect(mid.distanceTo(a)).toBeCloseTo(l1, 6);
            expect(end.distanceTo(mid)).toBeCloseTo(l2, 3);
        }
    });
});

describe('stillwater motion: a change of frame', () => {
    it('turns the from-direction onto the to-direction, and the from-pole\'s side onto the to-pole\'s', () => {
        const rand = mulberry32(11);
        const q = new THREE.Quaternion();
        for (let k = 0; k < 200; k++) {
            const fromDir = randomVector(rand);
            const fromPole = randomVector(rand);
            const toDir = randomVector(rand);
            const toPole = randomVector(rand);
            const sideOf = (dir, pole) => {
                const d = dir.clone().normalize();
                return pole.clone().addScaledVector(d, -pole.dot(d)).normalize();
            };
            if (sideOf(fromDir, fromPole).length() < 0.5 || sideOf(toDir, toPole).length() < 0.5) continue;
            expect(rotationBetweenFrames(fromDir, fromPole, toDir, toPole, q)).toBe(q);
            const label = `frame ${k}`;
            expect(q.length(), label).toBeCloseTo(1, 9);
            const dir = fromDir.clone().normalize().applyQuaternion(q);
            expect(dir.distanceTo(toDir.clone().normalize()), label).toBeLessThan(1e-9);
            const side = sideOf(fromDir, fromPole).applyQuaternion(q);
            expect(side.distanceTo(sideOf(toDir, toPole)), label).toBeLessThan(1e-9);
        }
    });

    it('is no turn at all from a frame onto itself, and still turns the direction when a pole lies along it', () => {
        const dir = new THREE.Vector3(0.2, -1, 0.1);
        const pole = new THREE.Vector3(0, 0, 1);
        const q = rotationBetweenFrames(dir, pole, dir, pole);
        expect(q.angleTo(new THREE.Quaternion())).toBeLessThan(1e-7);
        const along = rotationBetweenFrames(
            new THREE.Vector3(0, 1, 0),
            new THREE.Vector3(0, 2, 0),
            new THREE.Vector3(1, 0, 0),
            new THREE.Vector3(0, 0, 1),
        );
        expect(along.toArray().every(Number.isFinite)).toBe(true);
        const turned = new THREE.Vector3(0, 1, 0).applyQuaternion(along);
        expect(turned.distanceTo(new THREE.Vector3(1, 0, 0))).toBeLessThan(1e-9);
    });
});

describe('stillwater motion: what hangs', () => {
    it('hangs straight down from a pivot that does not move', () => {
        const lamp = new Pendulum(0.55, 1.2);
        const out = [9, 9, 9];
        expect(lamp.step([1, 2, 3], 1 / 60, out)).toBe(out);
        expect(out).toEqual([0, -0.55, 0]);
        for (let i = 0; i < 600; i++) lamp.step([1, 2, 3], 1 / 60, out);
        expect(out[0]).toBeCloseTo(0, 12);
        expect(out[1]).toBeCloseTo(-0.55, 12);
        expect(out[2]).toBeCloseTo(0, 12);
    });

    it('swings away from the way its pivot is pushed, and settles again', () => {
        for (const [axis, sign] of [[0, 1], [0, -1], [2, 1], [2, -1]]) {
            const lamp = new Pendulum(0.4, 1.6);
            const p = [0, 1, 0];
            const out = [0, 0, 0];
            for (let i = 0; i < 30; i++) lamp.step(p, 1 / 60, out);
            // The pivot sets off: the bob is left behind.
            let most = 0;
            for (let i = 0; i < 20; i++) {
                p[axis] += sign * 0.02;
                lamp.step(p, 1 / 60, out);
                most = Math.max(most, -sign * out[axis]);
            }
            expect(most, `axis ${axis}, ${sign}`).toBeGreaterThan(0.01);
            // It stops: the bob comes back under it.
            for (let i = 0; i < 1200; i++) lamp.step(p, 1 / 60, out);
            expect(Math.abs(out[0]) + Math.abs(out[2]), `axis ${axis}, ${sign}`).toBeLessThan(1e-3);
            expect(out[1]).toBeCloseTo(-0.4, 4);
        }
    });

    /** A pendulum thrown about: long frames, frames of nothing, its pivot jumping, a gale. */
    function throwAbout(lamp, each) {
        const out = [0, 0, 0];
        const p = [0, 0, 0];
        const frames = [1 / 60, 30, 1e-6, 0, 2.5, 1 / 60, 1e-9, 1 / 30];
        for (let i = 0; i < 400; i++) {
            const dt = frames[i % frames.length];
            if (i % 7 === 0) p[0] += 50;
            if (i % 11 === 0) p[1] -= 20;
            lamp.step(p, dt, out, i % 3 ? [500, -500] : null);
            each(out, i);
        }
    }

    it('stays finite and close by its pivot through a long frame, a jump of its pivot and a gale', () => {
        const lamp = new Pendulum(0.3, 0.5);
        let swung = 0;
        throwAbout(lamp, (out, i) => {
            expect(out.every(Number.isFinite), `frame ${i}`).toBe(true);
            // (No further than the cord would reach swung out in both planes at once: see the pin below.)
            expect(Math.hypot(...out), `frame ${i}`).toBeLessThanOrEqual(0.3 * Math.SQRT2);
            // Whatever happens, it hangs below its pivot.
            expect(out[1], `frame ${i}`).toBeLessThan(0);
            swung = Math.max(swung, Math.abs(out[0]), Math.abs(out[2]));
        });
        expect(swung).toBeGreaterThan(0.1);
        lamp.reset();
        expect(lamp.step([0, 0, 0], 1 / 60)).toEqual([0, -0.3, 0]);
    });

    // The bob is a point on the sphere of the cord's length, whatever the two swing angles (found
    // pinned: it once hung up to a third further than its cord in a swing in both planes).
    it('keeps the bob on its cord, however it swings', () => {
        const lamp = new Pendulum(0.3, 0.5);
        let worst = 0;
        throwAbout(lamp, (out) => {
            worst = Math.max(worst, Math.abs(Math.hypot(...out) - 0.3));
        });
        expect(worst).toBeLessThan(1e-9);
    });
});

describe('stillwater motion: a schedule of moments', () => {
    it('finds the same moment for the same clock every time, one in each slot', () => {
        for (const [period, seed] of [[9, 1], [13, 2], [4.5, 7]]) {
            for (let time = 0; time < 200; time += 0.73) {
                const a = momentNear(time, period, seed);
                const b = momentNear(time, period, seed);
                expect(b).toEqual(a);
                expect(a.slot).toBe(Math.floor(time / period));
                expect(a.at).toBeGreaterThanOrEqual(a.slot * period);
                expect(a.at).toBeLessThan((a.slot + 1) * period);
                expect(a.roll).toBeGreaterThanOrEqual(0);
                expect(a.roll).toBeLessThan(1);
                // Any time in the slot names the same moment.
                expect(momentNear(a.slot * period + period * 0.01, period, seed)).toEqual(a);
            }
        }
        // Not the same place in every slot, and not the same for another stream.
        const offsets = Array.from({ length: 20 }, (_, slot) => momentNear(slot * 9 + 1, 9, 1).at - slot * 9);
        expect(new Set(offsets.map((v) => v.toFixed(6))).size).toBeGreaterThan(15);
        expect(momentNear(50, 9, 2).at).not.toBe(momentNear(50, 9, 1).at);
    });
});

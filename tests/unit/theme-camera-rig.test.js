import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { ThemeCameraRig, SHAKE, clearShake } from '../../src/themes/shared/camera-rig.js';

/**
 * The shared theme camera rig.
 *
 * The property that carries the whole design is SCALE INDEPENDENCE: aurora frames its
 * subject from 15 units away and blood-moon from 1200, so an amplitude in world units
 * cannot possibly feel the same in both. The rig takes amplitudes as a fraction of
 * viewport height and converts through the FOV and the focal distance, so the same
 * number produces the same on-screen motion on every rig. These tests pin that, plus
 * the ordering of the shake ladder and the no-accumulation contract.
 */

const degOf = (rad) => (rad * 180) / Math.PI;

function makeRig(options = {}) {
    const {
        fov = 60, distance = 1000, focus = { x: 0, y: 0, z: 0 }, ...rigOptions
    } = options;
    const camera = new THREE.PerspectiveCamera(fov, 16 / 9, 0.1, 100000);
    camera.position.set(0, 0, distance);
    const rig = new ThemeCameraRig(camera, {
        focus, breathe: false, pointer: false, idlePhase: 0, ...rigOptions,
    });
    return { camera, rig, base: { x: 0, y: 0, z: distance } };
}

/** Peak view rotation (degrees) a shake produces, versus an unshaken control. */
function peakShakeDegrees(options, amount, durationMs, frames = 60, dt = 1 / 60) {
    const shaken = makeRig(options);
    const control = makeRig(options);
    shaken.rig.shake(amount, durationMs);
    let peak = 0;
    for (let i = 0; i < frames; i += 1) {
        shaken.rig.apply(dt, shaken.base);
        control.rig.apply(dt, control.base);
        peak = Math.max(peak, degOf(shaken.camera.quaternion.angleTo(control.camera.quaternion)));
    }
    return peak;
}

describe('ThemeCameraRig', () => {
    it('produces the same on-screen shake at wildly different world scales', () => {
        // aurora-like (15 units out, 75° FOV) vs blood-moon-like (1200 units, 60° FOV).
        const near = peakShakeDegrees({ distance: 15, fov: 75 }, ...SHAKE.APEX);
        const far = peakShakeDegrees({ distance: 1200, fov: 60 }, ...SHAKE.APEX);

        // Equal as a FRACTION OF THE FRAME is the contract, so compare degrees per
        // degree of FOV rather than raw degrees.
        const nearFraction = near / 75;
        const farFraction = far / 60;
        expect(nearFraction).toBeGreaterThan(0);
        expect(Math.abs(nearFraction - farFraction) / farFraction).toBeLessThan(0.05);
    });

    it('puts the lock tap and the biggest hit in their intended perceptual bands', () => {
        // Expressed as a fraction of the frame height, so it reads the same everywhere.
        const lock = peakShakeDegrees({ distance: 1200, fov: 60 }, ...SHAKE.LOCK) / 60;
        const apex = peakShakeDegrees({ distance: 1200, fov: 60 }, ...SHAKE.APEX) / 60;

        // A lock fires on every piece: perceptible, never a jolt. ~0.5% of frame height.
        expect(lock).toBeGreaterThan(0.002);
        expect(lock).toBeLessThan(0.012);
        // The apex is a real slam but stays well short of nauseating.
        expect(apex).toBeGreaterThan(0.02);
        expect(apex).toBeLessThan(0.06);
        expect(apex).toBeGreaterThan(lock * 3);
    });

    it('escalates a clear with both line count and combo, and orders the ladder', () => {
        const amount = (lines, combo) => clearShake(lines, combo)[0];

        expect(amount(1, 0)).toBeGreaterThan(SHAKE.LOCK[0]); // any clear out-punches a lock
        expect(amount(2, 1)).toBeGreaterThan(amount(1, 1)); // more lines → bigger
        expect(amount(1, 6)).toBeGreaterThan(amount(1, 1)); // longer chain → bigger
        expect(amount(4, 20)).toBeLessThanOrEqual(SHAKE.CLEAR_MAX); // capped
        expect(SHAKE.TETRIS[0]).toBeGreaterThan(amount(1, 1));
        expect(SHAKE.APEX[0]).toBeGreaterThan(SHAKE.TETRIS[0]);
    });

    it('never accumulates: its own output is never next frame\'s input', () => {
        // The themes assign camera.position outright each frame and some never write
        // every axis, so the rig must not read the camera back to find its base. With
        // every contribution switched off, 200 frames must leave the camera exactly on
        // the base — any feedback path would drift it.
        const { camera, rig, base } = makeRig({ distance: 1200 });
        for (let i = 0; i < 200; i += 1) rig.apply(1 / 60, base);
        expect(camera.position.x).toBe(base.x);
        expect(camera.position.y).toBe(base.y);
        expect(camera.position.z).toBe(base.z);

        // And with everything on, a settled shake plus reset() leaves finite state (a
        // stale internal offset here once produced NaN).
        const live = makeRig({ distance: 1200, breathe: true, pointer: true });
        live.rig.setPointer(1, -1);
        live.rig.shake(...SHAKE.APEX);
        for (let i = 0; i < 200; i += 1) live.rig.apply(1 / 60, live.base);
        live.rig.reset();
        live.rig.apply(1 / 60, live.base);
        expect(Number.isFinite(live.camera.position.x)).toBe(true);
        expect(Number.isFinite(live.camera.position.y)).toBe(true);
        expect(Number.isFinite(live.camera.position.z)).toBe(true);
    });

    it('settles fully and leaves no residual roll', () => {
        const shaken = makeRig({ distance: 1200 });
        const control = makeRig({ distance: 1200 });
        shaken.rig.shake(...SHAKE.APEX);
        for (let i = 0; i < 120; i += 1) {
            shaken.rig.apply(1 / 60, shaken.base);
            control.rig.apply(1 / 60, control.base);
        }
        expect(shaken.rig.currentShakeAmount()).toBe(0);
        expect(shaken.camera.position.distanceTo(control.camera.position)).toBeLessThan(1e-9);
        // quaternion.angleTo is an acos and bottoms out in float noise near 1e-6°.
        expect(degOf(shaken.camera.quaternion.angleTo(control.camera.quaternion))).toBeLessThan(1e-3);
    });

    it('lets a stronger shake take over but never lets a weaker one cut it short', () => {
        const { rig } = makeRig({});
        rig.shake(SHAKE.LOCK[0], 120);
        expect(rig.currentShakeAmount()).toBeCloseTo(SHAKE.LOCK[0], 9);
        rig.shake(SHAKE.LOCK[0] * 0.5, 120); // weaker — ignored
        expect(rig.currentShakeAmount()).toBeCloseTo(SHAKE.LOCK[0], 9);
        rig.shake(SHAKE.APEX[0], 190); // stronger — takes over
        expect(rig.currentShakeAmount()).toBeCloseTo(SHAKE.APEX[0], 9);
    });

    it('breathes and parallaxes in proportion to the rig scale, not in absolute units', () => {
        const settle = (rig, base, camera) => {
            for (let i = 0; i < 240; i += 1) rig.apply(1 / 60, base);
            return Math.abs(camera.position.x - base.x);
        };
        const near = makeRig({
            distance: 15, fov: 60, breathe: true, pointer: true,
        });
        const far = makeRig({
            distance: 1200, fov: 60, breathe: true, pointer: true,
        });
        near.rig.setPointer(1, 0);
        far.rig.setPointer(1, 0);
        const nearX = settle(near.rig, near.base, near.camera);
        const farX = settle(far.rig, far.base, far.camera);

        expect(nearX).toBeGreaterThan(0);
        // Same angular excursion → offsets scale with distance (1200/15 = 80x).
        expect(farX / nearX).toBeCloseTo(80, 0);
    });

    it('is deterministic across a replay so phase-locked captures stay reproducible', () => {
        const run = () => {
            const { camera, rig, base } = makeRig({ distance: 1200, breathe: true });
            const trace = [];
            for (let i = 0; i < 60; i += 1) {
                if (i === 5 || i === 30) rig.shake(...SHAKE.TETRIS);
                rig.apply(1 / 60, base);
                trace.push([camera.position.x, camera.position.y, camera.quaternion.z]);
            }
            return trace;
        };
        expect(run()).toEqual(run());
    });

    it('tolerates a hitched frame without teleporting (delta is clamped internally)', () => {
        // blood-moon feeds an UNCLAMPED clock delta, so a tab stall can hand us seconds.
        const { camera, rig, base } = makeRig({ distance: 1200, breathe: true, pointer: true });
        rig.setPointer(1, 1);
        rig.apply(5.0, base); // a 5-second "frame"
        expect(Number.isFinite(camera.position.x)).toBe(true);
        expect(Math.abs(camera.position.x - base.x)).toBeLessThan(1200);
    });
});

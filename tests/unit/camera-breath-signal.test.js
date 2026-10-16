import {
    afterEach, describe, expect, it,
} from 'vitest';
import * as THREE from 'three';

import { CAMERA_BREATH, applyCameraBreath, cameraBreath } from '../../src/themes/shared/camera-breath.js';
import { readBreathSignal, setBreathSignal } from '../../src/core/breath-signal.js';

/**
 * Breathing with the player: when the breathing guide leads a breath over the theme it
 * publishes the lungs' fill, and every theme's camera follows that breath instead of its own
 * clock — eased in and out, so nothing jumps, and a hold is still.
 */

function posedCamera() {
    const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 100000);
    camera.position.set(0, 0, 1000);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    return camera;
}

/** Pose the camera at rest, breathe it at `time`, and say how high it went. */
function liftAt(camera, time) {
    camera.position.set(0, 0, 1000);
    camera.rotation.set(0, 0, 0);
    applyCameraBreath(camera, time, { distance: 1000 });
    return camera.position.y;
}

afterEach(() => setBreathSignal(null));

describe('the breath signal', () => {
    it('is silent until a guide publishes, clamps what it hears, and survives a broken source', () => {
        expect(readBreathSignal()).toBeNull();
        setBreathSignal(() => 0.4);
        expect(readBreathSignal()).toBe(0.4);
        setBreathSignal(() => 3);
        expect(readBreathSignal()).toBe(1);
        setBreathSignal(() => Number.NaN);
        expect(readBreathSignal()).toBeNull();
        setBreathSignal(() => { throw new Error('gone'); });
        expect(readBreathSignal()).toBeNull();
        setBreathSignal(null);
        expect(readBreathSignal()).toBeNull();
    });
});

describe('a camera following a guided breath', () => {
    it('takes the guide\'s fill, a little larger, with the wander quietened', () => {
        const t = 7.75; // the clock's own breath is part way out here
        const own = cameraBreath(t, 1, { x: 0, y: 0, z: 0 });
        const full = cameraBreath(t, 1, { x: 0, y: 0, z: 0 }, { fill: 1, weight: 1 });
        const empty = cameraBreath(t, 1, { x: 0, y: 0, z: 0 }, { fill: 0, weight: 1 });
        expect(full.z).toBeCloseTo(CAMERA_BREATH.LEAN * CAMERA_BREATH.GUIDED_GAIN, 9);
        expect(empty.z).toBeCloseTo(0, 9);
        expect(Math.abs(full.x)).toBeCloseTo(Math.abs(own.x) * CAMERA_BREATH.GUIDED_WANDER, 9);
        // No weight is the clock's breath exactly: themes untouched when nobody guides.
        expect(cameraBreath(t, 1, { x: 0, y: 0, z: 0 }, { fill: 1, weight: 0 })).toEqual(own);
    });

    it('eases over to the guide and back over FOLLOW_SECONDS of the theme\'s clock, with no jump', () => {
        const camera = posedCamera();
        const dt = 1 / 60;
        let t = 20;
        let last = liftAt(camera, t);
        setBreathSignal(() => 1);
        let maxStep = 0;
        for (let i = 0; i < 60 * (CAMERA_BREATH.FOLLOW_SECONDS + 1); i++) {
            t += dt;
            const y = liftAt(camera, t);
            maxStep = Math.max(maxStep, Math.abs(y - last));
            last = y;
        }
        // Settled on the guide's full lungs: the camera itself stands where the guided breath puts it.
        const span = 2 * Math.tan((60 * Math.PI) / 360);
        const guided = cameraBreath(t, 1, { x: 0, y: 0, z: 0 }, { fill: 1, weight: 1 });
        expect(last).toBeCloseTo(guided.y * span * 1000, 6);
        expect(guided.y).toBeGreaterThan(CAMERA_BREATH.LIFT * CAMERA_BREATH.GUIDED_GAIN * 0.9);
        setBreathSignal(null);
        for (let i = 0; i < 60 * (CAMERA_BREATH.FOLLOW_SECONDS + 1); i++) {
            t += dt;
            const y = liftAt(camera, t);
            maxStep = Math.max(maxStep, Math.abs(y - last));
            last = y;
        }
        // Back on the clock's own breath.
        expect(last).toBeCloseTo(liftAt(posedCamera(), t), 6);
        // Never more than a few units a frame at 1000 units out (the breath alone moves ~0.5).
        expect(maxStep).toBeLessThan(1.5);
    });

    it('holds still while the guide holds, and stays still under reduced motion', () => {
        const camera = posedCamera();
        setBreathSignal(() => 1);
        let t = 0;
        // Arrive on the guide first.
        for (let i = 0; i < 200; i++) liftAt(camera, (t += 1 / 60));
        const a = liftAt(camera, (t += 1 / 60));
        const b = liftAt(camera, (t += 0.5));
        // Only the quietened wander moves during a hold.
        expect(Math.abs(b - a)).toBeLessThan(0.5);
        camera.position.set(0, 0, 1000);
        camera.rotation.set(0, 0, 0);
        expect(applyCameraBreath(camera, t + 1, { distance: 1000, scale: 0 })).toBe(false);
        expect(camera.position.y).toBe(0);
    });
});

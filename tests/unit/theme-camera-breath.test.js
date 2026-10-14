import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three';

import {
    CAMERA_BREATH, applyCameraBreath, breathFill, cameraBreath, prefersReducedMotion,
} from '../../src/themes/shared/camera-breath.js';

/**
 * The shared camera breath.
 *
 * What carries the design: the subject holds its place while the view breathes around
 * it, the motion is the same size on screen at any world scale, a capture that seeks the
 * clock lands on the same pose, and reduced motion leaves the theme's pose untouched.
 */

const PERIOD = CAMERA_BREATH.INHALE + CAMERA_BREATH.EXHALE;

function posedCamera({ fov = 60, distance = 1000 } = {}) {
    const camera = new THREE.PerspectiveCamera(fov, 16 / 9, 0.1, 100000);
    camera.position.set(0, 0, distance);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    return camera;
}

/** Where a world point lands on screen, in viewport heights from the centre. */
function screenOf(camera, point) {
    camera.updateMatrixWorld();
    const p = point.clone().project(camera); // NDC, -1..1 vertically
    return { x: (p.x * camera.aspect) / 2, y: p.y / 2 };
}

describe('camera breath', () => {
    it('fills over the in-breath and empties over the out-breath, eased at both turns', () => {
        expect(breathFill(0)).toBeCloseTo(0, 9);
        expect(breathFill(CAMERA_BREATH.INHALE)).toBeCloseTo(1, 9);
        expect(breathFill(PERIOD)).toBeCloseTo(0, 9);
        expect(breathFill(CAMERA_BREATH.INHALE / 2)).toBeCloseTo(0.5, 9);
        // Zero velocity where the breath turns: a step either side barely moves it.
        const eps = 1e-3;
        expect(Math.abs(breathFill(CAMERA_BREATH.INHALE + eps) - breathFill(CAMERA_BREATH.INHALE - eps)))
            .toBeLessThan(1e-5);
        expect(breathFill(-3)).toBeCloseTo(breathFill(PERIOD - 3), 9);
    });

    it('moves perceptibly within a single breath, not over minutes', () => {
        // The complaint it answers is a camera that looks still. Over one breath the view
        // must swing by at least ~0.5% of the frame: ~5 px at 1080p, visible but calm.
        let lo = Infinity;
        let hi = -Infinity;
        for (let t = 0; t <= PERIOD; t += 0.05) {
            const { y } = cameraBreath(t);
            lo = Math.min(lo, y);
            hi = Math.max(hi, y);
        }
        expect(hi - lo).toBeGreaterThan(0.005);
        // ...and never more than ~2.5% of the frame: a breath, not a sway.
        for (let t = 0; t < 600; t += 0.25) {
            const b = cameraBreath(t);
            expect(Math.hypot(b.x, b.y)).toBeLessThan(0.025);
            expect(b.z).toBeGreaterThanOrEqual(0);
            expect(b.z).toBeLessThanOrEqual(CAMERA_BREATH.LEAN + 1e-12);
        }
    });

    it('is a pure function of time, so a seeked capture lands on the same pose', () => {
        const a = posedCamera();
        const b = posedCamera();
        applyCameraBreath(a, 37.25, { distance: 1000 });
        applyCameraBreath(b, 37.25, { distance: 1000 });
        expect(a.position.toArray()).toEqual(b.position.toArray());
        expect(a.quaternion.toArray()).toEqual(b.quaternion.toArray());
    });

    it('starts from the theme\'s own framing: nothing at time 0', () => {
        const camera = posedCamera();
        const position = camera.position.clone();
        expect(applyCameraBreath(camera, 0, { distance: 1000 })).toBe(false);
        expect(camera.position.equals(position)).toBe(true);
    });

    it('leaves the camera exactly as the theme set it under reduced motion', () => {
        const camera = posedCamera();
        const position = camera.position.clone();
        const quaternion = camera.quaternion.clone();
        expect(applyCameraBreath(camera, 12.5, { distance: 1000, scale: 0 })).toBe(false);
        expect(camera.position.equals(position)).toBe(true);
        expect(camera.quaternion.equals(quaternion)).toBe(true);
    });

    it('holds the subject in place while farther layers slide past it', () => {
        const subject = new THREE.Vector3(0, 0, 0);
        const far = new THREE.Vector3(0, 0, -50000);
        for (const t of [2, 4, 9, 23, 40]) {
            const camera = posedCamera();
            const before = { subject: screenOf(camera, subject), far: screenOf(camera, far) };
            applyCameraBreath(camera, t, { distance: 1000 });
            const after = { subject: screenOf(camera, subject), far: screenOf(camera, far) };
            expect(Math.abs(after.subject.x - before.subject.x)).toBeLessThan(1e-4);
            expect(Math.abs(after.subject.y - before.subject.y)).toBeLessThan(1e-4);
            const b = cameraBreath(t);
            // The far layer moves by about the breath's own amount, in viewport heights.
            expect(Math.hypot(after.far.x - before.far.x, after.far.y - before.far.y))
                .toBeGreaterThan(Math.hypot(b.x, b.y) * 0.8);
        }
    });

    it('is the same size on screen at any world scale', () => {
        const shift = (distance, fov) => {
            const camera = posedCamera({ distance, fov });
            const far = new THREE.Vector3(0, 0, -distance * 100);
            const before = screenOf(camera, far);
            applyCameraBreath(camera, CAMERA_BREATH.INHALE, { distance });
            const after = screenOf(camera, far);
            return Math.hypot(after.x - before.x, after.y - before.y);
        };
        const near = shift(15, 75); // aurora-like
        const distant = shift(1200, 60); // blood-moon-like
        expect(near).toBeGreaterThan(0);
        expect(Math.abs(near - distant) / distant).toBeLessThan(0.05);
    });

    it('keeps the roll a theme gave its camera', () => {
        const camera = posedCamera();
        camera.rotateZ(0.2);
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
        const rollBefore = Math.atan2(up.x, up.y);
        applyCameraBreath(camera, 3, { distance: 1000 });
        const upAfter = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
        expect(Math.atan2(upAfter.x, upAfter.y)).toBeCloseTo(rollBefore, 2);
        const forwardAfter = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
        expect(forwardAfter.angleTo(forward)).toBeLessThan(0.05);
    });

    it('only turns the view when there is no subject distance', () => {
        const camera = posedCamera();
        const position = camera.position.clone();
        applyCameraBreath(camera, 3);
        expect(camera.position.equals(position)).toBe(true);
        expect(camera.quaternion.angleTo(posedCamera().quaternion)).toBeGreaterThan(0);
    });

    it('never accumulates when the theme re-poses the camera every frame', () => {
        const camera = posedCamera();
        const rest = { p: camera.position.clone(), q: camera.quaternion.clone() };
        for (let i = 0; i < 600; i += 1) {
            camera.position.copy(rest.p);
            camera.quaternion.copy(rest.q);
            applyCameraBreath(camera, i / 60, { distance: 1000 });
        }
        const once = posedCamera();
        applyCameraBreath(once, 599 / 60, { distance: 1000 });
        expect(camera.position.distanceTo(once.position)).toBeLessThan(1e-9);
    });

    describe('reduced motion', () => {
        afterEach(() => vi.unstubAllGlobals());

        const fakeWindow = ({ setting = false, system = false } = {}) => ({
            settings: { reducedMotion: setting },
            matchMedia: () => ({ matches: system }),
        });

        it('follows the Settings toggle and the system preference', () => {
            vi.stubGlobal('window', fakeWindow());
            expect(prefersReducedMotion()).toBe(false);
            vi.stubGlobal('window', fakeWindow({ setting: true }));
            expect(prefersReducedMotion()).toBe(true);
            vi.stubGlobal('window', fakeWindow({ system: true }));
            expect(prefersReducedMotion()).toBe(true);
        });

        it('is off where there is no window', () => {
            vi.stubGlobal('window', undefined);
            expect(prefersReducedMotion()).toBe(false);
        });
    });
});

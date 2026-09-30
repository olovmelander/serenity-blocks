import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

import { ThemeCameraRig } from '../../src/themes/shared/camera-rig.js';
import {
    CAM_REST,
    CAMERA_FOCUS,
    CAMERA_RIG,
    S,
    VFOV_DEG,
} from '../../src/playground/effects/parhelion-composition.js';

const DEG = Math.PI / 180;

/** The rig only needs position, fov, lookAt and rotateZ — a plain stand-in, no GPU. */
function stubCamera() {
    return {
        position: { x: CAM_REST.x, y: CAM_REST.y, z: CAM_REST.z },
        fov: VFOV_DEG,
        target: null,
        lookAt(x, y, z) { this.target = { x, y, z }; },
        rotateZ() {},
    };
}

function makeRig(camera, overrides = {}) {
    return new ThemeCameraRig(camera, {
        focus: CAMERA_FOCUS,
        rest: CAM_REST,
        breathe: true,
        pointer: true,
        breatheScale: CAMERA_RIG.BREATHE_SCALE,
        pointerScale: CAMERA_RIG.POINTER_SCALE,
        idlePhase: 0,
        ...overrides,
    });
}

/** Angle (rad) between the camera's aim and the hidden sun's direction S. */
function sunOffset(camera) {
    const dx = CAMERA_FOCUS.x - camera.position.x;
    const dy = CAMERA_FOCUS.y - camera.position.y;
    const dz = CAMERA_FOCUS.z - camera.position.z;
    const len = Math.hypot(dx, dy, dz);
    return Math.acos(Math.min(1, (dx * S.x + dy * S.y + dz * S.z) / len));
}

/** Sweep every pointer extreme through two full breathing cycles; report the envelope. */
function sweep(rig, camera) {
    let maxSun = 0;
    let minY = Infinity;
    let aimedAtStone = true;
    for (const [px, py] of [[-1, -1], [-1, 1], [1, -1], [1, 1], [0, 0], [1, 0], [0, 1]]) {
        rig.setPointer(px, py);
        for (let i = 0; i < 600; i++) {
            rig.apply(0.1, CAM_REST);
            maxSun = Math.max(maxSun, sunOffset(camera));
            minY = Math.min(minY, camera.position.y);
            const t = camera.target;
            aimedAtStone = aimedAtStone && t.x === CAMERA_FOCUS.x && t.y === CAMERA_FOCUS.y
                && t.z === CAMERA_FOCUS.z;
        }
    }
    return { maxSun, minY, aimedAtStone };
}

describe('Parhelion camera life: the shared ThemeCameraRig, re-aimed at the Vigil Stone', () => {
    it('focuses on the stone face straight down the rest view ray', () => {
        const toFocus = {
            x: CAMERA_FOCUS.x - CAM_REST.x,
            y: CAMERA_FOCUS.y - CAM_REST.y,
            z: CAMERA_FOCUS.z - CAM_REST.z,
        };
        const len = Math.hypot(toFocus.x, toFocus.y, toFocus.z);
        expect(toFocus.x / len).toBeCloseTo(S.x, 9);
        expect(toFocus.y / len).toBeCloseTo(S.y, 9);
        expect(toFocus.z / len).toBeCloseTo(S.z, 9);
        // On the stone's front face (z ≈ −117), not the sky behind it.
        expect(CAMERA_FOCUS.z).toBeCloseTo(-117, 6);
    });

    it('breathes and follows the pointer with a parallax you can feel, never exposing the sun', () => {
        const camera = stubCamera();
        const { maxSun, minY, aimedAtStone } = sweep(makeRig(camera), camera);
        // The stone stays the aim point every frame: it holds still under the card.
        expect(aimedAtStone).toBe(true);
        // The world swings visibly around it at full deflection…
        expect(maxSun).toBeGreaterThan(3 * DEG);
        // …but the hidden sun never leaves the stone's core (half-width ≳ 14° at every aspect).
        expect(maxSun).toBeLessThan(8 * DEG);
        // And the camera never dips toward the snow.
        expect(minY).toBeGreaterThan(CAM_REST.y - 10);
    });

    it('breathes alone when the pointer is idle, gently', () => {
        const camera = stubCamera();
        const rig = makeRig(camera);
        let maxSun = 0;
        for (let i = 0; i < 600; i++) {
            rig.apply(0.1, CAM_REST);
            maxSun = Math.max(maxSun, sunOffset(camera));
        }
        expect(maxSun).toBeGreaterThan(0.5 * DEG);
        expect(maxSun).toBeLessThan(2.5 * DEG);
    });

    it('is reproducible: the same time steps from a reset give the same pose', () => {
        const a = stubCamera();
        const b = stubCamera();
        const rigA = makeRig(a);
        const rigB = makeRig(b);
        for (let i = 0; i < 137; i++) rigA.apply(0.05, CAM_REST);
        rigB.apply(0.1, CAM_REST);
        rigB.reset();
        for (let i = 0; i < 137; i++) rigB.apply(0.05, CAM_REST);
        expect(b.position).toEqual(a.position);
    });
});

describe('Parhelion camera wiring', () => {
    const effect = readFileSync('src/playground/effects/parhelion.effect.js', 'utf8');
    const theme = readFileSync('src/themes/parhelion/parhelion-theme.js', 'utf8');

    it('drives the camera through the shared rig (as every theme), not a private sway', () => {
        expect(effect).toMatch(/new ThemeCameraRig\(camera,/);
        expect(effect).toMatch(/focus: CAMERA_FOCUS/);
        expect(effect).toMatch(/cameraRig\.apply\(/);
        expect(effect).not.toMatch(/breathingPose/);
        expect(effect).toMatch(/setPointer\(x, y\)/);
        expect(effect).toMatch(/resetPointer\(\)/);
    });

    it('feeds the pointer from the window and re-centres it on leave, cancel and blur', () => {
        expect(theme).toMatch(/registerEventListener\(window, 'pointermove'/);
        expect(theme).toMatch(/registerEventListener\(window, 'pointerleave'/);
        expect(theme).toMatch(/registerEventListener\(window, 'pointercancel'/);
        expect(theme).toMatch(/registerEventListener\(window, 'blur'/);
        expect(theme).toMatch(/runtime\?\.setPointer\?\.\(x, y\)/);
        // Reduced motion and touch never steer the camera.
        expect(theme).toMatch(/this\.reducedMotion/);
        expect(theme).toMatch(/pointerType === 'touch'/);
    });
});

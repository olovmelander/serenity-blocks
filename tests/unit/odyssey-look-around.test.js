// THE LOOK AROUND (owner, 2026-11-01: "When we move the mouse cursor to the sides in odyssey mode,
// can the camera also move so that we can look around a bit ... We have this for almost all the
// themes also"). The cursor swings the eye on a small arc round what it looks at, eased, sized in
// screen fractions like the themes' rig; it never accumulates, never touches the pose animations
// start from, and stays off with reduced motion.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { LOOK_AROUND, OdysseyCameraController } from '../../src/rendering/odyssey/OdysseyCameraController.js';
import { getLevelRegistry } from '../../src/core/odyssey/LevelRegistry.js';
import { getOdysseyPathCurve } from '../../src/rendering/odyssey/path-utils.js';

function rig({ reducedMotion = false } = {}) {
    const layout = getLevelRegistry().getPresentationLayout();
    const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 4000);
    const controller = new OdysseyCameraController(camera, getOdysseyPathCurve(), {
        levelPositions: layout.levelPositions,
        chapterPositions: layout.chapterPositions,
        startPosition: 0.3,
        idleAutoDrift: false,
        getReducedMotion: () => reducedMotion,
    });
    // Breathing off, so only the look moves the eye.
    controller.cinematicConfig.swayEnabled = false;
    controller.cinematicConfig.bobEnabled = false;
    controller.cinematicConfig.surgeAmplitude = 0;
    controller.setCurrentPosition(0.3);
    return { controller, camera };
}

const settle = (controller, seconds) => {
    for (let i = 0; i < Math.round(seconds * 60); i += 1) controller.update(1 / 60);
};

/** Where the look target sits in the frame, and the eye's offset from where it rests. */
function measure(controller, camera, rest) {
    camera.updateMatrixWorld(true);
    const target = controller.lookAtTarget.clone().project(camera);
    return { target, offset: camera.position.clone().sub(rest) };
}

describe('the look around', () => {
    it('swings the eye toward the cursor side, eased, keeping what it looks at in the middle', () => {
        const { controller, camera } = rig();
        settle(controller, 2);
        const rest = camera.position.clone();
        const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
        controller.setLookPointer(1, 0);
        controller.update(1 / 60);
        const first = camera.position.clone().sub(rest).length();
        settle(controller, 3);
        const { target, offset } = measure(controller, camera, rest);
        // Eased in, not a snap.
        expect(first).toBeLessThan(offset.length() * 0.1);
        // To the right, by the rig's share of a screen at the look target.
        const distance = controller.lookAtTarget.distanceTo(camera.position);
        const expected = LOOK_AROUND.x * THREE.MathUtils.degToRad(camera.fov) * distance;
        expect(offset.dot(right)).toBeGreaterThan(expected * 0.85);
        expect(offset.length()).toBeLessThan(expected * 1.15);
        // The look target stays where the frame keeps it.
        expect(Math.abs(target.x)).toBeLessThan(0.02);
    });

    it('comes back when the cursor does, and never accumulates', () => {
        const { controller, camera } = rig();
        settle(controller, 2);
        const rest = camera.position.clone();
        for (let k = 0; k < 4; k += 1) {
            controller.setLookPointer(k % 2 ? -1 : 1, 0.5);
            settle(controller, 2);
        }
        controller.setLookPointer(0, 0);
        settle(controller, 4);
        expect(camera.position.distanceTo(rest)).toBeLessThan(0.05);
    });

    it('starts an animation from the resting pose, not the swung one', () => {
        const { controller, camera } = rig();
        settle(controller, 2);
        controller.setLookPointer(1, 1);
        settle(controller, 3);
        const resting = controller._restingPosition(new THREE.Vector3());
        expect(resting.distanceTo(camera.position)).toBeGreaterThan(0.5);
        const before = camera.position.clone();
        controller.travelToPosition(0.31, 1500);
        controller.update(1 / 60);
        // The trip begins where the eye was: no jump by the look's offset.
        expect(camera.position.distanceTo(before)).toBeLessThan(0.5);
    });

    it('a camera placed outright between frames is not pulled back by an offset it no longer has', () => {
        const { controller, camera } = rig();
        settle(controller, 2);
        controller.setLookPointer(1, 0);
        settle(controller, 3);
        controller.updateFollowPosition({ position: 0.3, direct: true });
        const placed = camera.position.clone();
        controller.update(1 / 60);
        // One frame on: the follow's own small step and the look easing back on, not a jump of the
        // whole offset the other way.
        const distance = controller.lookAtTarget.distanceTo(camera.position);
        const full = LOOK_AROUND.x * THREE.MathUtils.degToRad(camera.fov) * distance;
        expect(camera.position.distanceTo(placed)).toBeLessThan(full * 1.2);
        const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
        expect(camera.position.clone().sub(placed).dot(right)).toBeGreaterThan(-full * 0.2);
    });

    it('stays still with reduced motion', () => {
        const { controller, camera } = rig({ reducedMotion: true });
        settle(controller, 2);
        const rest = camera.position.clone();
        controller.setLookPointer(1, 1);
        settle(controller, 3);
        expect(camera.position.distanceTo(rest)).toBeLessThan(1e-6);
    });
});

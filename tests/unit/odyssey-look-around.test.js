// THE LOOK AROUND (owner, 2026-11-01: "When we move the mouse cursor to the sides in odyssey mode,
// can the camera also move so that we can look around a bit ... We have this for almost all the
// themes also"; 2026-11-02: "We need to improve this so that we look the way we move the mouse
// pointer, i want to be able to look around a bit more!"). The view turns toward the cursor, eased,
// with a little of the themes' parallax under it; it never accumulates, never touches the pose
// animations start from or what the camera follows, and stays off with reduced motion.
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
    // Breathing off, so only the look moves the view.
    controller.cinematicConfig.swayEnabled = false;
    controller.cinematicConfig.bobEnabled = false;
    controller.cinematicConfig.rollEnabled = false;
    controller.cinematicConfig.surgeAmplitude = 0;
    controller.setCurrentPosition(0.3);
    return { controller, camera };
}

const settle = (controller, seconds) => {
    for (let i = 0; i < Math.round(seconds * 60); i += 1) controller.update(1 / 60);
};

/** The view's forward, right and up. */
function basis(camera) {
    camera.updateMatrixWorld(true);
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    return { forward, right, up };
}

const angleDeg = (a, b) => THREE.MathUtils.radToDeg(a.angleTo(b));

describe('the look around', () => {
    it('turns the view toward the cursor, eased, by its full angle at the edge', () => {
        const { controller, camera } = rig();
        settle(controller, 2);
        const rest = basis(camera);
        controller.setLookPointer(1, 0);
        controller.update(1 / 60);
        const first = angleDeg(basis(camera).forward, rest.forward);
        settle(controller, 4);
        const turned = basis(camera);
        // Eased in, not a snap.
        expect(first).toBeLessThan(LOOK_AROUND.yawDeg * 0.1);
        // Toward the right, by about its angle less the ~2 deg the parallax's shift re-aims back.
        expect(turned.forward.dot(rest.right)).toBeGreaterThan(0);
        expect(angleDeg(turned.forward, rest.forward)).toBeGreaterThan(LOOK_AROUND.yawDeg * 0.75);
        expect(angleDeg(turned.forward, rest.forward)).toBeLessThan(LOOK_AROUND.yawDeg * 1.25);
        // The follow's own aim is untouched: the look target stays where the follow puts it.
        expect(controller.lookAtTarget.distanceTo(controller.computeFollowFrame(0.3).lookTarget)).toBeLessThan(1);
    });

    it('looks up with the cursor up and down with it down', () => {
        const { controller, camera } = rig();
        settle(controller, 2);
        const rest = basis(camera);
        controller.setLookPointer(0, 1);
        settle(controller, 4);
        expect(basis(camera).forward.dot(rest.up)).toBeGreaterThan(Math.sin(THREE.MathUtils.degToRad(LOOK_AROUND.pitchDeg * 0.8)));
        controller.setLookPointer(0, -1);
        settle(controller, 4);
        expect(basis(camera).forward.dot(rest.up)).toBeLessThan(-Math.sin(THREE.MathUtils.degToRad(LOOK_AROUND.pitchDeg * 0.8)));
    });

    it('comes back when the cursor does, and never accumulates', () => {
        const { controller, camera } = rig();
        settle(controller, 2);
        const restPosition = camera.position.clone();
        const rest = basis(camera);
        for (let k = 0; k < 4; k += 1) {
            controller.setLookPointer(k % 2 ? -1 : 1, 0.5);
            settle(controller, 2);
        }
        controller.setLookPointer(0, 0);
        settle(controller, 5);
        expect(camera.position.distanceTo(restPosition)).toBeLessThan(0.05);
        expect(angleDeg(basis(camera).forward, rest.forward)).toBeLessThan(0.3);
    });

    it('starts an animation from the resting pose, not the shifted one', () => {
        const { controller, camera } = rig();
        settle(controller, 2);
        controller.setLookPointer(1, 1);
        settle(controller, 3);
        const resting = controller._restingPosition(new THREE.Vector3());
        expect(resting.distanceTo(camera.position)).toBeGreaterThan(0.1);
        const before = camera.position.clone();
        controller.travelToPosition(0.31, 1500);
        controller.update(1 / 60);
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
        const distance = controller.lookAtTarget.distanceTo(camera.position);
        const shift = LOOK_AROUND.shift * THREE.MathUtils.degToRad(camera.fov) * distance;
        expect(camera.position.distanceTo(placed)).toBeLessThan(shift * 1.5);
    });

    it('stays still with reduced motion', () => {
        const { controller, camera } = rig({ reducedMotion: true });
        settle(controller, 2);
        const restPosition = camera.position.clone();
        const rest = basis(camera);
        controller.setLookPointer(1, 1);
        settle(controller, 3);
        expect(camera.position.distanceTo(restPosition)).toBeLessThan(1e-6);
        expect(angleDeg(basis(camera).forward, rest.forward)).toBeLessThan(1e-3);
    });
});

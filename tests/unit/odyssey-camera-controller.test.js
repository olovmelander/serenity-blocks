import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import * as THREE from 'three';
import { OdysseyCameraController } from '../../src/rendering/odyssey/OdysseyCameraController.js';
import { getLevelRegistry } from '../../src/core/odyssey/LevelRegistry.js';
import { getOdysseyPathCurve } from '../../src/rendering/odyssey/path-utils.js';

function createController() {
    const points = [
        new THREE.Vector3(0, -30, 0),
        new THREE.Vector3(-3, 30, 5),
        new THREE.Vector3(-15, 100, -60),
        new THREE.Vector3(0, 450, -480),
        new THREE.Vector3(0, 960, -600),
    ];
    const curve = new THREE.CatmullRomCurve3(points);
    curve.curveType = 'catmullrom';
    curve.tension = 0.3;

    const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 2000);
    camera.position.set(0, 5, 30);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);

    return new OdysseyCameraController(camera, curve, {
        levelPositions: [0.02, 0.1, 0.18, 0.26],
        chapterPositions: [0, 0.08, 0.16, 0.24, 0.32, 1],
        startPosition: 0.02,
    });
}

function createRealPathController() {
    const registry = getLevelRegistry();
    const layout = registry.getPresentationLayout();
    const curve = getOdysseyPathCurve();

    const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 2000);
    camera.position.set(0, 5, 30);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);

    return {
        controller: new OdysseyCameraController(camera, curve, {
            levelPositions: layout.levelPositions,
            chapterPositions: layout.chapterPositions,
            startPosition: layout.levelPositions[0] ?? 0,
        }),
        registry,
        layout,
    };
}

function projectPointToNdc(point, camera) {
    camera.updateMatrixWorld(true);
    return point.clone().project(camera);
}

describe('OdysseyCameraController path travel', () => {
    let now = 0;

    beforeEach(() => {
        now = 0;
        vi.spyOn(performance, 'now').mockImplementation(() => now);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('updates currentPosition continuously during animated path travel', async () => {
        const controller = createController();
        controller.setCurrentPosition(0.02);
        controller.updateFollowPosition({ direct: true });

        const travelPromise = controller.travelToPosition(0.25, 1000);

        now = 250;
        controller.update(1 / 60);
        expect(controller.getCurrentPosition()).toBeGreaterThan(0.02);
        expect(controller.getCurrentPosition()).toBeLessThan(0.25);

        now = 1000;
        controller.update(1 / 60);

        await expect(travelPromise).resolves.toBe(true);
        expect(controller.getCurrentPosition()).toBeCloseTo(0.25, 4);
        expect(controller.getTravelState().crossedBoundaryIds).toEqual(['1-2', '2-3', '3-4']);
    });

    it('re-arms boundary tracking for reverse travel', async () => {
        const controller = createController();
        controller.setCurrentPosition(0.27);
        controller.updateFollowPosition({ direct: true });

        const reverseTravel = controller.travelToPosition(0.02, 1000);

        now = 500;
        controller.update(1 / 60);
        expect(controller.getCurrentPosition()).toBeLessThan(0.27);
        expect(controller.getCurrentPosition()).toBeGreaterThan(0.02);

        now = 1000;
        controller.update(1 / 60);

        await expect(reverseTravel).resolves.toBe(true);
        expect(controller.getTravelState().crossedBoundaryIds).toEqual(['3-4', '2-3', '1-2']);
    });

    it('plays a level entry zoom with FOV contraction and safe stop distance', () => {
        const controller = createController();
        const targetPosition = new THREE.Vector3(-4, 90, -40);
        const startDistance = controller.camera.position.distanceTo(targetPosition);

        const started = controller.playLevelEntryZoom({
            targetPosition,
            durationMs: 1000,
            fovStart: 60,
            fovEnd: 44,
            distanceBias: 0.3,
        });

        expect(started).toBe(true);

        now = 500;
        controller.update(1 / 60);
        expect(controller.camera.fov).toBeLessThan(60);
        expect(controller.camera.position.distanceTo(targetPosition)).toBeLessThan(startDistance);
        expect(controller.camera.position.distanceTo(targetPosition)).toBeGreaterThan(2.5);

        now = 1000;
        controller.update(1 / 60);
        expect(controller.camera.fov).toBeCloseTo(44, 1);
        expect(controller.camera.position.distanceTo(targetPosition)).toBeGreaterThan(2.5);
        expect(controller.isAnimating).toBe(false);
    });

    it('supports free camera fly navigation and returns to the in-game path view', () => {
        const controller = createController();
        controller.setCurrentPosition(0.18);
        controller.updateFollowPosition({ direct: true });

        const followStart = controller.camera.position.clone();
        const followProgress = controller.getCurrentPosition();

        controller.setFreeMode(true);
        expect(controller.isFreeMode()).toBe(true);

        controller.applyFreeLookDelta(80, -40);
        controller.moveFreeCamera(new THREE.Vector3(4, 8, 24));

        expect(controller.camera.position.distanceTo(followStart)).toBeGreaterThan(10);
        expect(controller.getCurrentPosition()).not.toBeCloseTo(followProgress, 4);

        controller.setFollowMode();
        const expectedFrame = controller.computeFollowFrame(controller.getCurrentPosition());

        expect(controller.isFreeMode()).toBe(false);
        expect(controller.camera.position.distanceTo(expectedFrame.camPos)).toBeLessThan(1e-6);
        expect(controller.lookAtTarget.distanceTo(expectedFrame.lookTarget)).toBeLessThan(1e-6);
    });

    it('keeps keyboard yaw upright during repeated free camera turns', () => {
        const controller = createController();
        controller.setCurrentPosition(0.18);
        controller.updateFollowPosition({ direct: true });
        controller.setFreeMode(true);

        controller.rotateFreeCamera(0, 0.55);
        const positionBeforeYaw = controller.camera.position.clone();
        const upBeforeYaw = controller.freeCameraUp.clone();
        const worldUp = new THREE.Vector3(0, 1, 0);

        for (let index = 0; index < 200; index += 1) {
            controller.rotateFreeCamera(controller.config.freeCamera.keyboardRotateSpeed * 0.05, 0);
        }
        controller.update(1 / 60);

        expect(controller.camera.position.distanceTo(positionBeforeYaw)).toBeLessThan(1e-6);
        expect(controller.freeCameraUp.angleTo(upBeforeYaw)).toBeLessThan(1e-6);
        expect(controller.camera.up.angleTo(worldUp)).toBeLessThan(1e-6);
        expect(controller.camera.quaternion.angleTo(controller.freeCameraQuaternion)).toBeLessThan(1e-6);
    });

    it('keeps the starting level in frame when the board first opens', () => {
        const { controller, registry, layout } = createRealPathController();
        controller.setCurrentPosition(layout.levelPositions[0] ?? 0);
        controller.updateFollowPosition({ direct: true });
        controller.camera.lookAt(controller.lookAtTarget);

        const startingLevel = controller.pathCurve.getPointAt(registry.getLevel(1).pathPosition);
        startingLevel.z += 0.45;
        const ndc = projectPointToNdc(startingLevel, controller.camera);

        expect(ndc.x).toBeGreaterThanOrEqual(-0.35);
        expect(ndc.x).toBeLessThanOrEqual(0.35);
        expect(ndc.y).toBeGreaterThanOrEqual(-0.35);
        expect(ndc.y).toBeLessThanOrEqual(0.35);
        expect(ndc.z).toBeGreaterThan(-1);
        expect(ndc.z).toBeLessThan(1);
    });
});

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ARRIVAL_SHOT, OdysseyCameraController } from './OdysseyCameraController.js';
import { getLevelRegistry } from '../../core/odyssey/LevelRegistry.js';
import { getOdysseyPathCurve } from './path-utils.js';
import { getCameraProfileForChapter } from './chapter-environments/shared/chapter-profile.js';

function createRealPathController(startPosition) {
    const layout = getLevelRegistry().getPresentationLayout();
    const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 4000);
    const controller = new OdysseyCameraController(camera, getOdysseyPathCurve(), {
        levelPositions: layout.levelPositions,
        chapterPositions: layout.chapterPositions,
        startPosition,
        idleAutoDrift: false,
    });
    return { controller, camera, layout };
}

describe('OdysseyCameraController cinematic language (2026-10)', () => {
    it('breathes with a visible, camera-relative offset that never accumulates', () => {
        const { controller, camera } = createRealPathController(0.5);
        controller.setCurrentPosition(0.5);
        controller.update(1 / 60);
        const offsets = [];
        for (let frame = 0; frame < 60 * 20; frame += 1) {
            controller.update(1 / 60);
            // Un-breathed pose = the follow pose the controller would hold without breathing.
            const { camPos } = controller.computeFollowFrame(controller.currentPosition);
            offsets.push(camera.position.distanceTo(camPos));
        }
        const peak = Math.max(...offsets);
        // The old world-axis sway left ~0.05 u after the follow lerp. Now it is felt...
        expect(peak).toBeGreaterThan(0.15);
        // ...but never seasick, and it does not drift away (no accumulation).
        expect(peak).toBeLessThan(controller.directorCamera.followDistance * 0.04);
        expect(offsets[offsets.length - 1]).toBeLessThan(peak + 1e-6);
    });

    it('pulses the FOV as ONE hump from the current FOV, and a restart never snaps', () => {
        const { controller, camera } = createRealPathController(0.5);
        controller.setCurrentPosition(0.5);
        controller.update(1 / 60);
        const base = controller._resolveBaseFov();
        camera.fov = base;
        const realNow = performance.now.bind(performance);
        let now = realNow();
        performance.now = () => now;
        try {
            controller.triggerFovPulse('expand', { amount: 6, duration: 1.5 });
            const samples = [];
            for (let i = 0; i <= 150; i += 1) {
                now += 10;
                controller.updateFovPulse();
                samples.push(camera.fov);
            }
            // Count local maxima above the base: exactly one hump.
            let humps = 0;
            for (let i = 1; i < samples.length - 1; i += 1) {
                if (samples[i] > samples[i - 1] && samples[i] >= samples[i + 1] && samples[i] > base + 0.5) humps += 1;
            }
            expect(humps).toBe(1);
            expect(Math.max(...samples)).toBeCloseTo(base + 6, 0);
            expect(samples[samples.length - 1]).toBeCloseTo(base, 3);

            // Restart mid-hump: the first frame continues from the current FOV.
            controller.triggerFovPulse('expand', { amount: 6, duration: 1.5 });
            now += 10;
            controller.updateFovPulse();
            const before = camera.fov;
            now += 400;
            controller.triggerFovPulse('expand', { amount: 6, duration: 1.5 });
            now += 5;
            controller.updateFovPulse();
            expect(Math.abs(camera.fov - before)).toBeLessThan(2.5);
        } finally {
            performance.now = realNow;
        }
    });

    it('holds an arrival shot at the journey end: orbit, spire on the right third, node in frame', () => {
        const { controller, camera } = createRealPathController(1);
        // The finale's real act camera (followDistance 36, FOV 64 + the crane's +6).
        controller.setDirectorState({ camera: getCameraProfileForChapter(8) });
        controller.setCurrentPosition(1);
        controller.update(1 / 60);
        const restPos = camera.position.clone();
        for (let i = 0; i < 60 * (ARRIVAL_SHOT.orbitSeconds + 4); i += 1) {
            controller.update(1 / 60);
        }
        camera.updateMatrixWorld(true);
        expect(controller._arrivalWeight).toBeGreaterThan(0.95);
        expect(camera.position.distanceTo(restPos)).toBeGreaterThan(5);

        const stage = controller._getStageFrame();
        const hero = controller._resolveArrivalHero(stage).clone().project(camera);
        const node = controller.getPathDataAt(1).position.clone().project(camera);
        expect(hero.x).toBeGreaterThan(0.18);
        expect(hero.x).toBeLessThan(0.45);
        expect(Math.abs(node.x)).toBeLessThan(0.9);
        expect(node.y).toBeGreaterThan(-1);

        // Any scroll releases it.
        controller.scroll(-0.2);
        for (let i = 0; i < 60; i += 1) controller.update(1 / 60);
        expect(controller._arrivalWeight).toBeLessThan(0.2);
    });
});

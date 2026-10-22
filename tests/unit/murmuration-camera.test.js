import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CameraDirector } from '../../src/themes/murmuration/composition/camera-director.js';

function makeDirector() {
    const camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.1, 400);
    const director = new CameraDirector(camera, new THREE.Vector3(0, 0, 0));
    director._idlePhase = 0;
    director.snapToRest();
    return { camera, director };
}

/** Run the director for `seconds` at `hz`. */
function run(director, seconds, hz = 60) {
    const frames = Math.round(seconds * hz);
    for (let i = 0; i < frames; i += 1) director.update(1 / hz);
}

describe('murmuration camera director', () => {
    it('lets rapid taps build a little, under a ceiling, instead of feeling like one', () => {
        const { director } = makeDirector();
        director.shake(0.14, 200);
        const one = director._shakeAmp;
        director.shake(0.14, 200);
        director.shake(0.06, 160);
        expect(director._shakeAmp).toBeGreaterThan(one);
        for (let i = 0; i < 40; i += 1) director.shake(0.14, 200);
        expect(director._shakeAmp).toBeLessThanOrEqual(0.22 + 1e-9);

        director.fovPunch(-2.2);
        const punch = director._eventFovDeltaTarget;
        director.fovPunch(-1.4);
        expect(director._eventFovDeltaTarget).toBeLessThan(punch);
        for (let i = 0; i < 40; i += 1) director.fovPunch(-2.2);
        expect(director._eventFovDeltaTarget).toBeGreaterThanOrEqual(-4 - 1e-9);
    });

    it('settles a push-in in time, not in frames: a 120 Hz screen sees the 60 Hz push', () => {
        const at60 = makeDirector();
        const at120 = makeDirector();
        for (const { director } of [at60, at120]) {
            director.dolly(0.18);
            director.fovPunch(-2.2);
        }
        run(at60.director, 0.25, 60);
        run(at120.director, 0.25, 120);
        expect(at120.director._eventOffsetTarget.length())
            .toBeCloseTo(at60.director._eventOffsetTarget.length(), 6);
        expect(at120.director._eventFovDeltaTarget).toBeCloseTo(at60.director._eventFovDeltaTarget, 6);
        expect(Math.abs(at120.director._eventFovDelta - at60.director._eventFovDelta)).toBeLessThan(0.05);
    });

    it('leans in and holds while asked to, and eases back out', () => {
        const { camera, director } = makeDirector();
        run(director, 2);
        const rest = camera.position.distanceTo(director.focus);
        director.hold(0.2);
        run(director, 6);
        const held = camera.position.distanceTo(director.focus);
        expect(held).toBeLessThan(rest - 0.12);
        director.hold(0);
        run(director, 8);
        expect(camera.position.distanceTo(director.focus)).toBeCloseTo(rest, 1);
        // Never further than its limit, whatever it is asked.
        director.hold(10);
        expect(director._holdTarget).toBeLessThanOrEqual(0.35);
        director.hold(Number.NaN);
        expect(director._holdTarget).toBe(0);
    });
});

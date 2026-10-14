import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three';

import RainyWindowTheme from '../../src/themes/rainy-window/rainy-window-theme.js';

/**
 * Rainy Window under reduced motion (Settings > Reduce motion or the system preference). It read
 * neither before (theme and rendering audit 2026-10, THM-236): full-sky lightning with strobing
 * lights every 3-10 s and on every clear, and a camera that swayed by ±15 units and dived toward
 * the water every 1-8 s.
 */

function stubWindow(reducedMotion) {
    vi.stubGlobal('window', {
        settings: { reducedMotion },
        matchMedia: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
    });
}

/** Degrees the camera's horizon leans (its right axis out of the horizontal). */
function horizonTilt(camera) {
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    return THREE.MathUtils.radToDeg(Math.asin(right.y));
}

function theme() {
    const t = new RainyWindowTheme();
    t.camera = new THREE.PerspectiveCamera(60, 16 / 9, 1, 20000);
    return t;
}

describe('rainy window under reduced motion', () => {
    beforeEach(() => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('turns lightning into one soft sky glow: no bolt, no light flash', () => {
        stubWindow(true);
        const t = theme();
        const bolt = { visible: false };
        t.lightningBolts = [bolt];
        t.triggerLightning(1);
        expect(t.lightningIntensity).toBe(0);
        expect(t.skyFlashIntensity).toBe(0.25);
        expect(bolt.visible).toBe(false);
        // A second strike while it glows does not brighten it further.
        t.triggerLightning(1);
        expect(t.skyFlashIntensity).toBe(0.25);
    });

    it('still lights the sky with a bolt otherwise', () => {
        stubWindow(false);
        const t = theme();
        t.lightningBolts = [];
        t.triggerLightning(1);
        expect(t.lightningIntensity).toBeGreaterThan(1);
        expect(t.skyFlashIntensity).toBeGreaterThan(1);
    });

    it('holds the camera on its rest pose and never dives, then eases back into motion', () => {
        stubWindow(true);
        const t = theme();
        t.nextDipTime = 0;
        for (let frame = 0; frame < 300; frame++) {
            t.updateCameraAnimation();
            expect(t.camera.position.distanceTo(t.baseCameraPosition)).toBeLessThan(1e-9);
        }
        expect(t.isDipping).toBe(false);
        expect(horizonTilt(t.camera)).toBeCloseTo(0, 9); // a level horizon: no roll

        window.settings.reducedMotion = false;
        let moved = 0;
        let step = 0;
        const before = t.camera.position.clone();
        for (let frame = 0; frame < 120; frame++) {
            t.updateCameraAnimation();
            moved = Math.max(moved, t.camera.position.distanceTo(t.baseCameraPosition));
            if (frame === 0) step = t.camera.position.distanceTo(before);
        }
        expect(moved).toBeGreaterThan(2);
        // The roll is the gentle one it was meant to be (about 1.4 degrees at most), not the 1-8
        // degree lean that writing rotation.z after lookAt() used to give.
        expect(Math.abs(horizonTilt(t.camera))).toBeLessThan(1.6);
        expect(step).toBeLessThan(1); // it eases out of the rest pose instead of jumping
        expect(t.isDipping).toBe(true); // and the dives come back
    });
});

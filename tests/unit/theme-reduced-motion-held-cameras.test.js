import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three';

import { updateWolfhourCamera } from '../../src/themes/wolfhour/wolfhour-composition.js';
import WolfhourTheme from '../../src/themes/wolfhour/wolfhour-theme.js';

/**
 * Reduced motion in a theme that read neither input before (theme and rendering audit 2026-10:
 * THM-232 wolfhour; THM-191's theme was replaced by Grainfields, which holds its camera itself).
 * Settings > Reduce motion or the system preference holds the camera at rest and stops what
 * crosses or shakes the screen. Crystal Cave and Cosmic Noir are pinned in their own suites.
 */

function stubWindow(reducedMotion) {
    vi.stubGlobal('window', {
        settings: { reducedMotion },
        matchMedia: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
        innerWidth: 1600,
        innerHeight: 900,
    });
}

describe('reduced motion holds these cameras at rest', () => {
    beforeEach(() => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('wolfhour: no pan, pointer, breath zoom or shake when motion is 0, all of it at 1', () => {
        const camera = new THREE.OrthographicCamera(-889, 889, 500, -500, 1, 10000);
        for (const time of [0, 13, 77, 400]) {
            updateWolfhourCamera(camera, time, 16 / 9, 1, -1, 0.45, 0);
            expect(Math.abs(camera.position.x)).toBeLessThan(1e-12);
            expect(Math.abs(camera.position.y)).toBeLessThan(1e-12);
            expect(camera.top).toBeCloseTo(500, 9);
        }
        updateWolfhourCamera(camera, 13, 16 / 9, 1, -1, 0.45, 1);
        expect(Math.abs(camera.position.x)).toBeGreaterThan(1);
        // Callers that pass no motion keep the full motion.
        const before = camera.position.x;
        updateWolfhourCamera(camera, 13, 16 / 9, 1, -1, 0.45);
        expect(camera.position.x).toBe(before);
    });

    it('wolfhour: no ambient meteors cross the sky under reduced motion', () => {
        const theme = Object.create(WolfhourTheme.prototype);
        Object.assign(theme, {
            time: 100, lastMeteorTime: 0, nextMeteorDelay: 5, activeQualityLevel: 'High', meteors: [],
        });
        theme.random = () => 0.5;
        theme.createMeteor = vi.fn();
        stubWindow(true);
        theme.updateMeteors();
        expect(theme.createMeteor).not.toHaveBeenCalled();
        stubWindow(false);
        theme.updateMeteors();
        expect(theme.createMeteor).toHaveBeenCalledOnce();
    });
});

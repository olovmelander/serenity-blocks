import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';

import { NimbusWorld } from '../../src/themes/nimbus-veil/nimbus-veil-world.js';
import { NeonDuskWorld } from '../../src/themes/neon-dusk/neon-dusk-world.js';
import { SynthwaveWorld } from '../../src/themes/synthwave-sunset/synthwave-sunset-world.js';
import { ChromadelicWorld } from '../../src/themes/chromadelic-highway/chromadelic-highway-world.js';

/**
 * Reduced motion in four themes that read neither input before (theme and rendering audit
 * 2026-10: THM-175 nimbus-veil, THM-190 neon-dusk, THM-61 synthwave-sunset, THM-129
 * chromadelic-highway). Under Settings > Reduce motion or the system preference the camera holds
 * its rest pose whatever the clock and the pointer do; without it the camera drifts as before.
 */

const BOARD = {
    x0: (960 - 162) / 1920, y0: 0.21, x1: (960 + 162) / 1920, y1: 0.79,
};

function seeded(seed = 7) {
    let s = seed;
    return () => {
        s = (s * 16807) % 2147483647;
        return (s - 1) / 2147483646;
    };
}

function stubWindow(reducedMotion) {
    vi.stubGlobal('window', {
        settings: { reducedMotion },
        matchMedia: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
        innerWidth: 1920,
        innerHeight: 1080,
        devicePixelRatio: 1,
        location: { search: '' },
    });
}

const worlds = {
    'nimbus-veil': () => {
        const world = new NimbusWorld({ scene: new THREE.Scene(), random: seeded() }).build();
        world.setLayout(16 / 9, BOARD, { immediate: true });
        return world;
    },
    'neon-dusk': () => {
        const world = new NeonDuskWorld({ scene: new THREE.Scene(), random: seeded() }).build();
        world.setLayout(16 / 9, BOARD, { immediate: true });
        return world;
    },
    'synthwave-sunset': () => {
        const world = new SynthwaveWorld({ scene: new THREE.Scene(), random: seeded() });
        world.setLayout(16 / 9, BOARD, { immediate: true });
        return world;
    },
    'chromadelic-highway': () => {
        const world = new ChromadelicWorld({ scene: null, quality: 'High', random: () => 0.5 });
        world.spawnComet = vi.fn();
        world.spawnMeteor = vi.fn();
        return world;
    },
};

/** Camera positions at a few clock times with the pointer pushed to a corner. */
function poses(world) {
    const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.5, 9000);
    return [3, 41, 97, 160].map((time, i) => {
        world.updateCamera(camera, {
            time, delta: 1 / 60, pointerX: i % 2 ? 1 : -1, pointerY: i % 2 ? -1 : 1, pace: 1,
        });
        return camera.position.clone();
    });
}

describe('reduced motion holds the camera at rest', () => {
    beforeEach(() => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it.each(Object.keys(worlds))('%s: still under reduced motion, drifting without it', (id) => {
        stubWindow(true);
        const still = poses(worlds[id]());
        for (const pose of still) expect(pose.distanceTo(still[0])).toBeLessThan(1e-9);

        stubWindow(false);
        const moving = poses(worlds[id]());
        const spread = Math.max(...moving.map((pose) => pose.distanceTo(moving[0])));
        expect(spread).toBeGreaterThan(0.05);
    });

    it('neon-dusk: no VHS glitch under reduced motion', () => {
        stubWindow(true);
        const world = worlds['neon-dusk']();
        poses(world);
        world.glitch = 1;
        world.update({ time: 200, delta: 1 / 60 });
        expect(world.glitch).toBe(0);
    });
});

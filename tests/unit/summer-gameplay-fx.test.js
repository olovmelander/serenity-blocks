import * as THREE from 'three';
import {
    afterEach, describe, expect, it,
} from 'vitest';

import {
    SUMMER_GAMEPLAY_FX_LIMITS,
    createSummerGameplayFX,
} from '../../src/themes/summer/rendering/summer-gameplay-fx.js';

const instances = [];

function activeSlots(system) {
    let active = 0;
    for (let index = 0; index < system.state.active.length; index += 1) {
        active += system.state.active[index];
    }
    return active;
}

function createHarness(options = {}) {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 100);
    camera.position.set(0, 0, 20);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);

    const fx = createSummerGameplayFX({
        scene, camera, isWebGPU: false, ...options,
    });
    instances.push(fx);
    // Retire the one-frame compile warmup before asserting.
    fx.update(0);
    fx.update(0.001);
    return { scene, camera, fx };
}

function dewCommand(overrides = {}) {
    return {
        type: 'dew-seal',
        worldOrigin: { x: 0, y: 0, z: 4 },
        glyph: {
            cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 1, y: 1 }],
        },
        wispCount: 0,
        durationMs: 520,
        intensity: 1,
        ...overrides,
    };
}

function wreathCommand(overrides = {}) {
    return {
        type: 'wreath',
        worldOrigin: { x: 0, y: 0, z: 4 },
        comboCount: 7,
        tier: 4,
        lobeTarget: 7,
        halo: false,
        durationMs: 1100,
        intensity: 1,
        ...overrides,
    };
}

function flush(fx, cmds) {
    const t = fx.time;
    cmds.forEach((c) => fx.enqueue(c));
    fx.update(t + 0.02);
}

afterEach(() => {
    instances.forEach((fx) => fx.dispose());
    instances.length = 0;
});

describe('Summer gameplay FX — quality budgets', () => {
    it('exposes six tiers with a fixed Extreme maximum', () => {
        const tiers = ['Minimal', 'Low', 'Medium', 'High', 'Ultra', 'Extreme'];
        tiers.forEach((t) => {
            expect(SUMMER_GAMEPLAY_FX_LIMITS[t]).toMatchObject({
                dewBeads: expect.any(Number), atlas: expect.any(Number), halo: expect.any(Number),
            });
        });
        expect(SUMMER_GAMEPLAY_FX_LIMITS.Minimal.atlas).toBe(48);
        expect(SUMMER_GAMEPLAY_FX_LIMITS.Extreme.atlas).toBe(320);
    });

    it('allocates the Extreme maximum once and only adjusts instanceCount on quality change', () => {
        const { fx } = createHarness({ quality: 'High' });
        const dewCapacity = fx.dew.geometry.attributes.aOrigin.array.length;
        fx.setQuality('Minimal');
        expect(fx.dew.geometry.instanceCount).toBe(SUMMER_GAMEPLAY_FX_LIMITS.Minimal.dewBeads);
        // The backing buffer is never reallocated — still the Extreme maximum.
        expect(fx.dew.geometry.attributes.aOrigin.array.length).toBe(dewCapacity);
    });
});

describe('Summer gameplay FX — spawning', () => {
    it('stamps one dew seal plus its wisps from a lock command', () => {
        const { fx } = createHarness();
        flush(fx, [dewCommand({ wispCount: 4 })]);
        expect(activeSlots(fx.dew)).toBe(1);
        expect(activeSlots(fx.atlas)).toBe(4);
        expect(activeSlots(fx.halo)).toBe(0);
    });

    it('stamps the crown lobes plus gather elements from a wreath command', () => {
        const { fx } = createHarness();
        flush(fx, [wreathCommand({ lobeTarget: 7 })]);
        // 7 flower lobes + min(7*3, 18) gather petals/leaves.
        expect(activeSlots(fx.atlas)).toBe(7 + 18);
        expect(activeSlots(fx.halo)).toBe(0);
    });

    it('opens the midnight-sun halo only when the command carries halo', () => {
        const { fx } = createHarness();
        flush(fx, [wreathCommand({ comboCount: 10, tier: 5, halo: true })]);
        expect(activeSlots(fx.halo)).toBe(1);
    });

    it('refreshes rather than stacks the halo across repeated combo-10 waves', () => {
        const { fx } = createHarness({ quality: 'High' });
        for (let i = 0; i < 6; i += 1) {
            flush(fx, [wreathCommand({ comboCount: 10, tier: 5, halo: true })]);
        }
        expect(activeSlots(fx.halo)).toBeLessThanOrEqual(SUMMER_GAMEPLAY_FX_LIMITS.High.halo);
    });
});

describe('Summer gameplay FX — pool bounds', () => {
    it('reclaims the oldest seal slot instead of growing memory', () => {
        const { fx } = createHarness({ quality: 'High' });
        const sealLimit = SUMMER_GAMEPLAY_FX_LIMITS.High.dewBeads / 4;
        flush(fx, Array.from({ length: 30 }, () => dewCommand()));
        expect(activeSlots(fx.dew)).toBe(sealLimit);
    });

    it('trims slots outside the budget when quality drops', () => {
        const { fx } = createHarness({ quality: 'High' });
        flush(fx, Array.from({ length: 12 }, () => dewCommand()));
        expect(activeSlots(fx.dew)).toBe(12);
        fx.setQuality('Low');
        const lowSeals = SUMMER_GAMEPLAY_FX_LIMITS.Low.dewBeads / 4;
        expect(activeSlots(fx.dew)).toBeLessThanOrEqual(lowSeals);
    });
});

describe('Summer gameplay FX — motion, gating, lifecycle', () => {
    it('drops the motion uniform to zero under reduced motion', () => {
        const { fx } = createHarness();
        fx.setReducedMotion(true);
        expect(fx.dew.material.uniforms.uMotion.value).toBe(0);
        expect(fx.atlas.material.uniforms.uMotion.value).toBe(0);
    });

    it('suppresses spawns when intensity is zero', () => {
        const { fx } = createHarness();
        fx.setIntensity(0);
        expect(fx.enqueue(dewCommand())).toBe(false);
    });

    it('is idempotent on dispose and inert afterward', () => {
        const { fx } = createHarness();
        fx.dispose();
        expect(() => fx.dispose()).not.toThrow();
        expect(fx.enqueue(dewCommand())).toBe(false);
        expect(fx.update(1)).toBe(false);
    });
});

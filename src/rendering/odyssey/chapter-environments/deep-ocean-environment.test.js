import {
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { createDeepOceanEnvironment, updateDeepOceanEnvironment } from './deep-ocean.js';
import { hasChapter2CreatureAssets } from './shared/chapter-02-creature-assets.js';

function stubCanvasDocument() {
    const gradient = { addColorStop: vi.fn() };
    const context = {
        clearRect: vi.fn(),
        createRadialGradient: vi.fn(() => gradient),
        fillRect: vi.fn(),
        beginPath: vi.fn(),
        arc: vi.fn(),
        fill: vi.fn(),
    };
    vi.stubGlobal('document', {
        createElement: vi.fn(() => ({
            width: 0,
            height: 0,
            getContext: vi.fn(() => context),
        })),
    });
}

describe('Deep Ocean chapter environment (creative plan ch2)', () => {
    it('mounts the manta trio, vent glow, skylight panes, and the Pearl Gate', () => {
        stubCanvasDocument();

        const group = createDeepOceanEnvironment({ particleCount: 200 });

        expect(group.userData.ventGlow?.name).toBe('hydrothermal-vent-glow');
        expect(group.userData.skylightPanes?.name).toBe('skylight-panes');
        expect(group.userData.pearlGate?.name).toBe('pearl-gate');

        // Creature layer: instance 0 is always the demoted leviathan (shape 3).
        const creatures = group.getObjectByName('ocean-creatures');
        const shapes = creatures.geometry.getAttribute('aShape').array;
        const sizes = creatures.geometry.getAttribute('aSize').array;
        expect(shapes[0]).toBe(3);

        if (hasChapter2CreatureAssets()) {
            // A rigged hero-manta GLB is present, so the billboard hero mantas are skipped
            // (those instances fall through to distant scatter) and the GLB layer is registered.
            expect(Array.isArray(group.userData.mantaFlights)).toBe(true);
            expect([shapes[1], shapes[2], shapes[3]]).not.toEqual([4, 4, 4]);
        } else {
            // No GLB → the billboard manta trio (shape 4) carries the heroes at sizes 35–55.
            expect([shapes[1], shapes[2], shapes[3]]).toEqual([4, 4, 4]);
            [1, 2, 3].forEach((i) => {
                expect(sizes[i]).toBeGreaterThanOrEqual(35);
                expect(sizes[i]).toBeLessThanOrEqual(55);
            });
        }
    });

    it('exposes the ecotone uOpacity bridge on every opacityNode material', () => {
        // Regression guard for the seam-bleed class (same contract as Earth Core).
        stubCanvasDocument();

        const group = createDeepOceanEnvironment({ particleCount: 200 });

        const missing = [];
        group.traverse((child) => {
            if (!child.material) return;
            const materials = Array.isArray(child.material) ? child.material : [child.material];
            materials.forEach((material) => {
                if (material?.opacityNode && !material.uniforms?.uOpacity) {
                    missing.push(child.name || material.type);
                }
            });
        });
        expect(missing).toEqual([]);
    });

    it('drives the depth ladder from camera progress', () => {
        stubCanvasDocument();

        const group = createDeepOceanEnvironment({ particleCount: 200 });
        const { uniforms } = group.userData;
        const tStart = group.userData.chapterTStart;
        const tEnd = group.userData.chapterTEnd;
        expect(Number.isFinite(tStart)).toBe(true);
        expect(tEnd).toBeGreaterThan(tStart);

        // Chapter foot: abyssal twilight (uDepth 0).
        updateDeepOceanEnvironment(group, 0.016, 1.0, null, tStart);
        expect(uniforms.uDepth.value).toBe(0);

        // Mid-climb and the breach.
        updateDeepOceanEnvironment(group, 0.016, 2.0, null, tStart + (tEnd - tStart) * 0.5);
        expect(uniforms.uDepth.value).toBeCloseTo(0.5, 5);
        updateDeepOceanEnvironment(group, 0.016, 3.0, null, tEnd);
        expect(uniforms.uDepth.value).toBeCloseTo(1, 5);
    });
});

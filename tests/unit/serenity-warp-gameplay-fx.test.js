import * as THREE from 'three';
import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import {
    SERENITY_WARP_GAMEPLAY_FX_LIMITS,
    createSerenityWarpGameplayFX,
} from '../../src/themes/serenity-warp/serenity-warp-gameplay-fx.js';

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

    const fx = createSerenityWarpGameplayFX({
        scene,
        camera,
        isWebGPU: false,
        ...options,
    });
    instances.push(fx);

    // Retire the deliberate one-frame compile warmup before making assertions.
    fx.update(0);
    fx.update(0.001);
    return {
        scene,
        camera,
        fx,
        startTime: fx.time,
    };
}

function projectToEffectPlane(camera, normalizedX, normalizedY, z = 4) {
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(
        new THREE.Vector2(normalizedX * 2 - 1, 1 - normalizedY * 2),
        camera,
    );
    return raycaster.ray.intersectPlane(
        new THREE.Plane(new THREE.Vector3(0, 0, 1), -z),
        new THREE.Vector3(),
    );
}

afterEach(() => {
    for (let index = 0; index < instances.length; index += 1) {
        instances[index].dispose();
    }
    instances.length = 0;
});

describe('Serenity Warp gameplay FX WebGL renderer', () => {
    it('keeps every gameplay mesh within the WebGPU vertex-attribute limit', () => {
        const { scene } = createHarness({ isWebGPU: true });
        const gameplayMeshes = [];
        scene.traverse((object) => {
            if (object.isMesh && object.name.startsWith('SerenityWarp')) {
                gameplayMeshes.push(object);
            }
        });

        expect(gameplayMeshes).toHaveLength(6);
        gameplayMeshes.forEach((mesh) => {
            const attributeNames = Object.keys(mesh.geometry.attributes);
            expect(
                attributeNames.length,
                `${mesh.name} uses ${attributeNames.join(', ')}`,
            ).toBeLessThanOrEqual(8);
            expect(attributeNames).toEqual(expect.arrayContaining(['position', 'uv']));
        });
    });

    it('projects a controller Phase Seal into its side lane and preserves its glyph/color', () => {
        const { fx, camera, startTime } = createHarness();
        const command = {
            type: 'phase-seal',
            durationMs: 550,
            intensity: 0.72,
            origin: {
                normalized: { x: 0.48, y: 0.72 },
                sideLane: {
                    side: 'left',
                    normalized: { x: 0.31, y: 0.72 },
                },
            },
            glyph: {
                type: 'T',
                color: '#d33bea',
                cells: [
                    { x: 0, y: 0 },
                    { x: 1, y: 0 },
                    { x: 2, y: 0 },
                    { x: 1, y: 1 },
                ],
            },
            envelope: {
                durationMs: 550,
                ringStartMs: 40,
                ringEndMs: 280,
            },
            ringCount: 1,
        };

        expect(fx.systems.every((system) => system.material.isShaderMaterial)).toBe(true);
        expect(fx.getDebugState().backend).toBe('webgl');
        expect(fx.enqueue(command)).toBe(true);
        fx.update(startTime);

        const expectedOrigin = projectToEffectPlane(camera, 0.31, 0.72);
        const expectedColor = new THREE.Color(command.glyph.color);
        expect(activeSlots(fx.phaseSeals)).toBe(1);
        // The four centred cell offsets pack into two vec4 attributes (cells 0/1 → AB, 2/3 → CD)
        // that the union-SDF fragment fuses into one solid silhouette.
        expect(Array.from(fx.phaseSeals.cellsAB.slice(0, 4))).toEqual([-1, 0.25, 0, 0.25]);
        expect(Array.from(fx.phaseSeals.cellsCD.slice(0, 4))).toEqual([1, 0.25, 0, -0.75]);
        expect(fx.phaseSeals.origin[0]).toBeCloseTo(expectedOrigin.x, 5);
        expect(fx.phaseSeals.origin[1]).toBeCloseTo(expectedOrigin.y, 5);
        expect(fx.phaseSeals.origin[2]).toBeCloseTo(expectedOrigin.z, 5);
        expect(fx.phaseSeals.color[0]).toBeCloseTo(expectedColor.r, 5);
        expect(fx.phaseSeals.color[1]).toBeCloseTo(expectedColor.g, 5);
        expect(fx.phaseSeals.color[2]).toBeCloseTo(expectedColor.b, 5);
        expect(fx.phaseSeals.alpha[0]).toBeCloseTo(0.72 * 0.92, 5);

        fx.update(startTime + 0.039);
        expect(activeSlots(fx.rings)).toBe(0);
        fx.update(startTime + 0.041);
        expect(activeSlots(fx.rings)).toBe(1);
        expect(fx.rings.birth[0]).toBeCloseTo(startTime + 0.04, 6);
        expect(fx.rings.state.end[0]).toBeCloseTo(startTime + 0.28, 8);

        fx.update(startTime + 0.549);
        expect(activeSlots(fx.phaseSeals)).toBe(1);
        fx.update(startTime + 0.551);
        expect(activeSlots(fx.phaseSeals)).toBe(0);
    });

    it.each([
        ['echo', {
            rings: 1, nodes: 0, links: 0, ellipses: 0, streaks: 0,
        }],
        ['constellation', {
            rings: 0, nodes: 5, links: 5, ellipses: 0, streaks: 0,
        }],
        ['aperture', {
            rings: 0, nodes: 0, links: 0, ellipses: 2, streaks: 8,
        }],
        ['sevenfold', {
            rings: 0, nodes: 7, links: 7, ellipses: 3, streaks: 16,
        }],
    ])('maps the %s combo stage to the intended bounded pools', (stage, expected) => {
        const { fx, startTime } = createHarness();

        expect(fx.enqueue({
            type: 'spectrum-gate',
            stage,
            durationMs: 2200,
            intensity: 1,
            origin: { position: { x: 1.5, y: -0.75, z: 4 } },
        })).toBe(true);
        fx.update(startTime);

        expect({
            rings: activeSlots(fx.rings),
            nodes: activeSlots(fx.nodes),
            links: activeSlots(fx.links),
            ellipses: activeSlots(fx.ellipses),
            streaks: activeSlots(fx.streaks),
        }).toEqual(expected);
    });

    it('schedules the B2B half-echo from delayMs without shortening its absolute envelope', () => {
        const { fx, startTime } = createHarness();

        expect(fx.enqueue({
            type: 'b2b-echo',
            delayMs: 180,
            durationMs: 620,
            intensity: 0.52,
            origin: { position: { x: -2, y: 1, z: 4 } },
        })).toBe(true);
        fx.update(startTime + 0.179);
        expect(activeSlots(fx.rings)).toBe(0);
        expect(fx.getDebugState().pendingCommands).toBe(1);

        fx.update(startTime + 0.181);
        expect(activeSlots(fx.rings)).toBe(1);
        expect(fx.rings.birth[0]).toBeCloseTo(startTime + 0.18, 6);
        expect(fx.rings.state.end[0]).toBeCloseTo(startTime + 0.62, 8);
    });

    it.each([
        ['Low', SERENITY_WARP_GAMEPLAY_FX_LIMITS.Low],
        ['Medium', SERENITY_WARP_GAMEPLAY_FX_LIMITS.Medium],
        ['High', SERENITY_WARP_GAMEPLAY_FX_LIMITS.High],
    ])('applies the %s fixed instance budgets', (quality, limits) => {
        const { fx } = createHarness({ quality });

        expect(fx.phaseSeals.geometry.instanceCount).toBe(limits.seals);
        expect(fx.rings.geometry.instanceCount).toBe(limits.rings);
        expect(fx.nodes.geometry.instanceCount).toBe(limits.nodes);
        expect(fx.links.geometry.instanceCount).toBe(limits.links);
        expect(fx.ellipses.geometry.instanceCount).toBe(limits.ellipses);
        expect(fx.streaks.geometry.instanceCount).toBe(limits.streaks);
    });

    it('suppresses travel streaks and shortens the aperture under reduced motion', () => {
        const { fx, startTime } = createHarness({ quality: 'High' });
        fx.setReducedMotion(true);

        expect(fx.streaks.geometry.instanceCount).toBe(0);
        expect(fx.enqueue({
            type: 'spectrum-gate',
            stage: 'aperture',
            durationMs: 1400,
            intensity: 1,
            origin: { position: { x: 0, y: 0, z: 4 } },
        })).toBe(true);
        fx.update(startTime);

        expect(activeSlots(fx.ellipses)).toBeGreaterThan(0);
        expect(activeSlots(fx.streaks)).toBe(0);
        expect(fx.streaks.mesh.visible).toBe(false);
        expect(fx.ellipses.state.end[0] - startTime).toBeLessThanOrEqual(0.26);
    });

    it('removes and disposes every pool exactly once', () => {
        const { fx, scene, startTime } = createHarness();
        const { group } = fx;
        const disposeSpies = fx.systems.flatMap((system) => [
            vi.spyOn(system.geometry, 'dispose'),
            vi.spyOn(system.material, 'dispose'),
        ]);
        fx.enqueue({
            type: 'phase-seal',
            ringCount: 0,
            origin: { position: { x: 0, y: 0, z: 4 } },
            glyph: { type: 'O', cells: [[0, 0], [1, 0], [0, 1], [1, 1]] },
        });
        fx.update(startTime);
        expect(scene.children).toContain(group);
        expect(fx.hasActiveEffects()).toBe(true);

        fx.dispose();
        fx.dispose();

        expect(scene.children).not.toContain(group);
        expect(group.children).toHaveLength(0);
        expect(fx.disposed).toBe(true);
        expect(fx.initialized).toBe(false);
        expect(fx.hasActiveEffects()).toBe(false);
        disposeSpies.forEach((disposeSpy) => expect(disposeSpy).toHaveBeenCalledTimes(1));
    });
});

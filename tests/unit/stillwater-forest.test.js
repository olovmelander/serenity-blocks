import { readFileSync } from 'node:fs';
import * as THREE from 'three/webgpu';
import {
    describe,
    expect,
    it,
    vi,
} from 'vitest';

import { createStillwaterForest } from '../../src/themes/stillwater/rendering/stillwater-forest.js';

const forestSource = readFileSync(
    new URL('../../src/themes/stillwater/rendering/stillwater-forest.js', import.meta.url),
    'utf8',
);
const forestEffectSource = readFileSync(
    new URL('../../src/playground/effects/stillwater-forest.effect.js', import.meta.url),
    'utf8',
);
const floraEffectSource = readFileSync(
    new URL('../../src/playground/effects/stillwater-flora.effect.js', import.meta.url),
    'utf8',
);
const playgroundAdapterSource = readFileSync(
    new URL('../../src/playground/effects/stillwater-wave4-playground.js', import.meta.url),
    'utf8',
);

function makeRuntime(options = {}) {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(47, 16 / 9, 0.1, 850);
    const runtime = createStillwaterForest({
        scene,
        camera,
        quality: 'High',
        ...options,
    });
    return { scene, camera, runtime };
}

function extractMetaId(source) {
    return source.match(
        /export const meta\s*=\s*\{[\s\S]*?\bid:\s*['"]([^'"]+)['"]/,
    )?.[1];
}

function reversedSmoothsteps(source) {
    return [...source.matchAll(
        /smoothstep\(\s*(-?(?:\d+(?:\.\d*)?|\.\d+))\s*,\s*(-?(?:\d+(?:\.\d*)?|\.\d+))/g,
    )]
        .filter((match) => Number(match[1]) > Number(match[2]))
        .map((match) => match[0]);
}

describe('Stillwater Wave 4 forest and flora', () => {
    it('holds the forest language to five tree draws and the Low total budget', () => {
        const { runtime } = makeRuntime({ quality: 'Low', mode: 'forest' });
        const diagnostics = runtime.getDiagnostics();

        expect(diagnostics.boardSafe).toBe(true);
        expect(diagnostics.focalIntrusions).toBe(0);
        // 11 not 10: Low retains 4 hero trees because the two cropped framing
        // trunks are composition, not detail, and are never tier-dropped.
        expect(diagnostics.counts.forestTrees).toBe(11);
        expect(diagnostics.counts.farTrees).toBe(0);
        expect(diagnostics.counts.canopyClusters).toBe(12);
        expect(diagnostics.draws.trees).toBeGreaterThanOrEqual(3);
        expect(diagnostics.draws.trees).toBeLessThanOrEqual(7);
        expect(diagnostics.draws.direct).toBe(7);
        expect(diagnostics.draws.direct).toBe(diagnostics.draws.estimated);
        expect(diagnostics.draws.direct).toBeLessThanOrEqual(7);
        expect(diagnostics.draws.trees).toBe(3);
        expect(diagnostics.draws.dressing).toBe(1);
        expect(diagnostics.counts.boulders).toBe(0);
        expect(diagnostics.counts.reeds).toBe(0);
        expect(diagnostics.counts.lilies).toBe(0);
        expect(diagnostics.particles).toBe(0);
        expect(diagnostics.postProcessing).toBe(false);
        expect(diagnostics.characters).toBe(false);

        runtime.dispose();
    });

    it('adds four authored mushroom clusters in three draws with no real lights', () => {
        const { scene, runtime } = makeRuntime({ mode: 'flora' });
        const diagnostics = runtime.getDiagnostics();
        const pointLights = [];
        scene.traverse((object) => {
            if (object.isPointLight) pointLights.push(object);
        });

        expect(diagnostics.counts.mushroomClusters).toBe(4);
        expect(diagnostics.counts.mushrooms).toBe(24);
        expect(diagnostics.draws.flora).toBe(3);
        expect(diagnostics.draws.flora).toBeLessThanOrEqual(4);
        expect(diagnostics.draws.direct).toBe(15);
        expect(diagnostics.realMushroomLights).toBe(0);
        expect(pointLights).toEqual([]);

        runtime.dispose();
    });

    it('holds the integrated Medium forest to eight direct draws', () => {
        const { runtime } = makeRuntime({
            quality: 'Medium',
            mode: 'flora',
            includeTerrain: false,
            includeShoreRoots: false,
        });
        const diagnostics = runtime.getDiagnostics();

        expect(diagnostics.draws).toMatchObject({
            direct: 8,
            estimated: 8,
            trees: 3,
            dressing: 1,
            flora: 3,
        });
        expect(diagnostics.counts).toMatchObject({
            farTrees: 0,
            boulders: 0,
            reeds: 0,
            lilies: 10,
            mushroomClusters: 3,
        });

        runtime.dispose();
    });

    it('reflects only the five major forest masses and excludes small shore detail', () => {
        const { scene, runtime } = makeRuntime({
            mode: 'flora',
            includeTerrain: false,
            includeShoreRoots: false,
            reflectionLayer: 2,
        });
        const excluded = [
            'stillwater-instanced-wet-boulders',
            'stillwater-instanced-reeds',
            'stillwater-instanced-lilies',
            'stillwater-instanced-mushroom-stems',
            'stillwater-instanced-emissive-mushroom-caps',
            'stillwater-instanced-fake-mushroom-light-pools',
        ];

        expect(runtime.getDiagnostics().reflectionRenderables).toBe(5);
        excluded.forEach((name) => {
            expect(scene.getObjectByName(name).layers.isEnabled(2)).toBe(false);
        });

        runtime.dispose();
    });

    it('changes only existing draw counts across all six quality tiers', () => {
        const { runtime } = makeRuntime({ quality: 'Minimal', mode: 'flora' });
        const before = runtime.getResourceState();
        const beforeMatrices = before.instanceMatrixArrays;

        // Minimal keeps the two framing trunks too, so 8 rather than 7.
        expect(runtime.getDiagnostics().counts.forestTrees).toBe(8);
        expect(runtime.getDiagnostics().counts.mushroomClusters).toBe(2);
        expect(runtime.setQuality('Extreme')).toBe(true);

        const after = runtime.getResourceState();
        const diagnostics = runtime.getDiagnostics();
        expect(diagnostics.counts.forestTrees).toBe(42);
        expect(diagnostics.counts.canopyClusters).toBe(28);
        expect(diagnostics.counts.mushroomClusters).toBe(4);
        expect(after.ownedGeometries).toBe(before.ownedGeometries);
        expect(after.ownedMaterials).toBe(before.ownedMaterials);
        expect(after.geometryUuids).toBe(before.geometryUuids);
        expect(after.materialUuids).toBe(before.materialUuids);
        expect(after.instanceMatrixArrays).toBe(beforeMatrices);
        Object.keys(beforeMatrices).forEach((key) => {
            expect(after.instanceMatrixArrays[key]).toBe(beforeMatrices[key]);
        });

        runtime.dispose();
    });

    it('keeps resource identities fixed through a 48-pulse relay storm', () => {
        const { runtime } = makeRuntime({ mode: 'flora' });
        const before = runtime.getResourceState();

        for (let index = 0; index < 48; index += 1) {
            runtime.pulse(index % 4 === 0 ? 'COMBO' : 'PIECE_LOCK', {
                comboCount: index % 11,
            });
            runtime.update(index / 60, 1 / 60);
        }
        const after = runtime.getResourceState();

        expect(after.ownedGeometries).toBe(before.ownedGeometries);
        expect(after.ownedMaterials).toBe(before.ownedMaterials);
        expect(after.rootObjects).toBe(before.rootObjects);
        expect(after.renderables).toBe(before.renderables);
        expect(after.geometryUuids).toBe(before.geometryUuids);
        expect(after.materialUuids).toBe(before.materialUuids);
        expect(after.instanceMatrixArrays).toBe(before.instanceMatrixArrays);

        runtime.dispose();
    });

    it('uses a deterministic layout and explicit reduced-motion shaping', () => {
        const first = makeRuntime({ mode: 'flora', reducedMotion: true });
        const second = makeRuntime({ mode: 'flora', reducedMotion: true });

        expect(first.runtime.getDiagnostics().layoutSignature).toBe(
            second.runtime.getDiagnostics().layoutSignature,
        );
        expect(first.runtime.getDiagnostics().reducedMotion).toBe(true);
        expect(first.runtime.getDiagnostics().motionScale).toBe(0.08);
        first.runtime.setReducedMotion(false);
        expect(first.runtime.getDiagnostics().motionScale).toBe(1);

        first.runtime.dispose();
        second.runtime.dispose();
    });

    it('removes the owned root and disposes each owned geometry and material once', () => {
        const { scene, runtime } = makeRuntime({ mode: 'flora' });
        const root = scene.getObjectByName('StillwaterForestFlora');
        const geometries = new Set();
        const materials = new Set();
        root.traverse((object) => {
            if (object.geometry) geometries.add(object.geometry);
            const objectMaterials = Array.isArray(object.material)
                ? object.material
                : [object.material];
            objectMaterials.filter(Boolean).forEach((material) => materials.add(material));
        });
        const geometrySpies = [...geometries].map((geometry) => vi.spyOn(geometry, 'dispose'));
        const materialSpies = [...materials].map((material) => vi.spyOn(material, 'dispose'));

        runtime.dispose();

        expect(scene.children).not.toContain(root);
        geometrySpies.forEach((spy) => expect(spy).toHaveBeenCalledTimes(1));
        materialSpies.forEach((spy) => expect(spy).toHaveBeenCalledTimes(1));
        expect(runtime.getResourceState().disposed).toBe(true);
    });

    it('keeps the Wave 4 surface TSL-only, instanced, and free of heavy layers', () => {
        expect(forestSource).toMatch(
            /import\s+\*\s+as\s+THREE\s+from\s+['"]three\/webgpu['"]/,
        );
        expect(forestSource).toMatch(/from\s+['"]three\/tsl['"]/);
        expect(forestSource).toContain("from '../stillwater-quality.js'");
        expect(forestSource).toContain('getStillwaterQualityProfile(');
        expect(forestSource).toContain('positionGeometry');
        expect(forestSource).toMatch(/new THREE(?:_NS)?\.InstancedMesh\(/);
        expect(forestSource).not.toMatch(/\bTHREE\.ShaderMaterial\b/);
        expect(forestSource).not.toMatch(/\bTHREE\.Points\b|\bTHREE\.PointsNodeMaterial\b/);
        expect(forestSource).not.toMatch(/\bTHREE\.PointLight\b/);
        expect(forestSource).not.toMatch(/\bTHREE\.PostProcessing\b|\bbloom\s*\(/);
        expect(reversedSmoothsteps(forestSource)).toEqual([]);
    });

    it('registers two unique small pilots around the exact shared builder', () => {
        expect(extractMetaId(forestEffectSource)).toBe('stillwater-forest');
        expect(extractMetaId(floraEffectSource)).toBe('stillwater-flora');
        expect(forestEffectSource).toContain("mode: 'forest'");
        expect(floraEffectSource).toContain("mode: 'flora'");
        expect(playgroundAdapterSource).toContain('createStillwaterForest({');
        expect(playgroundAdapterSource).toMatch(
            /import\s+\*\s+as\s+THREE\s+from\s+['"]three\/webgpu['"]/,
        );
        expect(playgroundAdapterSource).toMatch(/from\s+['"]three\/tsl['"]/);
    });
});

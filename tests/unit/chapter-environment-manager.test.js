import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
    ChapterEnvironmentManager,
    resolveChapterBlendState,
} from '../../src/rendering/odyssey/ChapterEnvironmentManager.js';
import {
    createSurfaceWorldEnvironment,
} from '../../src/rendering/odyssey/chapter-environments/surface-world.js';
import {
    createMountainPeaksEnvironment,
    updateMountainPeaksEnvironment,
} from '../../src/rendering/odyssey/chapter-environments/mountain-peaks.js';
import { ODYSSEY_PATH_DATA } from '../../src/rendering/odyssey/path-data.js';

describe('resolveChapterBlendState', () => {
    it('uses the configured 3->4 seam window and blends symmetrically', () => {
        const boundary = ODYSSEY_PATH_DATA.chapterPositions[3];
        const centerState = resolveChapterBlendState(boundary);
        const leftState = resolveChapterBlendState(boundary - 0.02);
        const rightState = resolveChapterBlendState(boundary + 0.02);

        expect(centerState.inSeam).toBe(true);
        expect(centerState.boundaryId).toBe('3-4');
        expect(leftState.inSeam).toBe(true);
        expect(rightState.inSeam).toBe(true);
        expect(centerState.weights[3]).toBeCloseTo(0.5, 2);
        expect(centerState.weights[4]).toBeCloseTo(0.5, 2);
        expect(leftState.weights[3]).toBeCloseTo(rightState.weights[4], 4);
        expect(leftState.weights[4]).toBeCloseTo(rightState.weights[3], 4);
    });

    it('uses the configured 6->7 seam window and blends symmetrically', () => {
        const boundary = ODYSSEY_PATH_DATA.chapterPositions[6];
        const centerState = resolveChapterBlendState(boundary);
        const leftState = resolveChapterBlendState(boundary - 0.01);
        const rightState = resolveChapterBlendState(boundary + 0.01);

        expect(centerState.inSeam).toBe(true);
        expect(centerState.boundaryId).toBe('6-7');
        expect(centerState.weights[6]).toBeCloseTo(0.5, 2);
        expect(centerState.weights[7]).toBeCloseTo(0.5, 2);
        expect(leftState.weights[6]).toBeCloseTo(rightState.weights[7], 4);
        expect(leftState.weights[7]).toBeCloseTo(rightState.weights[6], 4);
    });

    it('falls back to a single active chapter outside seam windows', () => {
        const state = resolveChapterBlendState(0.42);
        expect(state.inSeam).toBe(false);
        expect(state.activeChapter).toBe(4);
        expect(state.weights[4]).toBe(1);
        expect(Object.values(state.weights).filter((weight) => weight > 0)).toHaveLength(1);
    });

    it('keeps chapter 4 alive into early chapter 5 with the widened seam', () => {
        const inside = resolveChapterBlendState(0.556);
        const outside = resolveChapterBlendState(0.561);

        expect(inside.inSeam).toBe(true);
        expect(inside.boundaryId).toBe('4-5');
        expect(inside.weights[4]).toBeGreaterThan(0);
        expect(inside.weights[5]).toBeGreaterThan(0);
        expect(outside.inSeam).toBe(false);
        expect(outside.activeChapter).toBe(5);
        expect(outside.weights[4]).toBe(0);
    });
});

describe('Chapter 3 to 4 ground continuity', () => {
    it('builds a muted foothill bridge instead of the old flat snow-floor seam', () => {
        const environment = createSurfaceWorldEnvironment();
        const bridgeUniforms = environment.userData.foothillBridge.material.uniforms;
        const previewLayerOpacities = environment.userData.auroraPreview.children.map(
            (mesh) => mesh.material.uniforms.uLayerOpacity.value,
        );

        expect(environment.userData.foothillBridge).toBeTruthy();
        expect(environment.getObjectByName('foothill-bridge')).toBeTruthy();
        expect(environment.getObjectByName('mountain-snow-floor')).toBeFalsy();
        expect(environment.userData.auroraPreview?.children).toHaveLength(3);
        expect(previewLayerOpacities).toEqual([0.35, 0.25, 0.18]);
        expect(bridgeUniforms.uSnowBlend).toBeTruthy();
        expect(environment.userData.foothillBridge.material.depthWrite).toBe(true);
        expect(bridgeUniforms.uGrassColor.value.getHex()).toBe(0x5f8a58);
        expect(bridgeUniforms.uTundraColor.value.getHex()).toBe(0x7b7468);
        expect(bridgeUniforms.uSnowColor.value.getHex()).toBe(0xdce5ea);
        expect(bridgeUniforms.uShadowColor.value.getHex()).toBe(0x5d6670);
        expect(bridgeUniforms.uFogColor.value.getHex()).toBe(0xd9e3e7);
    });

    it('keeps Chapter 4 grounded before the alpine look fully takes over', () => {
        const environment = createMountainPeaksEnvironment();
        const previewEnvironment = createSurfaceWorldEnvironment();
        const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 4000);
        const apronZ = environment.userData.foothillApron.children.map((mesh) => mesh.position.z);
        const previewAnchors = previewEnvironment.userData.auroraPreview.children.map((mesh) => mesh.position.toArray());
        const fullAnchors = environment.userData.aurora.children
            .slice(0, 3)
            .map((mesh) => mesh.position.toArray());
        const mainPeakUniforms = environment.userData.mainPeaks.children[0].material.uniforms;
        const apronUniforms = environment.userData.foothillApron.children[0].material.uniforms;

        expect(environment.userData.foothillApron?.children).toHaveLength(3);
        expect(apronZ).toEqual([-600, -860, -710]);
        expect(fullAnchors).toEqual(previewAnchors);
        expect(mainPeakUniforms.uSnowColor.value.getHex()).toBe(0xc7d6e0);
        expect(mainPeakUniforms.uSnowColorWarm.value.getHex()).toBe(0xbfc9d3);
        expect(mainPeakUniforms.uRockColor.value.getHex()).toBe(0x465463);
        expect(mainPeakUniforms.uRockColorWarm.value.getHex()).toBe(0x667789);
        expect(mainPeakUniforms.uFogColor.value.getHex()).toBe(0x314252);
        expect(mainPeakUniforms.uFogColorWarm.value.getHex()).toBe(0x91adc2);
        expect(mainPeakUniforms.uSnowLine.value).toBe(0.5);
        expect(mainPeakUniforms.uRimColor.value.getHex()).toBe(0x5f8098);
        expect(mainPeakUniforms.uRimPower.value).toBe(4.8);
        expect(mainPeakUniforms.uBaseMistStrength.value).toBe(0.45);
        expect(mainPeakUniforms.uBaseFadeStart.value).toBe(0.02);
        expect(mainPeakUniforms.uBaseFadeEnd.value).toBe(0.1);
        expect(apronUniforms.uSnowLine.value).toBe(0.7);
        expect(apronUniforms.uBaseMistStrength.value).toBe(0.22);
        expect(apronUniforms.uBaseFadeStart.value).toBe(0.08);
        expect(apronUniforms.uBaseFadeEnd.value).toBe(0.22);

        camera.position.y = environment.userData.yStart;
        updateMountainPeaksEnvironment(environment, 1 / 60, 0, camera, 0.352);
        const earlyTransition = environment.userData.mountainTransitionUniformTargets[0].value;
        const earlyAurora = environment.userData.auroraFadeUniformTargets[0].value;

        camera.position.y = environment.userData.yStart + 80;
        updateMountainPeaksEnvironment(environment, 1 / 60, 0, camera, 0.38);
        const midTransition = environment.userData.mountainTransitionUniformTargets[0].value;
        const midAurora = environment.userData.auroraFadeUniformTargets[0].value;

        camera.position.y = environment.userData.yStart + 220;
        updateMountainPeaksEnvironment(environment, 1 / 60, 0, camera, 0.537);
        const lateTransition = environment.userData.mountainTransitionUniformTargets[0].value;
        const lateAurora = environment.userData.auroraFadeUniformTargets[0].value;

        expect(earlyTransition).toBeLessThan(0.01);
        expect(earlyAurora).toBeGreaterThan(0.99);
        expect(midTransition).toBeGreaterThan(0.5);
        expect(midTransition).toBeLessThan(0.9);
        expect(midAurora).toBeGreaterThan(0.99);
        expect(lateTransition).toBeGreaterThan(0.99);
        expect(lateAurora).toBeGreaterThan(0.99);
        expect(environment.userData.mountains.scale.x).toBeCloseTo(1, 6);
        expect(environment.userData.mountains.position.y).toBeCloseTo(0, 6);
        expect(environment.userData.aurora.scale.x).toBeCloseTo(1, 6);
        expect(environment.userData.aurora.position.y).toBeCloseTo(0, 6);
    });
});

describe('ChapterEnvironmentManager late-game coverage', () => {
    it('registers dedicated board environments for chapters 7 and 8', async () => {
        const scene = new THREE.Scene();
        const manager = new ChapterEnvironmentManager(scene, null);

        const chapter7 = await manager.createChapterEnvironment(7);
        const chapter8 = await manager.createChapterEnvironment(8);

        expect(chapter7?.userData?.chapterId).toBe(7);
        expect(chapter8?.userData?.chapterId).toBe(8);
        expect(manager.environments.has(7)).toBe(true);
        expect(manager.environments.has(8)).toBe(true);
        expect(manager.getBoundaryTransition('3-4').seamWidth).toBe(0.03);
        expect(manager.getBoundaryTransition('4-5').seamWidth).toBe(0.06);
        expect(manager.getBoundaryTransition('3-4').preloadDistance).toBe(0.06);
        expect(manager.getBoundaryTransition('6-7').beatDurationMs).toBe(1100);
        expect(manager.getBoundaryTransition('7-8').fxPreset).toBe('neon');

        manager.dispose();
    });

    it('uses injected chapter positions when resolving blend state', () => {
        const scene = new THREE.Scene();
        const chapterPositions = [0, 0.12, 0.24, 0.36, 0.5, 0.64, 0.78, 0.9, 1];
        const manager = new ChapterEnvironmentManager(scene, null, { chapterPositions });

        const state = manager.getBlendState(0.37);

        expect(state.inSeam).toBe(true);
        expect(state.boundaryId).toBe('3-4');
    });
});

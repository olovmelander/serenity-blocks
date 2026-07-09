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
import {
    MOUNTAIN_SHADING,
    resolveMountainTreatment,
} from '../../src/rendering/odyssey/chapter-environments/shared/mountain-language.js';
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
    it('builds a continuous foothill skirt (ramp) instead of the old flat snow-floor seam', () => {
        const environment = createSurfaceWorldEnvironment();
        const bridge = environment.userData.foothillBridge;
        // WebGPU/TSL: the skirt's uniforms are TSL nodes tagged on userData.odysseyUniforms
        // (NodeMaterials expose no `material.uniforms` map). The canonical mountain language
        // bakes snow/rock/fog into the colorNode, so per-channel colour uniforms no longer
        // exist per-mesh — what we assert is the unified contract: the skirt is present, is a
        // depth-writing ramp, exposes the live snow-blend + opacity drivers, and the old flat
        // snow-floor seam is gone.
        const bridgeUniforms = bridge.userData.odysseyUniforms;

        expect(bridge).toBeTruthy();
        expect(environment.getObjectByName('foothill-bridge')).toBeTruthy();
        expect(environment.getObjectByName('mountain-snow-floor')).toBeFalsy();
        expect(environment.userData.auroraPreview).toBeNull();
        expect(bridgeUniforms.uSnowBlend).toBeTruthy();
        expect(typeof bridgeUniforms.uSnowBlend.value).toBe('number');
        expect(bridgeUniforms.uOpacity).toBeTruthy();
        expect(bridge.material.depthWrite).toBe(true);

        // GATE THE LEAK: the alpine pieces (distant range + skirt) are tracked separately so
        // they can be ramped in only on the Surface→Mountains approach (never in Deep Ocean).
        expect(environment.userData.alpineElements).toContain(bridge);
        expect(environment.userData.alpineOpacityUniformTargets.length).toBeGreaterThan(0);
    });

    it('keeps Chapter 4 grounded before the alpine look fully takes over', () => {
        const environment = createMountainPeaksEnvironment();
        const previewEnvironment = createSurfaceWorldEnvironment();
        const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 4000);
        const apronZ = environment.userData.foothillApron.children.map((mesh) => mesh.position.z);
        const fullAnchors = environment.userData.aurora.children
            .slice(0, 3)
            .map((mesh) => mesh.position.toArray());
        // WebGPU/TSL + ONE mountain language: per-channel colour uniforms are baked into the
        // colorNode from the canonical treatment (shared/mountain-language.js), so meshes no
        // longer expose `material.uniforms.uSnowColor` etc. We assert the unified contract:
        // both the hero peaks and the foothill apron resolve from the SAME palette (heroes on
        // the cool pole, apron pulled toward neutral with a higher snow line), and each mesh
        // still carries the live transition/opacity/snow-blend drivers on userData.tslUniforms.
        const mainPeakUniforms = environment.userData.mainPeaks.userData.parts[0].uniforms;
        const apronUniforms = environment.userData.foothillApron.children[0].userData.tslUniforms;
        const heroTreatment = resolveMountainTreatment({ coolTemp: 1.0 });
        const apronTreatment = resolveMountainTreatment({
            coolTemp: 0.72,
            snowLine: MOUNTAIN_SHADING.snowLineFoothill,
        });

        expect(environment.userData.foothillApron?.children).toHaveLength(3);
        expect(apronZ).toEqual([-600, -860, -710]);
        expect(fullAnchors.length).toBe(3);
        // Hero peaks ride the cool pole; the apron pulls toward neutral grey-blue (its rock is
        // warmer/greyer — higher red channel — than the saturated cool hero rock).
        expect(heroTreatment.snowLine).toBe(MOUNTAIN_SHADING.snowLine);
        expect(apronTreatment.snowLine).toBe(MOUNTAIN_SHADING.snowLineFoothill);
        expect(apronTreatment.snowLine).toBeGreaterThan(heroTreatment.snowLine);
        expect(Math.floor(apronTreatment.rock / 65536) % 256)
            .toBeGreaterThan(Math.floor(heroTreatment.rock / 65536) % 256);
        // Each peak/apron mesh exposes the live drivers (transition + opacity + snow blend).
        expect(mainPeakUniforms.uTransition).toBeTruthy();
        expect(mainPeakUniforms.uOpacity).toBeTruthy();
        expect(mainPeakUniforms.uSnowBlend).toBeTruthy();
        expect(apronUniforms.uTransition).toBeTruthy();
        expect(apronUniforms.uOpacity).toBeTruthy();

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

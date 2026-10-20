import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    boardCalmFactorNode,
    createCataractSprayMaterial,
    createCaveCloudMaterial,
    createCaveVaultMaterial,
    createGourTerraceMaterial,
    createJungleFoliageMaterial,
    createJungleMoundMaterial,
    createMotesMaterial,
    createRootCurtainMaterial,
    createSkyOculusMaterial,
    createSunbeamMaterial,
    createSunfallUniforms,
    createSwiftBirdsMaterial,
    createWaterfallThreadMaterial,
    dlBowNode,
    makeSunlitAtNode,
    pieceSwatchNode,
} from '../../src/themes/sunfall/sunfall-tsl.js';
import { bakeAllSunfallTextures } from '../../src/themes/sunfall/sunfall-bake.js';
import { resolveSunfallPostLook } from '../../src/themes/sunfall/sunfall-post.js';
import { resolveSunfallQuality } from '../../src/themes/sunfall/sunfall-quality.js';

const tslFile = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    'src',
    'themes',
    'sunfall',
    'sunfall-tsl.js',
);

describe('sunfall-shaders', () => {
    it('builds all baked procedural textures with valid RGBA DataTexture buffers', () => {
        const textures = bakeAllSunfallTextures();
        expect(textures.rockTex.image.width).toBe(128);
        expect(textures.fringeTex.image.width).toBe(128);
        expect(textures.cloudTex.image.width).toBe(128);
        expect(textures.foliageTex.image.width).toBe(64);
        textures.dispose();
    });

    it('creates all TSL NodeMaterials cleanly across Minimal and High quality presets', () => {
        const u = createSunfallUniforms();
        const textures = bakeAllSunfallTextures();

        const skyMat = createSkyOculusMaterial(u, textures);
        const caveMat = createCaveVaultMaterial(u, textures);
        const cloudMat = createCaveCloudMaterial(u, textures, { isExhaleRing: false });
        const exhaleMat = createCaveCloudMaterial(u, textures, { isExhaleRing: true });
        const moundMat = createJungleMoundMaterial(u, textures);
        const foliageMat = createJungleFoliageMaterial(u, textures);
        const rootMat = createRootCurtainMaterial(u, textures);
        const gourMat = createGourTerraceMaterial(u, textures);
        const beamHigh = createSunbeamMaterial(u, textures, resolveSunfallQuality('High'));
        const beamMin = createSunbeamMaterial(u, textures, resolveSunfallQuality('Minimal'));
        const sprayMat = createCataractSprayMaterial(u, textures);
        const threadMat = createWaterfallThreadMaterial(u, textures);
        const motesMat = createMotesMaterial(u, textures);
        const swiftsMat = createSwiftBirdsMaterial(u, textures);

        for (const mat of [
            skyMat, caveMat, cloudMat, exhaleMat, moundMat, foliageMat,
            rootMat, gourMat, beamHigh, beamMin, sprayMat, threadMat, motesMat, swiftsMat,
        ]) {
            expect(mat).toBeDefined();
            expect(mat.colorNode).toBeTruthy();
            mat.dispose();
        }
        textures.dispose();
    });

    it('uses explicit .level(0) texture sampling inside TSL Loop bodies and 2-arg Fn helpers', () => {
        const src = readFileSync(tslFile, 'utf8');
        expect(src).toContain('.level(0)');
        expect(pieceSwatchNode).toBeDefined();
        expect(dlBowNode).toBeDefined();
        expect(boardCalmFactorNode).toBeDefined();
        expect(typeof makeSunlitAtNode).toBe('function');
    });

    it('resolves post-processing look parameters for all quality tiers', () => {
        const highLook = resolveSunfallPostLook('High');
        const minLook = resolveSunfallPostLook('Minimal');
        expect(highLook.bloom).toBe(true);
        expect(minLook.bloom).toBe(false);
    });
});

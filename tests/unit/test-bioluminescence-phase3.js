import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { fileURLToPath } from 'url';
import { describe, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.join(__dirname, '..', '..');

const themePath = path.join(root, 'src', 'themes', 'bioluminescence', 'bioluminescence-theme.js');
const materialsPath = path.join(root, 'src', 'themes', 'bioluminescence', 'bioluminescence-materials.js');
const shadersPath = path.join(root, 'src', 'themes', 'bioluminescence', 'bioluminescence-shaders.js');

const themeSource = fs.readFileSync(themePath, 'utf8');
const materialsSource = fs.readFileSync(materialsPath, 'utf8');
const shadersSource = fs.readFileSync(shadersPath, 'utf8');

describe('Bioluminescence Phase 3: TSL Materials and GLSL Extraction', () => {
    it('adds procedural TSL noise helpers and shared material finalizer', () => {
        assert(materialsSource.includes('export const hash21'), 'Missing hash21 helper');
        assert(materialsSource.includes('export const noise2D'), 'Missing noise2D helper');
        assert(materialsSource.includes('export const fbm4'), 'Missing fbm4 helper');
        assert(materialsSource.includes('export const voronoi'), 'Missing voronoi helper');
        assert(materialsSource.includes('export function finalizeNodeMaterial'), 'Missing finalizeNodeMaterial wrapper');
        assert(materialsSource.includes('bloomWeight: meta.bloomWeight ?? 0'), 'Missing normalized bloomWeight metadata');
    });

    it('implements required node material factories with bloom metadata', () => {
        const requiredFactories = [
            'createMushroomCapNodeMaterial',
            'createMushroomStemNodeMaterial',
            'createCrystalNodeMaterial',
            'createCaveRockNodeMaterial',
            'createCaveWallNodeMaterial',
            'createVineNodeMaterial',
            'createWaterSurfaceNodeMaterial',
            'createSporeParticleMaterial',
            'createFireflyParticleMaterial',
            'createBackgroundNodeMaterial',
            'createMyceliumNodeMaterial',
        ];

        requiredFactories.forEach((factory) => {
            assert(materialsSource.includes(`export function ${factory}`), `Missing factory: ${factory}`);
        });

        assert(materialsSource.includes('BLOOM_CLASS_WEIGHTS'), 'Missing bloom class weights table');
        assert(materialsSource.includes('fresnelClampMax: 0.4'), 'Crystal fresnel clamp metadata missing');
        assert(materialsSource.includes('const NORMAL_BLENDING'), 'Missing resolved normal blending constant');
        assert(materialsSource.includes('blending: NORMAL_BLENDING'), 'Crystals should avoid additive blending');
    });

    it('extracts legacy GLSL shaders into dedicated shader module', () => {
        const shaderExports = [
            'mushroomCapVertexShader',
            'mushroomCapFragmentShader',
            'crystalVertexShader',
            'crystalFragmentShader',
            'terrainVertexShader',
            'terrainFragmentShader',
            'sporeVertexShader',
            'sporeFragmentShader',
            'contactRippleVertexShader',
            'contactRippleFragmentShader',
            'shoreVertexShader',
            'shoreFragmentShader',
            'vignetteShader',
            'colorGradeShader',
        ];

        shaderExports.forEach((name) => {
            assert(shadersSource.includes(`export const ${name}`), `Missing shader export: ${name}`);
        });

        assert(!themeSource.includes('const CrystalShader = {'), 'Crystal GLSL should no longer be inline in theme');
        assert(!themeSource.includes('const SporeShader = {'), 'Spore GLSL should no longer be inline in theme');
        assert(!themeSource.includes('const ShoreShader = {'), 'Shore GLSL should no longer be inline in theme');
    });

    it('wires theme material creation to WebGPU node path and WebGL fallback path', () => {
        assert(themeSource.includes('createWebGLFallbackMaterials()'), 'Theme should initialize webgl fallback material factory');
        assert(themeSource.includes('createMushroomCapNodeMaterial'), 'Theme should consume mushroom cap node factory');
        assert(themeSource.includes('this.webglFallbackMaterials.createMushroomCapMaterial'), 'Theme should consume mushroom cap GLSL fallback');
        assert(themeSource.includes('createCrystalNodeMaterial'), 'Theme should consume crystal node factory');
        assert(themeSource.includes('this.webglFallbackMaterials.createCrystalMaterial'), 'Theme should consume crystal GLSL fallback');
        assert(themeSource.includes('createSporeParticleMaterial(this.isWebGPU'), 'Theme should use hybrid spore factory');
        assert(themeSource.includes('createCaveRockNodeMaterial'), 'Theme should use cave rock node material on WebGPU');
        assert(themeSource.includes('createWaterSurfaceNodeMaterial'), 'Theme should use water node material on WebGPU');
        assert(themeSource.includes('vignetteShader as VignetteShader'), 'Theme should import extracted vignette shader');
        assert(themeSource.includes('colorGradeShader as ColorGradeShader'), 'Theme should import extracted color-grade shader');
    });
});

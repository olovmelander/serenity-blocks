import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { fileURLToPath } from 'url';
import { describe, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.join(__dirname, '..', '..');

const themePath = path.join(root, 'src', 'themes', 'bioluminescence', 'bioluminescence-theme.js');
const postPath = path.join(root, 'src', 'themes', 'bioluminescence', 'bioluminescence-post.js');

const themeSource = fs.readFileSync(themePath, 'utf8');
const postSource = fs.readFileSync(postPath, 'utf8');

describe('Bioluminescence Phase 2: Render Path and Post Stack', () => {
    it('adds dedicated WebGPU post module with MRT-aware bloom chain', () => {
        assert(postSource.includes('export class BioluminescencePost'), 'Missing BioluminescencePost class export');
        assert(postSource.includes("this.scenePass = pass(scene, camera);"), 'Missing scene pass initialization');
        assert(postSource.includes('this.scenePass.setMRT(mrt({ output, emissive }));'), 'Missing MRT setup in post module');
        assert(postSource.includes('this.bloomNode = bloom('), 'Missing bloom node setup');
        assert(
            postSource.includes('this.postProcessing.outputNode = vec4(dithered, baseSample.a);')
            || postSource.includes('this.postProcessing.outputNode = vec4(dithered, combined.a);'),
            'Missing output node assignment',
        );
    });

    it('wires MRT patching fail-safe and audit hooks in theme', () => {
        assert(themeSource.includes('isNodeMaterial(material)'), 'Missing isNodeMaterial helper');
        assert(themeSource.includes('ensureMrtMaterials()'), 'Missing ensureMrtMaterials helper');
        assert(themeSource.includes("this.recordDowngrade('mrt-disabled-non-node-materials'"), 'Missing MRT downgrade fail-safe log');
        assert(themeSource.includes("console.log('[Bioluminescence] MRT audit:'"), 'Missing MRT audit log path');
    });

    it('routes render stack through WebGPU post or WebGL composer fallback', () => {
        assert(themeSource.includes('this.postProcessing = new BioluminescencePost('), 'Missing WebGPU post stack construction');
        assert(themeSource.includes('const vignettePass = new ShaderPass(VignetteShader);'), 'Missing WebGL vignette pass');
        assert(themeSource.includes('const gradePass = new ShaderPass(ColorGradeShader);'), 'Missing WebGL color grade pass');
        assert(themeSource.includes('webgpu-post-mrt'), 'Missing WebGPU MRT render path tracking');
        assert(themeSource.includes("this.renderPath = 'webgl-composer';"), 'Missing WebGL composer render path tracking');
    });

    it('patches MRT before building post stack during scene creation', () => {
        const ensureIndex = themeSource.indexOf('this.ensureMrtMaterials();');
        const postIndex = themeSource.indexOf('this.setupPostProcessing();');
        assert(ensureIndex >= 0, 'Missing ensureMrtMaterials call in createScene');
        assert(postIndex >= 0, 'Missing setupPostProcessing call in createScene');
        assert(ensureIndex < postIndex, 'MRT patching should happen before post stack setup');
    });
});

import { readFileSync } from 'node:fs';
import * as THREE from 'three/webgpu';
import {
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import {
    STILLWATER_ATMOSPHERE_MAX_MOTES,
    createStillwaterAtmosphere,
} from '../../src/themes/stillwater/rendering/stillwater-atmosphere.js';
import {
    createStillwaterGradeLut,
    getStillwaterPostConfig,
} from '../../src/themes/stillwater/post/stillwater-pipeline.js';

const atmosphereSource = readFileSync(
    new URL('../../src/themes/stillwater/rendering/stillwater-atmosphere.js', import.meta.url),
    'utf8',
);
const pipelineSource = readFileSync(
    new URL('../../src/themes/stillwater/post/stillwater-pipeline.js', import.meta.url),
    'utf8',
);
const atmosphereEffectSource = readFileSync(
    new URL('../../src/playground/effects/stillwater-atmosphere.effect.js', import.meta.url),
    'utf8',
);
const postEffectSource = readFileSync(
    new URL('../../src/playground/effects/stillwater-post.effect.js', import.meta.url),
    'utf8',
);

function findReversedNumericSmoothsteps(source) {
    return [...source.matchAll(
        /smoothstep\(\s*(-?(?:\d+(?:\.\d*)?|\.\d+))\s*,\s*(-?(?:\d+(?:\.\d*)?|\.\d+))/g,
    )]
        .filter((match) => Number(match[1]) > Number(match[2]))
        .map((match) => match[0]);
}

describe('Stillwater Wave 6 atmosphere and post contracts', () => {
    it('uses analytic mist on non-bloom tiers and reserves fractal mist for bloom tiers', () => {
        expect(atmosphereSource).toContain("premiumMist ? 'materialx-fractal' : 'analytic-bands'");
        expect(atmosphereSource).toContain('if (premiumMist)');
        expect(atmosphereSource).toContain('const broadBand = sin(');
    });

    it('structurally removes MRT, bloom, and LUT work from Low', () => {
        expect(getStillwaterPostConfig({ quality: 'Low' })).toMatchObject({
            quality: 'Low',
            useMRT: false,
            useBloom: false,
            useLut: false,
            lutSize: 0,
            analyticGrade: true,
        });
        expect(getStillwaterPostConfig({ quality: 'High' })).toMatchObject({
            quality: 'High',
            useMRT: true,
            useBloom: true,
            useLut: true,
            lutSize: 16,
            bloomScale: 0.45,
        });
        expect(getStillwaterPostConfig({
            quality: 'High',
            bloomEnabled: false,
        })).toMatchObject({
            useMRT: false,
            useBloom: false,
            useLut: true,
        });
        expect(getStillwaterPostConfig({
            quality: 'High',
            gradeMode: 'aces',
        })).toMatchObject({
            gradeMode: 'aces',
            useLut: false,
            lutSize: 0,
            analyticGrade: false,
        });
    });

    it('keeps one fixed mote buffer stable and restores fog ownership', () => {
        const scene = new THREE.Scene();
        const previousFogNode = { owner: 'previous-effect' };
        scene.fogNode = previousFogNode;
        const atmosphere = createStillwaterAtmosphere({
            scene,
            quality: 'Low',
            seed: 61937,
        });
        const before = atmosphere.getResourceState();

        expect(atmosphere.getDiagnostics()).toMatchObject({
            quality: 'Low',
            activeMotes: 90,
            moteCapacity: 90,
            moteDraws: 1,
            mistLayerCount: 0,
            softParticles: true,
            trueViewportDepthFade: true,
            perFrameAllocations: 0,
        });
        expect(atmosphere.motes).toBeInstanceOf(THREE.InstancedMesh);
        expect(atmosphere.motes.count).toBe(90);
        expect(atmosphere.motes.instanceMatrix.count).toBe(
            90,
        );
        expect(
            atmosphere.motes.geometry.getAttribute('aMotePositionPhase'),
        ).toMatchObject({
            itemSize: 4,
            count: 90,
            meshPerAttribute: 1,
        });
        expect(
            atmosphere.motes.geometry.getAttribute('aMoteStyle'),
        ).toMatchObject({
            itemSize: 4,
            count: 90,
            meshPerAttribute: 1,
        });
        expect(before.rootChildren).toBe(1);

        for (let frame = 0; frame < 48; frame += 1) {
            atmosphere.update(frame / 12);
        }
        const after = atmosphere.getResourceState();
        expect(after.motePositionArray).toBe(before.motePositionArray);
        expect(after.motePhaseArray).toBe(before.motePhaseArray);
        expect(after.moteSizeArray).toBe(before.moteSizeArray);
        expect(after.motePositionArray).toHaveLength(
            90 * 3,
        );
        expect(after.activeMotes).toBe(90);
        atmosphere.setReducedMotion(true);
        expect(atmosphere.getDiagnostics().reducedMotion).toBe(true);
        atmosphere.setReducedMotion(false);
        expect(atmosphere.getDiagnostics().reducedMotion).toBe(false);

        const geometryDispose = vi.spyOn(atmosphere.motes.geometry, 'dispose');
        atmosphere.dispose();
        atmosphere.dispose();
        expect(geometryDispose).toHaveBeenCalledTimes(1);
        expect(scene.fogNode).toBe(previousFogNode);
        expect(atmosphere.root.parent).toBeNull();
    });

    it('constructs only the profile-owned bounded mist layers', () => {
        const highScene = new THREE.Scene();
        const high = createStillwaterAtmosphere({
            scene: highScene,
            quality: 'High',
            softParticles: false,
        });
        expect(high.getDiagnostics()).toMatchObject({
            activeMotes: 280,
            moteCapacity: 280,
            mistLayerCount: 1,
            mistDraws: 1,
            softParticles: false,
            trueViewportDepthFade: false,
        });
        expect(high.mistLayers).toHaveLength(1);
        expect(high.getResourceState()).toMatchObject({
            geometries: 2,
            materials: 2,
            rootChildren: 2,
        });
        high.dispose();

        const extremeScene = new THREE.Scene();
        const extreme = createStillwaterAtmosphere({
            scene: extremeScene,
            quality: 'Extreme',
        });
        expect(extreme.getDiagnostics()).toMatchObject({
            activeMotes: 700,
            moteCapacity: STILLWATER_ATMOSPHERE_MAX_MOTES,
            mistLayerCount: 2,
            mistDraws: 2,
        });
        expect(extreme.mistLayers).toHaveLength(2);
        extreme.dispose();
    });

    it('builds a deterministic compact 16-cubed grade LUT', () => {
        const first = createStillwaterGradeLut(16);
        const second = createStillwaterGradeLut(16);

        expect(first).toBeInstanceOf(THREE.Data3DTexture);
        expect(first.image).toMatchObject({
            width: 16,
            height: 16,
            depth: 16,
        });
        expect(first.image.data).toHaveLength(16 * 16 * 16 * 4);
        expect([...first.image.data]).toEqual([...second.image.data]);
        expect(new Set(first.image.data).size).toBeGreaterThan(32);
        expect(first.minFilter).toBe(THREE.LinearFilter);
        expect(first.magFilter).toBe(THREE.LinearFilter);

        first.dispose();
        second.dispose();
    });

    it('keeps atmosphere TSL-only, bounded, depth-aware, and allocation-free per frame', () => {
        expect(atmosphereSource).toContain("from 'three/webgpu'");
        expect(atmosphereSource).toContain("from 'three/tsl'");
        expect(atmosphereSource).toContain(// Wave 6 replaced the range-fog approximation with height-integrated
        // exponential fog (Quilez), which is what makes fog POOL in the valley
        // rather than hang as a uniform veil.
            'const integrated =',
        );
        expect(atmosphereSource).toContain('positionWorld.y');
        expect(atmosphereSource).toContain(
            'class StillwaterViewportDepthTextureNode extends THREE.ViewportDepthTextureNode',
        );
        expect(atmosphereSource).toContain(
            "softParticleDepthTexture.name = 'stillwater-soft-particle-depth'",
        );
        expect(atmosphereSource).toContain(
            'const separation = viewportDepth.sub(linearDepth()).max(0)',
        );
        expect(atmosphereSource).not.toMatch(/\bviewportLinearDepth\s*,/);
        expect(atmosphereSource).toContain("'aMotePositionPhase'");
        expect(atmosphereSource).toContain("'aMoteStyle'");
        expect(atmosphereSource).toContain(
            'new THREE.InstancedBufferAttribute(packedPositionPhase, 4)',
        );
        expect(atmosphereSource).toContain(
            'new THREE.InstancedBufferAttribute(packedStyle, 4)',
        );
        expect(atmosphereSource.match(/new THREE\.InstancedMesh\(/g)).toHaveLength(1);
        expect(atmosphereSource).toContain('motes.count = activeMotes');
        expect(atmosphereSource).not.toContain('geometry.setDrawRange(');
        expect(atmosphereSource).not.toMatch(/new THREE\.Points\(/);
        expect(atmosphereSource).not.toMatch(
            /THREE\.ShaderMaterial\b|\b(?:glslFn|wgslFn)\s*\(/,
        );
        const updateBody = atmosphereSource.match(
            /update\(time\)\s*\{([\s\S]*?)\n\s*\},\n\s*setReducedMotion/,
        )?.[1] || '';
        expect(updateBody).not.toMatch(/\bnew\b|\.push\(|\.splice\(/);
        expect(findReversedNumericSmoothsteps(atmosphereSource)).toEqual([]);
    });

    it('owns a single-transform MRT post graph and deep-disposes bloom and LUT resources', () => {
        expect(pipelineSource).toContain('new THREE.PostProcessing(renderer)');
        expect(pipelineSource).not.toContain('THREE.RenderPipeline');
        expect(pipelineSource).toContain(
            'this.scenePass.setMRT(mrt({ output, emissive }))',
        );
        expect(pipelineSource).toContain('this.scenePass.getTextureNode(\'emissive\')');
        expect(pipelineSource).toContain('this.bloomNode = bloom(');
        expect(pipelineSource).toContain('createStillwaterGradeLut(this.config.lutSize)');
        expect(pipelineSource).toContain('lut3D(');
        expect(pipelineSource).toContain('this.postProcessing.outputColorTransform = false');
        expect(pipelineSource).toContain('renderOutput(');
        expect(pipelineSource).toContain('THREE.NoToneMapping');
        expect(pipelineSource).toContain('const edgeDistanceSquared = dot(');
        expect(pipelineSource).toContain('const ditherNoise = hash(');
        expect(pipelineSource).not.toContain('const edgeDistance = length(');
        expect(pipelineSource).toContain('disposeBloomNodeDeep(this.bloomNode)');
        expect(pipelineSource).toContain('this.lutTexture?.dispose?.()');
        expect(pipelineSource).not.toMatch(
            /THREE\.ShaderMaterial\b|\b(?:glslFn|wgslFn)\s*\(/,
        );
        expect(findReversedNumericSmoothsteps(pipelineSource)).toEqual([]);
    });

    it('keeps the two Wave 6 pilots separate and exposes their verification controls', () => {
        expect(atmosphereEffectSource).toContain("id: 'stillwater-atmosphere'");
        expect(atmosphereEffectSource).toContain('createStillwaterAtmosphere({');
        expect(atmosphereEffectSource).toContain("params?.get?.('quality')");
        expect(atmosphereEffectSource).toContain("readToggle(params, 'soft', true)");
        expect(atmosphereEffectSource).toContain(
            'window.__STILLWATER_ATMOSPHERE__ = debugApi',
        );

        expect(postEffectSource).toContain("id: 'stillwater-post'");
        expect(postEffectSource).toContain('new StillwaterPipeline(');
        expect(postEffectSource).toContain("readToggle(params, 'bloom', true)");
        expect(postEffectSource).toContain("params?.get?.('grade')");
        expect(postEffectSource).toContain(
            "'stillwater-post-bright-nonemissive-negative-control'",
        );
        expect(postEffectSource).toContain('renderAsync: () => pipeline.renderAsync()');
        expect(postEffectSource).toContain('window.__STILLWATER_POST__ = debugApi');

        for (const source of [atmosphereEffectSource, postEffectSource]) {
            expect(source).toContain("from 'three/webgpu'");
            expect(source).toContain("from 'three/tsl'");
            expect(source).not.toMatch(
                /THREE\.ShaderMaterial\b|\b(?:glslFn|wgslFn)\s*\(/,
            );
            expect(findReversedNumericSmoothsteps(source)).toEqual([]);
        }
    });
});

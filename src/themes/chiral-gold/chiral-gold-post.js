/**
 * Chiral Gold - WebGPU post processing
 */

import * as THREE from 'three/webgpu';
import {
    clamp,
    dot,
    emissive,
    float,
    fract,
    length,
    max,
    mix,
    mrt,
    output,
    pass,
    sin,
    uniform,
    vec2,
    vec3,
    vec4,
    viewportUV,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { chromaticAberration } from 'three/addons/tsl/display/ChromaticAberrationNode.js';
import { disposeBloomNodeDeep } from '../shared/bloom-dispose.js';

export class ChiralGoldPost {
    constructor(renderer, scene, camera, params = {}) {
        this.renderer = renderer;
        this.useMRT = params.useMRT ?? true;
        this.size = { width: 0, height: 0 };

        this.postProcessing = new THREE.PostProcessing(renderer);
        this.scenePass = pass(scene, camera);
        if (this.useMRT) {
            this.scenePass.setMRT(mrt({ output, emissive }));
        }

        const sceneColor = this.scenePass.getTextureNode('output');
        const bloomSource = this.useMRT ? this.scenePass.getTextureNode('emissive') : sceneColor;

        this.bloomNode = bloom(
            bloomSource,
            params.bloomStrength ?? 0.55,
            params.bloomRadius ?? 0.4,
            params.bloomThreshold ?? 0.0,
        );

        this.uBloomBoost = uniform(params.bloomBoost ?? 0);
        this.uChromaticStrength = uniform(params.chromaticStrength ?? 0.003);
        this.uVignetteDarkness = uniform(params.vignetteDarkness ?? 0.9);
        this.uVignetteOffset = uniform(params.vignetteOffset ?? 1.1);
        this.uExposure = uniform(params.exposure ?? 1.0);
        this.uContrast = uniform(params.contrast ?? 1.1);
        this.uSaturation = uniform(params.saturation ?? 0.85);
        this.uBlackFloor = uniform(params.blackFloor ?? 0.08);
        this.uFilmGrain = uniform(params.filmGrain ?? 0.015);
        this.uDitherStrength = uniform(params.ditherStrength ?? 0.0035);
        this.uWarmTint = uniform(params.warmTint ?? new THREE.Color(1.0, 0.95, 0.85));
        this.uTime = uniform(0);

        const uv = viewportUV;

        const vigDist = length(uv.sub(0.5).mul(2.0));
        const vig = clamp(
            smoothstep(this.uVignetteOffset, this.uVignetteOffset.sub(0.7), vigDist),
            0.0,
            1.0,
        );

        const baseSample = sceneColor.sample(uv);
        const vignetted = mix(baseSample.mul(float(1.0).sub(this.uVignetteDarkness)), baseSample, vig);

        const chroma = chromaticAberration(vignetted, this.uChromaticStrength, vec2(0.5, 0.5), 1.1);

        const bloomTint = this.uWarmTint.mul(float(0.9).add(this.uBloomBoost.mul(0.35)));
        const combined = chroma.add(this.bloomNode.mul(vec4(bloomTint, 1.0)));

        const exposed = combined.rgb.mul(this.uExposure);

        const acesA = float(2.51);
        const acesB = float(0.03);
        const acesC = float(2.43);
        const acesD = float(0.59);
        const acesE = float(0.14);

        const acesNum = exposed.mul(exposed.mul(acesA).add(acesB));
        const acesDen = exposed.mul(exposed.mul(acesC).add(acesD)).add(acesE);
        let graded = clamp(acesNum.div(acesDen), 0.0, 1.0);

        const luma = dot(graded, vec3(0.2126, 0.7152, 0.0722));
        graded = mix(vec3(luma), graded, this.uSaturation);
        graded = graded.sub(0.5).mul(this.uContrast).add(0.5);

        const blackScale = max(float(0.0001), float(1.0).sub(this.uBlackFloor));
        graded = clamp(graded.sub(this.uBlackFloor).div(blackScale), 0.0, 1.0);

        const grain = fract(sin(dot(uv.add(this.uTime.mul(0.01)), vec2(12.9898, 78.233))).mul(43758.5453));
        graded = clamp(graded.add(grain.sub(0.5).mul(this.uFilmGrain)), 0.0, 1.0);

        const dither = fract(sin(dot(uv, vec2(127.1, 311.7))).mul(43758.5453));
        graded = clamp(graded.add(dither.sub(0.5).mul(this.uDitherStrength)), 0.0, 1.0);

        this.postProcessing.outputNode = vec4(graded, 1.0);
        this.postProcessing.needsUpdate = true;
    }

    update(params = {}) {
        if (params.time !== undefined) {
            this.uTime.value = params.time;
        }
        if (params.bloomStrength !== undefined && this.bloomNode?.strength) {
            this.bloomNode.strength.value = params.bloomStrength;
        }
        if (params.bloomRadius !== undefined && this.bloomNode?.radius) {
            this.bloomNode.radius.value = params.bloomRadius;
        }
        if (params.bloomThreshold !== undefined && this.bloomNode?.threshold) {
            this.bloomNode.threshold.value = params.bloomThreshold;
        }
        if (params.bloomBoost !== undefined) {
            this.uBloomBoost.value = params.bloomBoost;
        }
        if (params.chromaticStrength !== undefined) {
            this.uChromaticStrength.value = params.chromaticStrength;
        }
        if (params.vignetteDarkness !== undefined) {
            this.uVignetteDarkness.value = params.vignetteDarkness;
        }
        if (params.vignetteOffset !== undefined) {
            this.uVignetteOffset.value = params.vignetteOffset;
        }
        if (params.filmGrain !== undefined) {
            this.uFilmGrain.value = params.filmGrain;
        }
    }

    render() {
        this.postProcessing.render();
    }

    setSize(width, height) {
        this.size.width = width;
        this.size.height = height;
        this.scenePass.setSize(width, height);
        if (this.bloomNode?._separableBlurMaterials?.length) {
            this.bloomNode.setSize(width, height);
        }
    }

    dispose() {
        this.scenePass?.dispose?.();
        disposeBloomNodeDeep(this.bloomNode);
        this.postProcessing?.dispose?.();
    }
}

function smoothstep(edge0, edge1, x) {
    const t = clamp(x.sub(edge0).div(edge1.sub(edge0)), 0.0, 1.0);
    return t.mul(t).mul(float(3.0).sub(t.mul(2.0)));
}

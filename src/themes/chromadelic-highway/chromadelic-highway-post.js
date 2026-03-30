/**
 * Chromadelic Highway - WebGPU Post Processing
 * Emissive-only bloom + chromatic aberration + vignette + ACES tonemap (WebGPU path)
 */

import * as THREE from 'three/webgpu';
import {
    emissive,
    mrt,
    output,
    pass,
    viewportUV,
    uniform,
    clamp,
    float,
    length,
    mix,
    smoothstep,
    vec2,
    vec3,
    dot,
    fract,
    sin,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { chromaticAberration } from 'three/addons/tsl/display/ChromaticAberrationNode.js';

export class ChromadelicHighwayPost {
    constructor(renderer, scene, camera, params = {}) {
        this.renderer = renderer;
        this.useMRT = params.useMRT ?? true;
        this.bloomDownsample = params.bloomDownsample ?? 0.8;
        this.postProcessing = new THREE.PostProcessing(renderer);

        this.scenePass = pass(scene, camera);
        if (this.useMRT) {
            this.scenePass.setMRT(mrt({ output, emissive }));
        }

        const sceneColor = this.scenePass.getTextureNode('output');
        const bloomSource = this.useMRT ? this.scenePass.getTextureNode('emissive') : sceneColor;

        // Bloom - stronger for psychedelic neon glow
        const bloomStrength = params.bloomStrength ?? 0.5;
        const bloomRadius = params.bloomRadius ?? 0.3;
        const bloomThreshold = params.bloomThreshold ?? 0.2;
        this.bloomNode = bloom(bloomSource, bloomStrength, bloomRadius, bloomThreshold);

        // Downsample bloom for performance
        const originalBloomSetSize = this.bloomNode.setSize.bind(this.bloomNode);
        this.bloomNode.setSize = (width, height) => {
            originalBloomSetSize(width * this.bloomDownsample, height * this.bloomDownsample);
        };

        // Uniforms for dynamic control
        this.uChromaticStrength = uniform(params.chromaticStrength ?? 0.0015);
        this.uVignetteOffset = uniform(params.vignetteOffset ?? 1.0);
        this.uVignetteDarkness = uniform(params.vignetteDarkness ?? 0.5);
        this.uExposure = uniform(params.exposure ?? 1.1);
        this.uContrast = uniform(params.contrast ?? 1.06);
        this.uSaturation = uniform(params.saturation ?? 1.15);
        this.uTintStrength = uniform(params.tintStrength ?? 0.15);
        this.uDitherStrength = uniform(params.ditherStrength ?? 0.00055);
        // Slight purple/magenta tint for psychedelic feel
        this.uTint = uniform(new THREE.Color(1.06, 0.96, 1.1));

        // Build post-processing pipeline
        const uvNode = viewportUV;
        const centered = uvNode.sub(0.5).mul(2.0);
        const dist = length(centered);

        // Vignette
        const vignette = smoothstep(this.uVignetteOffset, this.uVignetteOffset.sub(0.5), dist);
        const baseSample = sceneColor.sample(uvNode);
        const vignetteColor = mix(
            baseSample.mul(float(1.0).sub(this.uVignetteDarkness)),
            baseSample,
            vignette,
        );

        // Chromatic aberration
        const chroma = chromaticAberration(vignetteColor, this.uChromaticStrength, vec2(0.5, 0.5), 1.1);

        // Combine with bloom
        const combined = chroma.add(this.bloomNode);

        // ACES Filmic Tone Mapping
        const exposed = combined.mul(this.uExposure);
        const acesA = float(2.51);
        const acesB = float(0.03);
        const acesC = float(2.43);
        const acesD = float(0.59);
        const acesE = float(0.14);
        const acesNum = exposed.mul(exposed.mul(acesA).add(acesB));
        const acesDen = exposed.mul(exposed.mul(acesC).add(acesD)).add(acesE);
        let graded = clamp(acesNum.div(acesDen), float(0.0), float(1.0));

        // Color grading: saturation, contrast, tint
        const luma = dot(graded, vec3(0.2126, 0.7152, 0.0722));
        graded = mix(vec3(luma), graded, this.uSaturation);
        graded = graded.sub(0.5).mul(this.uContrast).add(0.5);
        graded = mix(graded, graded.mul(this.uTint), this.uTintStrength);

        // Dither to prevent banding
        const noise = fract(sin(dot(uvNode, vec2(12.9898, 78.233))).mul(43758.5453));
        const dither = noise.sub(0.5).mul(this.uDitherStrength);
        graded = clamp(graded.add(dither), float(0.0), float(1.0));

        this.postProcessing.outputNode = graded;
        this.postProcessing.needsUpdate = true;
        this.size = { width: 0, height: 0 };
    }

    update(params = {}) {
        if (params.bloomStrength !== undefined && this.bloomNode.strength) {
            this.bloomNode.strength.value = params.bloomStrength;
        }
        if (params.chromaticStrength !== undefined) {
            this.uChromaticStrength.value = params.chromaticStrength;
        }
        if (params.vignetteOffset !== undefined) {
            this.uVignetteOffset.value = params.vignetteOffset;
        }
        if (params.vignetteDarkness !== undefined) {
            this.uVignetteDarkness.value = params.vignetteDarkness;
        }
        if (params.exposure !== undefined) {
            this.uExposure.value = params.exposure;
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
        this.scenePass.dispose();
        this.bloomNode.dispose();
        this.postProcessing.dispose();
    }
}

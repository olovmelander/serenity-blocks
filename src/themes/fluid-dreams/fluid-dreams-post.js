/**
 * Fluid Dreams Theme - WebGPU Post Processing
 *
 * MRT emissive bloom + chromatic aberration + vibrant vignette + ACES.
 * Heavy bloom radius for that hazy "neon dream" halo around the hero fluid.
 */

import * as THREE from 'three/webgpu';
import {
    clamp,
    dot,
    emissive,
    float,
    length,
    mix,
    mrt,
    mx_noise_float,
    output,
    pass,
    smoothstep,
    uniform,
    vec2,
    vec3,
    viewportUV,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { chromaticAberration } from 'three/addons/tsl/display/ChromaticAberrationNode.js';
import { disposeBloomNodeDeep } from '../shared/bloom-dispose.js';
import { withEmissiveMaterialBlending } from '../shared/mrt-blend.js';

export class FluidDreamsPost {
    constructor(renderer, scene, camera, params = {}) {
        this.renderer = renderer;
        this.useMRT = params.useMRT ?? true;
        this.bloomDownsample = params.bloomDownsample ?? 0.65;
        this.postProcessing = new THREE.RenderPipeline(renderer);

        this.scenePass = pass(scene, camera);
        if (this.useMRT) {
            this.scenePass.setMRT(withEmissiveMaterialBlending(mrt({ output, emissive })));
        }

        const sceneColor = this.scenePass.getTextureNode('output');
        const bloomSource = this.useMRT ? this.scenePass.getTextureNode('emissive') : sceneColor;

        const bloomStrength = params.bloomStrength ?? 0.7;
        const bloomRadius = params.bloomRadius ?? 0.95;
        const bloomThreshold = params.bloomThreshold ?? 0.18;
        this.bloomNode = bloom(bloomSource, bloomStrength, bloomRadius, bloomThreshold);

        // Downsample bloom RTT to save bandwidth without losing the dreamy halo.
        const originalBloomSetSize = this.bloomNode.setSize.bind(this.bloomNode);
        this.bloomNode.setSize = (width, height) => {
            originalBloomSetSize(width * this.bloomDownsample, height * this.bloomDownsample);
        };

        this.uChromaticStrength = uniform(params.chromaticStrength ?? 0.0022);
        this.uVignetteOffset = uniform(params.vignetteOffset ?? 1.1);
        this.uVignetteDarkness = uniform(params.vignetteDarkness ?? 0.55);
        this.uExposure = uniform(params.exposure ?? 1.18);
        this.uContrast = uniform(params.contrast ?? 1.08);
        this.uSaturation = uniform(params.saturation ?? 1.18);
        this.uTintStrength = uniform(params.tintStrength ?? 0.18);
        this.uGrainStrength = uniform(params.grainStrength ?? 0.018);
        this.uTime = uniform(0);
        this.uTint = uniform(new THREE.Color(1.05, 0.96, 1.12));

        const uv = viewportUV;
        const centered = uv.sub(0.5).mul(2.0);
        const dist = length(centered);
        const vignette = smoothstep(this.uVignetteOffset, this.uVignetteOffset.sub(0.7), dist);
        const baseSample = sceneColor.sample(uv);

        const vignetteColor = mix(
            baseSample.mul(float(1.0).sub(this.uVignetteDarkness)),
            baseSample,
            vignette,
        );

        const chroma = chromaticAberration(vignetteColor, this.uChromaticStrength, vec2(0.5, 0.5), 1.2);
        const combined = chroma.add(this.bloomNode);

        const exposed = combined.mul(this.uExposure);

        // ACES filmic tonemap.
        const acesA = float(2.51);
        const acesB = float(0.03);
        const acesC = float(2.43);
        const acesD = float(0.59);
        const acesE = float(0.14);
        const acesNum = exposed.mul(exposed.mul(acesA).add(acesB));
        const acesDen = exposed.mul(exposed.mul(acesC).add(acesD)).add(acesE);
        let graded = clamp(acesNum.div(acesDen), float(0.0), float(1.0));

        // Saturation, contrast, magenta-violet tint to push the neon feel.
        const luma = dot(graded, vec3(0.2126, 0.7152, 0.0722));
        graded = mix(vec3(luma), graded, this.uSaturation);
        graded = graded.sub(0.5).mul(this.uContrast).add(0.5);
        graded = mix(graded, graded.mul(this.uTint), this.uTintStrength);

        // Subtle animated grain — breaks banding in the hero fluid.
        const grainCoord = vec3(uv.x.mul(220.0), uv.y.mul(220.0), this.uTime.mul(13.0));
        const grain = mx_noise_float(grainCoord).mul(this.uGrainStrength);
        graded = graded.add(vec3(grain, grain, grain));

        this.postProcessing.outputNode = clamp(graded, float(0.0), float(1.0));
        this.postProcessing.needsUpdate = true;
        this.size = { width: 0, height: 0 };
    }

    update(params = {}) {
        if (params.time !== undefined) this.uTime.value = params.time;
        if (params.bloomStrength !== undefined) this.bloomNode.strength.value = params.bloomStrength;
        if (params.bloomRadius !== undefined) this.bloomNode.radius.value = params.bloomRadius;
        if (params.bloomThreshold !== undefined) this.bloomNode.threshold.value = params.bloomThreshold;
        if (params.chromaticStrength !== undefined) this.uChromaticStrength.value = params.chromaticStrength;
        if (params.vignetteOffset !== undefined) this.uVignetteOffset.value = params.vignetteOffset;
        if (params.vignetteDarkness !== undefined) this.uVignetteDarkness.value = params.vignetteDarkness;
        if (params.exposure !== undefined) this.uExposure.value = params.exposure;
        if (params.contrast !== undefined) this.uContrast.value = params.contrast;
        if (params.saturation !== undefined) this.uSaturation.value = params.saturation;
        if (params.tintStrength !== undefined) this.uTintStrength.value = params.tintStrength;
        if (params.grainStrength !== undefined) this.uGrainStrength.value = params.grainStrength;
        if (params.bloomDownsample !== undefined) {
            this.bloomDownsample = params.bloomDownsample;
            if (this.size.width > 0 && this.size.height > 0 && this.bloomNode?._separableBlurMaterials?.length) {
                this.bloomNode.setSize(this.size.width, this.size.height);
            }
        }
    }

    render() {
        return this.postProcessing.render();
    }

    // Promise-returning alias kept for callers that await a render. The renderer is
    // init-awaited by the theme before this post is constructed, so the deprecated
    // RenderPipeline.renderAsync() (warnOnce + await init + render) is not needed.
    renderAsync() {
        return Promise.resolve(this.postProcessing.render());
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
        disposeBloomNodeDeep(this.bloomNode);
        this.postProcessing.dispose();
    }
}

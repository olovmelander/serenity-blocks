/**
 * Black Hole Theme - WebGPU Post Processing
 * Emissive-only bloom + chromatic aberration + vignette (WebGPU path)
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

export class BlackHolePost {
    constructor(renderer, scene, camera, params = {}) {
        this.renderer = renderer;
        this.useMRT = params.useMRT ?? true;
        this.bloomDownsample = params.bloomDownsample ?? 0.8;
        this.enableChromatic = params.enableChromatic ?? true;
        this.postProcessing = new THREE.PostProcessing(renderer);

        this.scenePass = pass(scene, camera);
        if (this.useMRT) {
            this.scenePass.setMRT(mrt({ output, emissive }));
        }

        const sceneColor = this.scenePass.getTextureNode('output');
        const bloomSource = this.useMRT ? this.scenePass.getTextureNode('emissive') : sceneColor;

        const bloomStrength = params.bloomStrength ?? 0.5;
        const bloomRadius = params.bloomRadius ?? 0.6;
        const bloomThreshold = params.bloomThreshold ?? 0.15;
        this.bloomNode = bloom(bloomSource, bloomStrength, bloomRadius, bloomThreshold);

        const originalBloomSetSize = this.bloomNode.setSize.bind(this.bloomNode);
        this.bloomNode.setSize = (width, height) => {
            originalBloomSetSize(
                Math.max(1, Math.floor(width * this.bloomDownsample)),
                Math.max(1, Math.floor(height * this.bloomDownsample)),
            );
        };

        this.uChromaticStrength = uniform(params.chromaticStrength ?? 0.0006);
        this.uVignetteOffset = uniform(params.vignetteOffset ?? 1.2);
        this.uVignetteDarkness = uniform(params.vignetteDarkness ?? 0.5);
        this.uExposure = uniform(params.exposure ?? 1.05);
        this.uContrast = uniform(params.contrast ?? 1.04);
        this.uSaturation = uniform(params.saturation ?? 1.08);
        this.uTintStrength = uniform(params.tintStrength ?? 0.22);
        this.uDitherStrength = uniform(params.ditherStrength ?? 0.0);
        this.uTint = uniform(new THREE.Color(1.04, 0.98, 1.08));

        const uv = viewportUV;
        const centered = uv.sub(0.5).mul(2.0);
        const dist = length(centered);
        const vignette = smoothstep(this.uVignetteOffset, this.uVignetteOffset.sub(0.6), dist);
        const baseSample = sceneColor.sample(uv);
        const vignetteColor = mix(
            baseSample.mul(float(1.0).sub(this.uVignetteDarkness)),
            baseSample,
            vignette,
        );

        const chroma = this.enableChromatic
            ? chromaticAberration(vignetteColor, this.uChromaticStrength, vec2(0.5, 0.5), 1.1)
            : vignetteColor;
        const combined = chroma.add(this.bloomNode);

        const exposed = combined.mul(this.uExposure);
        const acesA = float(2.51);
        const acesB = float(0.03);
        const acesC = float(2.43);
        const acesD = float(0.59);
        const acesE = float(0.14);
        const acesNum = exposed.mul(exposed.mul(acesA).add(acesB));
        const acesDen = exposed.mul(exposed.mul(acesC).add(acesD)).add(acesE);
        let graded = clamp(acesNum.div(acesDen), float(0.0), float(1.0));

        const luma = dot(graded, vec3(0.2126, 0.7152, 0.0722));
        graded = mix(vec3(luma), graded, this.uSaturation);
        graded = graded.sub(0.5).mul(this.uContrast).add(0.5);
        graded = mix(graded, graded.mul(this.uTint), this.uTintStrength);

        this.postProcessing.outputNode = graded;
        this.postProcessing.needsUpdate = true;
        this.size = { width: 0, height: 0 };
    }

    update(params = {}) {
        if (params.bloomStrength !== undefined) {
            this.bloomNode.strength.value = params.bloomStrength;
        }
        if (params.bloomRadius !== undefined) {
            this.bloomNode.radius.value = params.bloomRadius;
        }
        if (params.bloomThreshold !== undefined) {
            this.bloomNode.threshold.value = params.bloomThreshold;
        }
        if (this.enableChromatic && params.chromaticStrength !== undefined) {
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
        if (params.contrast !== undefined) {
            this.uContrast.value = params.contrast;
        }
        if (params.saturation !== undefined) {
            this.uSaturation.value = params.saturation;
        }
        if (params.tintStrength !== undefined) {
            this.uTintStrength.value = params.tintStrength;
        }
        if (params.ditherStrength !== undefined) {
            this.uDitherStrength.value = params.ditherStrength;
        }
        if (params.bloomDownsample !== undefined) {
            this.bloomDownsample = params.bloomDownsample;
            if (this.size.width > 0 && this.size.height > 0 && this.bloomNode?._separableBlurMaterials?.length) {
                this.bloomNode.setSize(this.size.width, this.size.height);
            }
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

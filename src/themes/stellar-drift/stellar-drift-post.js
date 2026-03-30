/**
 * Stellar Drift - WebGPU Post Processing
 * WebGPU path: bloom + vignette + chromatic aberration + optional MRT isolation.
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
    vec4,
    dot,
    fract,
    sin,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { chromaticAberration } from 'three/addons/tsl/display/ChromaticAberrationNode.js';

export class StellarDriftPost {
    constructor(renderer, scene, camera, params = {}) {
        this.renderer = renderer;
        this.useMRT = params.useMRT ?? true;
        this.bloomDownsample = params.bloomDownsample ?? 0.8;
        this.postProcessing = new THREE.PostProcessing(renderer);
        this.scenePass = pass(scene, camera);
        this.size = { width: 0, height: 0 };

        if (this.useMRT) {
            this.scenePass.setMRT(mrt({ output, emissive }));
        }

        const sceneColor = this.scenePass.getTextureNode('output');
        const bloomSource = this.useMRT ? this.scenePass.getTextureNode('emissive') : sceneColor;

        const bloomStrength = params.bloomStrength ?? 0.2;
        const bloomRadius = params.bloomRadius ?? 0.4;
        const bloomThreshold = params.bloomThreshold ?? 0.66;
        this.bloomNode = bloom(bloomSource, bloomStrength, bloomRadius, bloomThreshold);

        const originalBloomSetSize = this.bloomNode.setSize.bind(this.bloomNode);
        this.bloomNode.setSize = (width, height) => {
            originalBloomSetSize(width * this.bloomDownsample, height * this.bloomDownsample);
        };

        this.uChromaticStrength = uniform(params.chromaticStrength ?? 0.0);
        this.uVignetteOffset = uniform(params.vignetteOffset ?? 1.1);
        this.uVignetteDarkness = uniform(params.vignetteDarkness ?? 0.2);
        this.uSpeedLineIntensity = uniform(params.speedLineIntensity ?? 0.0);
        this.uTime = uniform(params.time ?? 0.0);
        this.uExposure = uniform(params.exposure ?? 0.96);
        this.uContrast = uniform(params.contrast ?? 1.12);
        this.uSaturation = uniform(params.saturation ?? 1.02);
        this.uDitherStrength = uniform(params.ditherStrength ?? 0.0016);

        const uv = viewportUV;
        const centered = uv.sub(0.5).mul(2.0);
        const dist = length(centered);
        const vignette = smoothstep(this.uVignetteOffset, this.uVignetteOffset.sub(0.5), dist);
        const baseSample = sceneColor.sample(uv);

        const vignetteColor = mix(
            baseSample.mul(float(1.0).sub(this.uVignetteDarkness)),
            baseSample,
            vignette,
        );

        const chroma = chromaticAberration(vignetteColor, this.uChromaticStrength, vec2(0.5, 0.5), 1.1);
        const bloomCombined = chroma.add(this.bloomNode);

        const radialPattern = sin(dot(centered, vec2(37.0, 19.0)).add(this.uTime.mul(9.0))).mul(0.5).add(0.5);
        const radialMask = smoothstep(0.2, 1.0, dist).mul(smoothstep(0.8, 1.0, radialPattern));
        const speedLines = radialMask.mul(this.uSpeedLineIntensity).mul(0.16);
        const speedLineColor = vec4(vec3(speedLines), float(0.0));

        const combined = bloomCombined.add(speedLineColor);
        const exposed = combined.rgb.mul(this.uExposure);

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

        const noise = fract(sin(dot(uv, vec2(12.9898, 78.233))).mul(43758.5453));
        const dither = noise.sub(0.5).mul(this.uDitherStrength);
        graded = clamp(graded.add(dither), float(0.0), float(1.0));

        this.postProcessing.outputNode = graded;
        this.postProcessing.needsUpdate = true;
    }

    update(params = {}) {
        if (params.bloomStrength !== undefined && this.bloomNode?.strength) {
            this.bloomNode.strength.value = params.bloomStrength;
        }
        if (params.bloomRadius !== undefined && this.bloomNode?.radius) {
            this.bloomNode.radius.value = params.bloomRadius;
        }
        if (params.bloomThreshold !== undefined && this.bloomNode?.threshold) {
            this.bloomNode.threshold.value = params.bloomThreshold;
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
        if (params.speedLineIntensity !== undefined) {
            this.uSpeedLineIntensity.value = params.speedLineIntensity;
        }
        if (params.time !== undefined) {
            this.uTime.value = params.time;
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

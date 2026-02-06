/**
 * Neon Dusk Theme - WebGPU Post Processing
 * Emissive-only bloom + vignette (WebGPU-only)
 */

import * as THREE from 'three/webgpu';
import {
    emissive,
    mrt,
    output,
    pass,
    viewportUV,
    uniform,
    float,
    mix,
    length,
    smoothstep,
    vec2,
    vec3,
    vec4,
    dot,
    fract,
    sin,
    saturation,
    clamp,
    perspectiveDepthToViewZ,
    viewZToOrthographicDepth,
    max,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';

export class NeonDuskPost {
    constructor(renderer, scene, camera, params = {}) {
        this.renderer = renderer;
        this.useMRT = params.useMRT ?? true;
        this.postProcessing = new THREE.PostProcessing(renderer);

        this.scenePass = pass(scene, camera);
        if (this.useMRT) {
            this.scenePass.setMRT(mrt({ output, emissive }));
        }

        const sceneColor = this.scenePass.getTextureNode('output');
        const emissivePass = this.useMRT ? this.scenePass.getTextureNode('emissive') : sceneColor;

        const bloomStrength = params.bloomStrength ?? 1.1;
        const bloomRadius = params.bloomRadius ?? 0.5;
        const bloomThreshold = params.bloomThreshold ?? 0.2;

        this.bloomNode = bloom(emissivePass, bloomStrength, bloomRadius, bloomThreshold);
        this.bloomDownsample = params.bloomDownsample ?? 0.8;
        const originalBloomSetSize = this.bloomNode.setSize.bind(this.bloomNode);
        this.bloomNode.setSize = (width, height) => {
            originalBloomSetSize(width * this.bloomDownsample, height * this.bloomDownsample);
        };

        this.size = { width: 0, height: 0 };
        this.uTime = uniform(0);
        this.uGrainIntensity = uniform(params.grainIntensity ?? 0.02);
        this.uGrainScale = uniform(params.grainScale ?? 120.0);
        this.uSaturation = uniform(params.saturation ?? 1.08);
        this.uSunScreen = uniform(new THREE.Vector2(0.5, 0.5));
        this.uRayIntensity = uniform(params.rayIntensity ?? 0.35);

        const cameraNear = uniform(camera.near);
        const cameraFar = uniform(camera.far);

        const uv = viewportUV;
        const centered = uv.sub(0.5).mul(2.0);
        const dist = length(centered);

        const vignetteOffset = float(params.vignetteOffset ?? 1.0);
        const vignetteDarkness = float(params.vignetteDarkness ?? 0.35);
        const vignette = smoothstep(vignetteOffset, vignetteOffset.sub(0.5), dist);

        const baseSample = sceneColor.sample(uv);
        const vignetteColor = mix(
            baseSample.mul(float(1.0).sub(vignetteDarkness)),
            baseSample,
            vignette,
        );

        const composite = vignetteColor.add(this.bloomNode);

        let rays = vec3(0.0);
        if (params.enableRays ?? true) {
            const depthTexture = this.scenePass.getTextureNode('depth');
            const sunUV = clamp(this.uSunScreen, vec2(0.0), vec2(1.0));
            const rayDir = sunUV.sub(uv);
            const stepVec = rayDir.mul(float(1.0 / 6.0));

            const sampleRay = (offset) => {
                const coord = uv.add(stepVec.mul(offset));
                const sample = emissivePass.sample(coord).xyz;
                const depthSample = depthTexture.sample(coord).x;
                const viewZ = perspectiveDepthToViewZ(depthSample, cameraNear, cameraFar);
                const linearDepth = viewZToOrthographicDepth(viewZ, cameraNear, cameraFar);
                const occlusion = smoothstep(float(0.2), float(1.0), linearDepth);
                return sample.mul(occlusion);
            };

            const raySample1 = sampleRay(float(1.0)).mul(0.18);
            const raySample2 = sampleRay(float(2.0)).mul(0.15);
            const raySample3 = sampleRay(float(3.0)).mul(0.12);
            const raySample4 = sampleRay(float(4.0)).mul(0.1);
            const raySample5 = sampleRay(float(5.0)).mul(0.08);
            const raySample6 = sampleRay(float(6.0)).mul(0.06);

            const sunDepth = depthTexture.sample(sunUV).x;
            const sunViewZ = perspectiveDepthToViewZ(sunDepth, cameraNear, cameraFar);
            const sunLinear = viewZToOrthographicDepth(sunViewZ, cameraNear, cameraFar);
            const sunVisible = smoothstep(float(0.2), float(0.8), sunLinear);

            rays = raySample1
                .add(raySample2)
                .add(raySample3)
                .add(raySample4)
                .add(raySample5)
                .add(raySample6)
                .mul(this.uRayIntensity)
                .mul(sunVisible)
                .mul(max(float(0.0), float(1.0).sub(length(rayDir))));
        }

        const noiseUV = uv.mul(this.uGrainScale).add(this.uTime.mul(0.1));
        const noiseSeed = dot(noiseUV, vec2(12.9898, 78.233));
        const noise = fract(sin(noiseSeed).mul(43758.5453));
        const grain = noise.sub(0.5).mul(this.uGrainIntensity);

        const graded = saturation(composite.add(vec4(rays, 0.0)).xyz, this.uSaturation).add(vec3(grain));
        const finalColor = vec4(graded, composite.w);

        this.postProcessing.outputNode = finalColor;
        this.postProcessing.needsUpdate = true;
    }

    updateTime(time) {
        if (this.uTime) {
            this.uTime.value = time;
        }
    }

    updateSun(screenPosition, intensity) {
        if (screenPosition) {
            this.uSunScreen.value.copy(screenPosition);
        }
        if (intensity !== undefined) {
            this.uRayIntensity.value = intensity;
        }
    }

    updateParams(params = {}) {
        if (params.bloomStrength !== undefined) {
            this.bloomNode.strength.value = params.bloomStrength;
        }
        if (params.bloomRadius !== undefined) {
            this.bloomNode.radius.value = params.bloomRadius;
        }
        if (params.bloomThreshold !== undefined) {
            this.bloomNode.threshold.value = params.bloomThreshold;
        }
        if (params.bloomDownsample !== undefined) {
            this.bloomDownsample = params.bloomDownsample;
            if (this.size.width && this.size.height && this.bloomNode?._separableBlurMaterials?.length) {
                this.bloomNode.setSize(this.size.width, this.size.height);
            }
        }
        if (params.grainIntensity !== undefined) {
            this.uGrainIntensity.value = params.grainIntensity;
        }
        if (params.grainScale !== undefined) {
            this.uGrainScale.value = params.grainScale;
        }
        if (params.saturation !== undefined) {
            this.uSaturation.value = params.saturation;
        }
        if (params.rayIntensity !== undefined) {
            this.uRayIntensity.value = params.rayIntensity;
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

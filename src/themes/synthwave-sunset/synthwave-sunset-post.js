/**
 * Synthwave Sunset Theme - WebGPU Post Processing
 * Emissive-only bloom + vignette + optional scanlines (WebGPU-only)
 */

import * as THREE from 'three/webgpu';
import {
    pass,
    mrt,
    output,
    emissive,
    viewportUV,
    uniform,
    float,
    vec2,
    vec3,
    vec4,
    sin,
    fract,
    dot,
    mix,
    length,
    smoothstep,
    abs,
    clamp,
    pow,
    max,
} from 'three/tsl';
import { mx_noise_float } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';

export class SynthwaveSunsetPost {
    constructor(renderer, scene, camera, params = {}) {
        this.renderer = renderer;
        this.postProcessing = new THREE.PostProcessing(renderer);

        this.uTime = uniform(0);
        this.uScanline = uniform(params.scanlineIntensity ?? 0.0);
        this.uGradeStrength = uniform(params.gradeStrength ?? 0.15);
        this.uGodRaysIntensity = uniform(params.godRaysIntensity ?? 0.25);
        this.uSunScreen = uniform(params.sunScreen ?? new THREE.Vector2(0.5, 0.6));
        this.uReflectionIntensity = uniform(params.reflectionIntensity ?? 0.0);
        this.uReflectionDistort = uniform(params.reflectionDistort ?? 0.015);
        this.uReflectionSpeed = uniform(params.reflectionSpeed ?? 0.15);
        this.uHorizon = uniform(params.horizon ?? 0.46);
        this.uChromaticAberration = uniform(params.chromaticAberration ?? 0.0);
        this.uFilmGrain = uniform(params.filmGrain ?? 0.0);

        this.scenePass = pass(scene, camera);
        this.scenePass.setMRT(mrt({ output, emissive }));

        const sceneColor = this.scenePass.getTextureNode('output');
        const emissivePass = this.scenePass.getTextureNode('emissive');

        const bloomStrength = params.bloomStrength ?? 0.85;
        const bloomRadius = params.bloomRadius ?? 0.65;
        const bloomThreshold = params.bloomThreshold ?? 0.22;

        this.bloomNode = bloom(emissivePass, bloomStrength, bloomRadius, bloomThreshold);
        this.bloomDownsample = params.bloomDownsample ?? 0.8;
        const originalBloomSetSize = this.bloomNode.setSize.bind(this.bloomNode);
        this.bloomNode.setSize = (width, height) => {
            originalBloomSetSize(width * this.bloomDownsample, height * this.bloomDownsample);
        };
        this.size = { width: 0, height: 0 };

        const uv = viewportUV;
        const centered = uv.sub(0.5).mul(2.0);
        const dist = length(centered);

        // Radial chromatic aberration — splits RGB along the view-center axis.
        // Intensity peaks at corners (where `centered` has length ~sqrt(2)).
        const caOffset = centered.mul(this.uChromaticAberration.mul(0.0035));
        const sampleR = sceneColor.sample(uv.add(caOffset));
        const sampleG = sceneColor.sample(uv);
        const sampleB = sceneColor.sample(uv.sub(caOffset));
        const baseSample = vec4(sampleR.r, sampleG.g, sampleB.b, sampleG.a);

        const vignetteOffset = float(params.vignetteOffset ?? 1.0);
        const vignetteDarkness = float(params.vignetteDarkness ?? 0.35);
        const vignette = smoothstep(vignetteOffset, vignetteOffset.sub(0.5), dist);

        const gradeTint = vec3(1.05, 0.98, 1.08);
        const graded = mix(baseSample, baseSample.mul(gradeTint), this.uGradeStrength);

        const scan = sin(uv.y.mul(800.0).add(this.uTime.mul(30.0))).mul(0.5).add(0.5);
        const scanMask = mix(float(1.0), scan.mul(0.85).add(0.15), this.uScanline);

        const vignetteColor = mix(
            graded.mul(float(1.0).sub(vignetteDarkness)),
            graded,
            vignette,
        );

        let outColor = vignetteColor;

        // God rays (screen-space)
        const rayDir = uv.sub(this.uSunScreen);
        const rayDist = length(rayDir);
        const rayCore = max(float(0.0), float(1.0).sub(rayDist.mul(2.0)));
        const rayStreak = float(1.0);
        const rays = pow(rayCore, 2.8).mul(rayStreak).mul(this.uGodRaysIntensity);
        const lum = dot(baseSample.rgb, vec3(0.299, 0.587, 0.114));
        const occlusion = smoothstep(0.1, 0.8, float(1.0).sub(lum));
        const rayColor = vec3(1.0, 0.75, 0.45).mul(rays.mul(occlusion));
        outColor = outColor.add(vec4(rayColor, 1.0));

        // Screen-space wet reflection (mirror sky into grid only)
        const horizon = this.uHorizon;
        const gridMask = float(1.0).sub(smoothstep(horizon.sub(0.18), horizon, uv.y));
        const timeWave = this.uTime.mul(this.uReflectionSpeed);
        const ripplePrimary = sin(uv.x.mul(10.0).add(timeWave.mul(0.7)))
            .mul(sin(uv.y.mul(14.0).add(timeWave.mul(0.6))));
        const rippleSecondary = sin(uv.x.mul(5.0).sub(timeWave.mul(0.4)))
            .mul(sin(uv.y.mul(7.0).add(timeWave.mul(0.35))))
            .mul(0.6);
        const ripple = ripplePrimary.add(rippleSecondary);
        const distort = ripple.mul(this.uReflectionDistort);
        const reflectedUv = vec2(
            uv.x.add(distort),
            horizon.add(horizon.sub(uv.y)).add(distort.mul(0.5)),
        );
        const clampedUv = vec2(
            clamp(reflectedUv.x, float(0.0), float(1.0)),
            clamp(reflectedUv.y, horizon, float(1.0)),
        );
        const reflectionSample = emissivePass.sample(clampedUv);
        const reflectionTint = vec3(0.7, 1.1, 1.4);
        const baseReflection = reflectionSample.rgb.mul(reflectionTint).mul(this.uReflectionIntensity);
        const sourceMask = smoothstep(horizon, horizon.add(0.05), clampedUv.y);
        const reflectionColor = baseReflection.mul(gridMask).mul(sourceMask);
        outColor = outColor.add(vec4(reflectionColor, 1.0));

        // Sun reflection streak (boost to match neon dusk feel)
        const sunSample = emissivePass.sample(this.uSunScreen).rgb;
        const sunLuma = dot(sunSample, vec3(0.299, 0.587, 0.114));
        const sunBoost = pow(max(sunLuma, float(0.0)), float(0.6)).mul(1.6).add(0.15);
        const sunRefY = clamp(horizon.add(horizon.sub(this.uSunScreen.y)), float(0.0), float(1.0));
        const sunRefUv = vec2(this.uSunScreen.x, sunRefY);
        const sunDx = abs(uv.x.sub(sunRefUv.x));
        const sunDy = uv.y.sub(sunRefUv.y);
        const sunLine = smoothstep(float(0.12), float(0.0), sunDx);
        const sunTrail = smoothstep(float(0.0), float(0.7), sunDy);
        const sunStreak = sunLine.mul(sunTrail);
        const sunReflection = sunSample.mul(sunStreak)
            .mul(sunBoost)
            .mul(this.uReflectionIntensity.mul(1.4));
        outColor = outColor.add(vec4(sunReflection.mul(gridMask), 1.0));

        // Film grain — animated luminance noise, intensity-gated by uFilmGrain.
        const grain = mx_noise_float(vec3(uv.mul(900.0), fract(this.uTime.mul(13.0))));
        const grainContribution = vec3(grain).mul(this.uFilmGrain).mul(0.06);

        const composited = outColor.mul(scanMask).add(this.bloomNode);
        this.postProcessing.outputNode = composited.add(vec4(grainContribution, 0.0));
        this.postProcessing.needsUpdate = true;
    }

    update(time, params = {}) {
        this.uTime.value = time;
        if (params.scanlineIntensity !== undefined) {
            this.uScanline.value = params.scanlineIntensity;
        }
        if (params.gradeStrength !== undefined) {
            this.uGradeStrength.value = params.gradeStrength;
        }
        if (params.godRaysIntensity !== undefined) {
            this.uGodRaysIntensity.value = params.godRaysIntensity;
        }
        if (params.sunScreen !== undefined) {
            this.uSunScreen.value.copy(params.sunScreen);
        }
        if (params.reflectionIntensity !== undefined) {
            this.uReflectionIntensity.value = params.reflectionIntensity;
        }
        if (params.reflectionDistort !== undefined) {
            this.uReflectionDistort.value = params.reflectionDistort;
        }
        if (params.reflectionSpeed !== undefined) {
            this.uReflectionSpeed.value = params.reflectionSpeed;
        }
        if (params.horizon !== undefined) {
            this.uHorizon.value = params.horizon;
        }
        if (params.chromaticAberration !== undefined) {
            this.uChromaticAberration.value = params.chromaticAberration;
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
        this.scenePass.dispose();
        this.bloomNode.dispose();
        this.postProcessing.dispose();
    }
}

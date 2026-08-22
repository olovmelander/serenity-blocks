/**
 * Wolfhour Theme — WebGPU Node Post-Processing
 *
 * Emissive-aware bloom + silver grading + vignette + optional film grain +
 * ACES tone map + dither.
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
    fract,
    dot,
    length,
    mix,
    sin,
    smoothstep,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { disposeBloomNodeDeep } from '../shared/bloom-dispose.js';
import { withEmissiveMaterialBlending } from '../shared/mrt-blend.js';

export const WOLFHOUR_POST_PROFILES = Object.freeze({
    Minimal: Object.freeze({
        enabled: false,
        profile: 'off',
        useFilmGrain: false,
        silverTintStrength: 0.0,
        bloomDownsample: 0.56,
        ditherStrength: 0.0012,
        bloomRadius: 0.5,
        bloomThreshold: 0.25,
        tintDesaturation: 0.55,
        vignetteOffset: 1.18,
        vignetteDarkness: 0.58,
        exposure: 1.0,
        contrast: 1.03,
        saturation: 0.98,
        grainStrength: 0.0,
    }),
    Low: Object.freeze({
        enabled: false,
        profile: 'off',
        useFilmGrain: false,
        silverTintStrength: 0.0,
        bloomDownsample: 0.58,
        ditherStrength: 0.0012,
        bloomRadius: 0.5,
        bloomThreshold: 0.25,
        tintDesaturation: 0.55,
        vignetteOffset: 1.18,
        vignetteDarkness: 0.58,
        exposure: 1.0,
        contrast: 1.03,
        saturation: 0.98,
        grainStrength: 0.0,
    }),
    Medium: Object.freeze({
        enabled: true,
        profile: 'balanced',
        useFilmGrain: false,
        silverTintStrength: 0.08,
        bloomDownsample: 0.58,
        ditherStrength: 0.0014,
        bloomRadius: 0.52,
        bloomThreshold: 0.22,
        tintDesaturation: 0.52,
        vignetteOffset: 1.18,
        vignetteDarkness: 0.56,
        exposure: 1.0,
        contrast: 1.03,
        saturation: 0.99,
        grainStrength: 0.0,
    }),
    High: Object.freeze({
        enabled: true,
        profile: 'full',
        useFilmGrain: true,
        silverTintStrength: 0.18,
        bloomDownsample: 0.58,
        ditherStrength: 0.0018,
        bloomRadius: 0.54,
        bloomThreshold: 0.2,
        tintDesaturation: 0.56,
        vignetteOffset: 1.18,
        vignetteDarkness: 0.58,
        exposure: 1.0,
        contrast: 1.04,
        saturation: 0.98,
        grainStrength: 0.00135,
    }),
    Ultra: Object.freeze({
        enabled: true,
        profile: 'full',
        useFilmGrain: true,
        silverTintStrength: 0.21,
        bloomDownsample: 0.61,
        ditherStrength: 0.002,
        bloomRadius: 0.56,
        bloomThreshold: 0.18,
        tintDesaturation: 0.57,
        vignetteOffset: 1.2,
        vignetteDarkness: 0.6,
        exposure: 1.0,
        contrast: 1.04,
        saturation: 0.98,
        grainStrength: 0.00145,
    }),
    Extreme: Object.freeze({
        enabled: true,
        profile: 'full',
        useFilmGrain: true,
        silverTintStrength: 0.24,
        bloomDownsample: 0.64,
        ditherStrength: 0.0022,
        bloomRadius: 0.58,
        bloomThreshold: 0.16,
        tintDesaturation: 0.58,
        vignetteOffset: 1.22,
        vignetteDarkness: 0.62,
        exposure: 1.0,
        contrast: 1.04,
        saturation: 0.98,
        grainStrength: 0.00155,
    }),
});

export function getWolfhourPostProfile(qualityName) {
    const key = typeof qualityName === 'string' ? qualityName : 'High';
    const profile = WOLFHOUR_POST_PROFILES[key] || WOLFHOUR_POST_PROFILES.High;
    return { ...profile };
}

export class WolfhourPost {
    constructor(renderer, scene, camera, params = {}) {
        const sanitizeDownsample = (value, fallback = 0.72) => (
            Number.isFinite(value)
                ? Math.min(1.0, Math.max(0.3, value))
                : fallback
        );

        this.renderer = renderer;
        this.useMRT = params.useMRT === true;
        this.bloomDownsample = sanitizeDownsample(params.bloomDownsample, 0.72);
        this.size = { width: 0, height: 0 };

        this.useFilmGrain = params.useFilmGrain !== false;
        this.baseGrainStrength = Number.isFinite(params.grainStrength) ? params.grainStrength : 0.00135;

        this.postProcessing = new THREE.RenderPipeline(renderer);
        this.scenePass = pass(scene, camera);
        if (this.useMRT) {
            this.scenePass.setMRT(withEmissiveMaterialBlending(mrt({ output, emissive })));
        }

        const sceneColor = this.scenePass.getTextureNode('output');
        const bloomSource = this.useMRT ? this.scenePass.getTextureNode('emissive') : sceneColor;

        this.bloomNode = bloom(
            bloomSource,
            params.bloomStrength ?? 0.5,
            params.bloomRadius ?? 0.54,
            params.bloomThreshold ?? 0.2,
        );

        const originalBloomSetSize = this.bloomNode.setSize.bind(this.bloomNode);
        this.bloomNode.setSize = (width, height) => {
            originalBloomSetSize(width * this.bloomDownsample, height * this.bloomDownsample);
        };

        this.uTime = uniform(0);
        this.uSilverTintStrength = uniform(params.silverTintStrength ?? 0.18);
        this.uTintDesaturation = uniform(params.tintDesaturation ?? 0.56);
        this.uVignetteOffset = uniform(params.vignetteOffset ?? 1.18);
        this.uVignetteDarkness = uniform(params.vignetteDarkness ?? 0.58);
        this.uExposure = uniform(params.exposure ?? 1.0);
        this.uContrast = uniform(params.contrast ?? 1.04);
        this.uSaturation = uniform(params.saturation ?? 0.98);
        this.uDitherStrength = uniform(params.ditherStrength ?? 0.0018);
        this.uGrainStrength = uniform(this.useFilmGrain ? this.baseGrainStrength : 0.0);

        const uv = viewportUV;
        const baseColor = sceneColor.sample(uv);
        const bloomColor = baseColor.add(this.bloomNode);

        const luma = dot(bloomColor.rgb, vec3(0.2126, 0.7152, 0.0722));
        const desaturated = mix(bloomColor.rgb, vec3(luma), this.uTintDesaturation);
        const silverized = desaturated.mul(vec3(0.69, 0.69, 0.75));
        const tinted = mix(bloomColor.rgb, silverized, this.uSilverTintStrength);

        const centered = uv.sub(0.5).mul(2.0);
        const dist = length(centered);
        const vignetteMask = float(1.0).sub(
            smoothstep(this.uVignetteOffset.sub(0.55), this.uVignetteOffset, dist),
        );
        const vignetteColor = mix(
            tinted.mul(float(1.0).sub(this.uVignetteDarkness)),
            tinted,
            vignetteMask,
        );

        const acesInput = vignetteColor.mul(this.uExposure);
        const acesA = float(2.51);
        const acesB = float(0.03);
        const acesC = float(2.43);
        const acesD = float(0.59);
        const acesE = float(0.14);
        const acesNum = acesInput.mul(acesInput.mul(acesA).add(acesB));
        const acesDen = acesInput.mul(acesInput.mul(acesC).add(acesD)).add(acesE);
        let graded = clamp(acesNum.div(acesDen), float(0.0), float(1.0));

        const gradedLuma = dot(graded, vec3(0.2126, 0.7152, 0.0722));
        graded = mix(vec3(gradedLuma), graded, this.uSaturation);
        graded = graded.sub(0.5).mul(this.uContrast).add(0.5);

        let withGrain = graded;
        if (this.useFilmGrain) {
            const grainNoise = fract(
                sin(
                    dot(
                        uv.mul(148.37).add(vec2(this.uTime.mul(0.73), this.uTime.mul(1.17))),
                        vec2(12.9898, 78.233),
                    ),
                ).mul(43758.5453),
            );
            const grain = grainNoise.sub(0.5).mul(this.uGrainStrength);
            withGrain = clamp(graded.add(vec3(grain)), float(0.0), float(1.0));
        }

        const ditherNoise = fract(sin(dot(uv.mul(311.7), vec2(127.1, 269.5))).mul(43758.5453));
        const dither = ditherNoise.sub(0.5).mul(this.uDitherStrength);
        const finalColor = clamp(withGrain.add(vec3(dither)), float(0.0), float(1.0));

        this.postProcessing.outputNode = vec4(finalColor.x, finalColor.y, finalColor.z, baseColor.a);
        this.postProcessing.needsUpdate = true;

        this.sanitizeDownsample = sanitizeDownsample;
    }

    updateDynamic(params = {}) {
        if (params.time !== undefined) {
            this.uTime.value = params.time;
        }
        if (params.bloomStrength !== undefined && this.bloomNode?.strength) {
            this.bloomNode.strength.value = params.bloomStrength;
        }
    }

    updateStaticProfile(params = {}) {
        if (params.bloomRadius !== undefined && this.bloomNode?.radius) {
            this.bloomNode.radius.value = params.bloomRadius;
        }
        if (params.bloomThreshold !== undefined && this.bloomNode?.threshold) {
            this.bloomNode.threshold.value = params.bloomThreshold;
        }
        if (params.bloomDownsample !== undefined) {
            this.bloomDownsample = this.sanitizeDownsample(params.bloomDownsample, this.bloomDownsample);
            if (this.size.width > 0 && this.size.height > 0 && this.bloomNode?._separableBlurMaterials?.length) {
                this.bloomNode.setSize(this.size.width, this.size.height);
            }
        }

        if (params.silverTintStrength !== undefined) this.uSilverTintStrength.value = params.silverTintStrength;
        if (params.tintDesaturation !== undefined) this.uTintDesaturation.value = params.tintDesaturation;
        if (params.vignetteOffset !== undefined) this.uVignetteOffset.value = params.vignetteOffset;
        if (params.vignetteDarkness !== undefined) this.uVignetteDarkness.value = params.vignetteDarkness;
        if (params.exposure !== undefined) this.uExposure.value = params.exposure;
        if (params.contrast !== undefined) this.uContrast.value = params.contrast;
        if (params.saturation !== undefined) this.uSaturation.value = params.saturation;
        if (params.ditherStrength !== undefined) this.uDitherStrength.value = params.ditherStrength;

        if (params.useFilmGrain !== undefined) {
            this.useFilmGrain = params.useFilmGrain === true;
        }
        if (params.grainStrength !== undefined) {
            this.baseGrainStrength = params.grainStrength;
        }
        this.uGrainStrength.value = this.useFilmGrain ? this.baseGrainStrength : 0.0;
    }

    update(params = {}) {
        this.updateStaticProfile(params);
        this.updateDynamic(params);
    }

    render() {
        this.postProcessing.render();
    }

    setSize(width, height) {
        if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;

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
        this.scenePass = null;
        this.bloomNode = null;
        this.postProcessing = null;
    }
}

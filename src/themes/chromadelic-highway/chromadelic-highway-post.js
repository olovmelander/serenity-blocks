/**
 * Chromadelic Highway - WebGPU Post Processing
 * Emissive-only bloom + chromatic aberration + vignette + ACES tonemap (WebGPU path)
 * Cinematic flourishes (Extreme/Ultra): radial chroma curve, god rays, anamorphic flare,
 * pace-driven barrel distortion.
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
        const emissiveSampler = this.useMRT ? this.scenePass.getTextureNode('emissive') : sceneColor;

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
        this.uExposure = uniform(params.exposure ?? 0.94);
        this.uContrast = uniform(params.contrast ?? 1.2);
        this.uSaturation = uniform(params.saturation ?? 1.08);
        this.uTintStrength = uniform(params.tintStrength ?? 0.1);
        this.uDitherStrength = uniform(params.ditherStrength ?? 0.00055);
        // Deep violet bias — keeps shadows neutral-purple, lifts magenta highlights
        this.uTint = uniform(new THREE.Color(1.0, 0.93, 1.1));
        // Shadow preservation: prevents deep blacks from being washed to grey by saturation boost
        this.uShadowFloor = uniform(params.shadowFloor ?? 0.08);

        // Cinematic flourish uniforms (Extreme/Ultra usually drive these; default 0 = off)
        // Radial chroma multiplier curve: 0 at center, +uRadialChromaBoost at edges.
        this.uRadialChromaBoost = uniform(params.radialChromaBoost ?? 1.4);
        // Anamorphic horizontal flare: sums bloom samples along ±X for a horizontal streak.
        this.uAnamorphicStrength = uniform(params.anamorphicStrength ?? 0.0);
        // God-ray (radial streak) sourced from the emissive pass around uGodRaySun (screen UV).
        this.uGodRayStrength = uniform(params.godRayStrength ?? 0.0);
        this.uGodRaySun = uniform(new THREE.Vector2(
            params.godRaySunX ?? 0.5,
            params.godRaySunY ?? 0.47, // Road vanishing point sits slightly below center
        ));
        // Barrel distortion: pulls UVs outward radially. Theme drives this with play pace.
        this.uBarrelStrength = uniform(params.barrelStrength ?? 0.0);
        // One-shot wormhole pulse on TETRIS (Phase 6 wires this).
        this.uWormholeStrength = uniform(0.0);
        // Wet-road reflection from the emissive MRT, gated to showcase tiers by the theme.
        this.uRoadReflectionStrength = uniform(params.roadReflectionStrength ?? 0.0);
        this.uTime = uniform(params.time ?? 0.0);

        // Depth-fog bloom attenuation — softens distant emissives without erasing them.
        // The scene already has its own FogExp2; this is an additional thin pass that
        // tints far pixels toward fog color and slightly reduces bloom on them.
        this.fogNear = uniform(params.fogNear ?? 0.45);
        this.fogFar = uniform(params.fogFar ?? 0.95);
        this.fogDensity = uniform(params.fogDensity ?? 0.55);
        this.fogBloomAttenuation = uniform(params.fogBloomAttenuation ?? 0.22);
        this.fogColor = uniform(params.fogColor ?? new THREE.Color(0x0a0418));

        // Build post-processing pipeline
        const baseUV = viewportUV;
        const centered = baseUV.sub(0.5).mul(2.0);
        const dist = length(centered);

        // Barrel distortion: pulls UV outward as a function of radius² (classic lens).
        // Adds with wormhole pulse for cinematic TETRIS punctuation.
        const totalBarrel = this.uBarrelStrength.add(this.uWormholeStrength.mul(0.6));
        const barrelOffset = centered.mul(dist.mul(dist)).mul(totalBarrel.mul(0.5));
        const uvNode = baseUV.add(barrelOffset);

        // Depth-fog: sample linear depth, build a [0..1] fog amount, mix scene → fog color.
        // This must run BEFORE vignette/chroma so they operate on fogged base.
        const linearDepth = this.scenePass.getLinearDepthNode();
        const fogFactor = smoothstep(this.fogNear, this.fogFar, linearDepth);
        const fogAmount = clamp(fogFactor.mul(this.fogDensity), float(0.0), float(1.0));
        const baseSampleRaw = sceneColor.sample(uvNode);
        const baseSample = mix(baseSampleRaw, this.fogColor, fogAmount);

        // Vignette (computed on undistorted UV so edges remain consistent)
        const vignette = smoothstep(this.uVignetteOffset, this.uVignetteOffset.sub(0.5), dist);
        const vignetteColor = mix(
            baseSample.mul(float(1.0).sub(this.uVignetteDarkness)),
            baseSample,
            vignette,
        );

        // Radial chromatic aberration: zero at center, ramps with radius² for that
        // cinematic lens feel where edges separate into R/B fringes.
        const radialChroma = this.uChromaticStrength
            .mul(float(1.0).add(this.uRadialChromaBoost.mul(dist.mul(dist))))
            .add(this.uWormholeStrength.mul(0.006));
        const chroma = chromaticAberration(vignetteColor, radialChroma, vec2(0.5, 0.5), 1.1);

        // Build-time flourish gates. A flourish whose per-quality ceiling is 0 is permanently
        // disabled by the theme (its strength uniform is clamped to Math.min(0, …) === 0 every
        // frame), so the only thing its node graph contributes is dead emissive-texture taps.
        // Skipping construction at those tiers removes ~16 full-screen texture samples per pixel
        // (god-ray 6-tap + anamorphic 5×2-tap) with byte-identical output — a real GPU win on the
        // weak hardware that actually runs Medium/Low/Minimal.
        const enableGodRays = (params.godRayStrength ?? 0) > 0;
        const enableAnamorphic = (params.anamorphicStrength ?? 0) > 0;
        const enableRoadReflection = (params.roadReflectionStrength ?? 0) > 0;

        // Screen-space god rays — radial streaks sampled from the emissive MRT pass.
        // Direction is from the configured sun-point (default: road vanishing point) outward.
        // Cheap 6-tap accumulation, weighted by 1/N to keep cost bounded.
        let godRays = vec3(0.0);
        if (enableGodRays) {
            const sunUV = this.uGodRaySun;
            const rayDir = uvNode.sub(sunUV);
            const rayLen = length(rayDir).add(1e-4);
            const rayUnit = rayDir.div(rayLen);
            const rayFalloff = smoothstep(0.6, 0.0, rayLen); // brightest near sun
            const rayStepCount = 6;
            const rayStepSize = 0.04;
            for (let i = 1; i <= rayStepCount; i++) {
                const offset = rayUnit.mul(float(-i * rayStepSize));
                const sampleUV = uvNode.add(offset);
                const sample = emissiveSampler.sample(sampleUV).rgb;
                const decay = float(1.0 - i / rayStepCount);
                godRays = godRays.add(sample.mul(decay));
            }
            godRays = godRays.mul(rayFalloff).mul(this.uGodRayStrength.mul(0.18));
        }

        // Anamorphic horizontal flare — wide horizontal streak from bright emissives.
        // Cheap 5-tap horizontal blur of the emissive pass, additively composed.
        let anamorphic = vec3(0.0);
        if (enableAnamorphic) {
            const flareTaps = 5;
            const flareSpread = 0.045;
            for (let i = 1; i <= flareTaps; i++) {
                const dx = (i / flareTaps) * flareSpread;
                const sampleA = emissiveSampler.sample(vec2(uvNode.x.add(float(dx)), uvNode.y)).rgb;
                const sampleB = emissiveSampler.sample(vec2(uvNode.x.sub(float(dx)), uvNode.y)).rgb;
                const decay = float(1.0 - i / flareTaps);
                anamorphic = anamorphic.add(sampleA.mul(decay)).add(sampleB.mul(decay));
            }
            // Bias the flare warm (slight gold/magenta) so it reads as lens optic, not just bloom.
            const flareTint = vec3(1.05, 0.88, 1.18);
            anamorphic = anamorphic.mul(flareTint).mul(this.uAnamorphicStrength.mul(0.06));
        }

        // Subtle wet-road reflection: mirror bright emissives from above the road horizon
        // into the lower screen with a small ripple. This keeps the road glossy without
        // adding a physical water layer or another scene pass. Gated like the flourishes above:
        // at tiers where the ceiling is 0 this tap is dead, so its node isn't built.
        let roadReflection = vec3(0.0);
        if (enableRoadReflection) {
            const roadHorizonY = float(0.48);
            const roadMask = smoothstep(roadHorizonY, roadHorizonY.sub(0.36), uvNode.y)
                .mul(smoothstep(0.05, 0.34, baseUV.x))
                .mul(smoothstep(0.95, 0.66, baseUV.x));
            const ripple = sin(baseUV.x.mul(58.0).add(this.uTime.mul(1.7))).mul(0.004)
                .add(sin(baseUV.y.mul(41.0).sub(this.uTime.mul(1.1))).mul(0.003));
            const reflectionUV = vec2(
                uvNode.x.add(ripple.mul(0.45)),
                roadHorizonY.add(roadHorizonY.sub(uvNode.y).mul(0.82)).add(ripple),
            );
            roadReflection = emissiveSampler.sample(reflectionUV).rgb
                .mul(vec3(0.72, 0.58, 1.0))
                .mul(roadMask)
                .mul(this.uRoadReflectionStrength);
        }

        // Combine: scene+chroma + bloom + god rays + anamorphic flare + road reflection.
        // Bloom-like additives are attenuated by depth fog so distant emissives blend
        // into the haze rather than punching out as floating bright dots.
        const bloomAtten = clamp(float(1.0).sub(fogAmount.mul(this.fogBloomAttenuation)), float(0.0), float(1.0));
        const combined = chroma
            .add(this.bloomNode.mul(bloomAtten))
            .add(godRays.mul(bloomAtten))
            .add(anamorphic.mul(bloomAtten))
            .add(roadReflection);

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

        // Color grading: saturation (shadow-aware), contrast, tint
        // Shadow guard: scale saturation back toward 1.0 in deep blacks so they stay neutral-purple
        // rather than getting pulled into a muddy grey by uniform saturation boost.
        const luma = dot(graded, vec3(0.2126, 0.7152, 0.0722));
        const shadowMask = smoothstep(this.uShadowFloor, this.uShadowFloor.add(0.18), luma);
        const localSat = mix(float(1.0), this.uSaturation, shadowMask);
        graded = mix(vec3(luma), graded, localSat);
        graded = graded.sub(0.5).mul(this.uContrast).add(0.5);
        graded = mix(graded, graded.mul(this.uTint), this.uTintStrength);

        // Dither to prevent banding
        const noise = fract(sin(dot(baseUV, vec2(12.9898, 78.233))).mul(43758.5453));
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
        if (params.barrelStrength !== undefined) {
            this.uBarrelStrength.value = params.barrelStrength;
        }
        if (params.anamorphicStrength !== undefined) {
            this.uAnamorphicStrength.value = params.anamorphicStrength;
        }
        if (params.godRayStrength !== undefined) {
            this.uGodRayStrength.value = params.godRayStrength;
        }
        if (params.godRaySun) {
            this.uGodRaySun.value.set(params.godRaySun.x, params.godRaySun.y);
        }
        if (params.wormholeStrength !== undefined) {
            this.uWormholeStrength.value = params.wormholeStrength;
        }
        if (params.roadReflectionStrength !== undefined) {
            this.uRoadReflectionStrength.value = params.roadReflectionStrength;
        }
        if (params.time !== undefined) {
            this.uTime.value = params.time;
        }
        if (params.fogNear !== undefined) {
            this.fogNear.value = params.fogNear;
        }
        if (params.fogFar !== undefined) {
            this.fogFar.value = params.fogFar;
        }
        if (params.fogDensity !== undefined) {
            this.fogDensity.value = params.fogDensity;
        }
        if (params.fogBloomAttenuation !== undefined) {
            this.fogBloomAttenuation.value = params.fogBloomAttenuation;
        }
        if (params.fogColor !== undefined && this.fogColor) {
            this.fogColor.value = params.fogColor;
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

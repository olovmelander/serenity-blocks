/* eslint-disable import/no-unresolved */
/**
 * Himalayan Peak AAA — Cinematic Post Pipeline
 *
 * TSL post stack on three.js r181 `PostProcessing` (same toolbox as Electric
 * Dreams V3 / Winter), retuned for a mountain dawn → alpenglow look.
 *
 * Stack (in order):
 *   1. MRT emissive bloom (sun, alpenglow rims, snow glints, flag highlights)
 *   2. Chromatic aberration (subtle, edge-weighted)
 *   3. God-rays — radial light-scatter from the sun's screen position
 *   4. + bloom
 *   5. Vignette
 *   6. ACES filmic tonemap
 *   7. ★ Director-driven golden-hour grade (cool dawn → warm alpenglow) + sat/contrast
 *   8. ★ Signature finish: animated film grain + faint vertical "print" streak + dither
 *
 * Profile-driven; runtime updates flow through updateDynamic() with a cached object.
 * See docs/HIMALAYAN_PEAK_AAA_PLAN.md §3.3.
 */
import * as WEBGPU from 'three/webgpu';
import {
    Loop,
    clamp,
    dot,
    emissive,
    float,
    fract,
    length,
    mix,
    mrt,
    output,
    pass,
    sin,
    smoothstep,
    uniform,
    vec2,
    vec3,
    vec4,
    viewportUV,
} from 'three/tsl';
import * as THREE from 'three';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';

export const PEAK_POST_PROFILES = Object.freeze({
    Minimal: Object.freeze({
        enabled: false,
        bloomStrength: 0,
        bloomRadius: 0.5,
        bloomThreshold: 0.2,
        exposure: 1.0,
        contrast: 1.02,
        saturation: 1.0,
        vignette: 0.2,
        chromatic: 0,
        godray: 0,
        grain: 0,
        streak: 0,
        dither: 0.001,
    }),
    Low: Object.freeze({
        enabled: true,
        bloomStrength: 0.34,
        bloomRadius: 0.6,
        bloomThreshold: 0.6,
        exposure: 1.0,
        contrast: 1.08,
        saturation: 1.08,
        vignette: 0.3,
        chromatic: 0.0009,
        godray: 0,
        grain: 0.022,
        streak: 0.010,
        dither: 0.0015,
    }),
    Medium: Object.freeze({
        enabled: true,
        bloomStrength: 0.42,
        bloomRadius: 0.62,
        bloomThreshold: 0.55,
        exposure: 1.0,
        contrast: 1.11,
        saturation: 1.12,
        vignette: 0.4,
        chromatic: 0.0011,
        godray: 0.0,
        grain: 0.026,
        streak: 0.012,
        dither: 0.0017,
    }),
    High: Object.freeze({
        enabled: true,
        bloomStrength: 0.5,
        bloomRadius: 0.64,
        bloomThreshold: 0.5,
        exposure: 1.0,
        contrast: 1.13,
        saturation: 1.14,
        vignette: 0.46,
        chromatic: 0.0014,
        godray: 0.55,
        grain: 0.030,
        streak: 0.014,
        dither: 0.0019,
    }),
    Ultra: Object.freeze({
        enabled: true,
        bloomStrength: 0.56,
        bloomRadius: 0.66,
        bloomThreshold: 0.45,
        exposure: 1.0,
        contrast: 1.15,
        saturation: 1.16,
        vignette: 0.5,
        chromatic: 0.0017,
        godray: 0.7,
        grain: 0.032,
        streak: 0.015,
        dither: 0.0021,
    }),
    Extreme: Object.freeze({
        enabled: true,
        bloomStrength: 0.64,
        bloomRadius: 0.68,
        bloomThreshold: 0.42,
        exposure: 1.0,
        contrast: 1.16,
        saturation: 1.18,
        vignette: 0.54,
        chromatic: 0.0020,
        godray: 0.85,
        grain: 0.034,
        streak: 0.016,
        dither: 0.0024,
    }),
});

export function getPeakPostProfile(qualityName) {
    return { ...(PEAK_POST_PROFILES[qualityName] || PEAK_POST_PROFILES.High) };
}

const GODRAY_STEPS = 16;

export class PeakPostPipeline {
    constructor(renderer, scene, camera, params = {}) {
        this.renderer = renderer;
        this.scene = scene;
        this.camera = camera;
        this.mrtEnabled = params.useMRT !== false;
        this.postProcessing = null;

        if (renderer?.backend?.isWebGPUBackend !== true) {
            console.warn('[HimalayanPeak] Post pipeline requires WebGPU; skipping');
            return;
        }
        this._setup(params);
    }

    _setup(params) {
        this.postProcessing = new WEBGPU.PostProcessing(this.renderer);
        const scenePass = pass(this.scene, this.camera);

        let bloomSource;
        try {
            if (this.mrtEnabled) {
                scenePass.setMRT(mrt({ output, emissive }));
                bloomSource = scenePass.getTextureNode('emissive');
            } else {
                bloomSource = scenePass.getTextureNode('output');
            }
        } catch (err) {
            console.warn('[HimalayanPeak] MRT init failed; non-selective bloom:', err.message);
            this.mrtEnabled = false;
            bloomSource = scenePass.getTextureNode('output');
        }
        const sceneColor = scenePass.getTextureNode('output');
        this._bloomSource = bloomSource;

        this.bloomNode = bloom(
            bloomSource,
            params.bloomStrength ?? 0.5,
            params.bloomRadius ?? 0.64,
            params.bloomThreshold ?? 0.5,
        );

        // Runtime-mutable uniforms.
        this.uExposure = uniform(params.exposure ?? 1.0);
        this.uContrast = uniform(params.contrast ?? 1.13);
        this.uSaturation = uniform(params.saturation ?? 1.14);
        this.uVignette = uniform(params.vignette ?? 0.46);
        this.uChromatic = uniform(params.chromatic ?? 0.0022);
        this.uGrain = uniform(params.grain ?? 0.03);
        this.uStreak = uniform(params.streak ?? 0.014);
        this.uDither = uniform(params.dither ?? 0.0019);
        this.uGodray = uniform(params.godray ?? 0.55);
        this.uTime = uniform(0);
        this.uWarmth = uniform(0); // 0 cool dawn → 1 alpenglow (drives grade)
        this.uSunScreen = uniform(new THREE.Vector2(0.5, 0.85)); // sun UV
        this.uSunVisible = uniform(0); // 0 hidden / behind camera, 1 on-screen
        this.uWarmTint = uniform(new THREE.Color(0xffb066)); // alpenglow grade tint

        const uvNode = viewportUV;
        const centered = uvNode.sub(vec2(0.5, 0.5));
        const dist = length(centered);

        // 2. Chromatic aberration (edge-weighted).
        const edgeBoost = float(1.0).add(dist.mul(0.7));
        const chromaOffset = centered.mul(this.uChromatic).mul(edgeBoost);
        const sampleR = sceneColor.sample(uvNode.add(chromaOffset));
        const sampleG = sceneColor.sample(uvNode);
        const sampleB = sceneColor.sample(uvNode.sub(chromaOffset));
        const chroma = vec3(sampleR.r, sampleG.g, sampleB.b).toVar();

        // 3. God-rays: march from the pixel toward the sun, accumulating the
        // bright (emissive) channel. Cheap radial light-scatter.
        const toSun = this.uSunScreen.sub(uvNode);
        const stepVec = toSun.div(float(GODRAY_STEPS));
        const coord = uvNode.toVar();
        const decay = float(1.0).toVar();
        const rayAccum = vec3(0.0).toVar();
        Loop(GODRAY_STEPS, () => {
            coord.addAssign(stepVec);
            const s = bloomSource.sample(coord).rgb;
            rayAccum.addAssign(s.mul(decay));
            decay.mulAssign(0.92);
        });
        const godrays = rayAccum.div(float(GODRAY_STEPS))
            .mul(this.uGodray).mul(this.uSunVisible);

        // 4. Combine: scene chroma + god-rays + bloom.
        const withRays = chroma.add(godrays);
        const withBloom = withRays.add(this.bloomNode.rgb);

        // 5. Vignette (smooth dark falloff).
        const vignetteFactor = smoothstep(float(0.95), float(0.42), dist);
        const vignetted = mix(
            withBloom.mul(float(1.0).sub(this.uVignette)),
            withBloom,
            vignetteFactor,
        );

        // 6. ACES filmic tonemap.
        const exposed = vignetted.mul(this.uExposure);
        const acesNum = exposed.mul(exposed.mul(2.51).add(0.03));
        const acesDen = exposed.mul(exposed.mul(2.43).add(0.59)).add(0.14);
        // 7. ★ Golden-hour grade — push toward the warm tint with warmth, then
        // luma-preserving saturation + contrast. Built functionally (rebinding the
        // JS var to new nodes) — `.assign()` needs an Fn() stack, which this
        // top-level post graph doesn't have.
        let graded = clamp(acesNum.div(acesDen), float(0.0), float(1.0));
        graded = mix(graded, graded.mul(this.uWarmTint), this.uWarmth.mul(0.5));
        const luma = dot(graded, vec3(0.2126, 0.7152, 0.0722));
        graded = mix(vec3(luma), graded, this.uSaturation);
        graded = graded.sub(0.5).mul(this.uContrast).add(0.5);

        // 8. ★ Signature finish: film grain + faint vertical "print" streak + dither.
        const grainSeed = uvNode.mul(140.0).add(vec2(this.uTime.mul(0.71), this.uTime.mul(1.13)));
        const grain = fract(sin(dot(grainSeed, vec2(12.9898, 78.233))).mul(43758.5453))
            .sub(0.5).mul(this.uGrain);
        // Vertical streak: 1D noise across X only → faint paper/print striation.
        const streakSeed = uvNode.x.mul(820.0);
        const streak = fract(sin(streakSeed.mul(12.9898)).mul(43758.5453))
            .sub(0.5).mul(this.uStreak);
        const ditherSeed = uvNode.mul(317.0).add(vec2(0.17, 0.31));
        const dither = fract(sin(dot(ditherSeed, vec2(127.1, 269.5))).mul(43758.5453))
            .sub(0.5).mul(this.uDither);

        const finalColor = clamp(
            graded.add(vec3(grain)).add(vec3(streak)).add(vec3(dither)),
            float(0.0),
            float(1.0),
        );
        this.postProcessing.outputNode = vec4(finalColor, 1.0);
        this.postProcessing.needsUpdate = true;
    }

    isEnabled() {
        return this.postProcessing !== null;
    }

    setProfile(profile) {
        if (!this.postProcessing) return;
        if (this.bloomNode?.strength) this.bloomNode.strength.value = profile.bloomStrength;
        if (this.bloomNode?.radius) this.bloomNode.radius.value = profile.bloomRadius;
        if (this.bloomNode?.threshold) this.bloomNode.threshold.value = profile.bloomThreshold;
        this.uExposure.value = profile.exposure;
        this.uContrast.value = profile.contrast;
        this.uSaturation.value = profile.saturation;
        this.uVignette.value = profile.vignette;
        this.uChromatic.value = profile.chromatic;
        this.uGrain.value = profile.grain;
        this.uStreak.value = profile.streak;
        this.uDither.value = profile.dither;
        this.uGodray.value = profile.godray;
        this._baseGodray = profile.godray;
        this._baseBloom = profile.bloomStrength;
        this._baseChromatic = profile.chromatic;
    }

    /** Per-frame runtime update. Pass a CACHED object — no per-frame allocation. */
    updateDynamic(p) {
        if (!this.postProcessing) return;
        if (p.time !== undefined) this.uTime.value = p.time;
        if (p.warmth !== undefined) this.uWarmth.value = p.warmth;
        if (p.warmTint) this.uWarmTint.value.copy(p.warmTint);
        if (p.sunScreen) this.uSunScreen.value.copy(p.sunScreen);
        if (p.sunVisible !== undefined) this.uSunVisible.value = p.sunVisible;
        if (p.bloomBoost !== undefined && this.bloomNode?.strength) {
            this.bloomNode.strength.value = (this._baseBloom ?? 0.5) + p.bloomBoost;
        }
        if (p.chromaBoost !== undefined) {
            this.uChromatic.value = (this._baseChromatic ?? 0.0022) + p.chromaBoost;
        }
        if (p.godrayBoost !== undefined) {
            this.uGodray.value = (this._baseGodray ?? 0.55) + p.godrayBoost;
        }
    }

    render() {
        this.postProcessing.render();
    }

    dispose() {
        this.postProcessing = null;
        this.bloomNode = null;
        this._bloomSource = null;
    }
}

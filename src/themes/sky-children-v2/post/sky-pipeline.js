/* eslint-disable import/no-unresolved */
/**
 * Sky Children V2 AAA — Cinematic Post Pipeline
 *
 * TSL post stack on three.js `PostProcessing` (same toolbox as Himalayan Peak /
 * Electric Dreams V3 / Winter), retuned for the painterly Sky sunset look.
 *
 * Stack (in order):
 *   1. MRT emissive bloom (sun, cloud silver-linings, glitter, rims)
 *   2. Chromatic aberration (subtle, edge-weighted)
 *   3. God-rays — radial light-scatter from the sun's screen position
 *   4. ★ Soft-focus dreamy diffusion (Orton-ish bloom-lite → the ethereal Sky read)
 *   5. + bloom
 *   6. Vignette
 *   7. ACES filmic tonemap
 *   8. ★ Golden-hour grade (cool Reverie → warm Triumph) + sat/contrast
 *   9. Signature finish: animated film grain + dither
 *
 * Exposes the SkyCorePost-compatible interface (isEnabled/setPixelRatio/setSize/
 * update/render/dispose) so it drops into the orchestrator's existing post wiring.
 * Runtime updates flow through update()/updateDynamic() with a cached object.
 * See docs/SKY_CHILDREN_V2_AAA_PLAN.md §3.3.
 */
import * as WEBGPU from 'three/webgpu';
import {
    Loop,
    clamp,
    dot,
    emissive,
    float,
    fract,
    mix,
    mrt,
    output,
    pass,
    sin,
    smoothstep,
    uniform,
    length,
    vec2,
    vec3,
    vec4,
    viewportUV,
} from 'three/tsl';
import * as THREE from 'three';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { disposeBloomNodeDeep } from '../../shared/bloom-dispose.js';

const GODRAY_STEPS = 16;

export class SkyPipeline {
    constructor(renderer, scene, camera, params = {}) {
        this.renderer = renderer;
        this.scene = scene;
        this.camera = camera;
        this.mrtEnabled = params.useMRT !== false;
        this.postProcessing = null;

        try {
            this._setup(params);
        } catch (err) {
            console.warn('[SkyChildrenV2] Post pipeline setup failed; skipping post:', err?.message || err);
            this.postProcessing = null;
        }
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
            console.warn('[SkyChildrenV2] MRT init failed; non-selective bloom:', err?.message || err);
            this.mrtEnabled = false;
            bloomSource = scenePass.getTextureNode('output');
        }
        const sceneColor = scenePass.getTextureNode('output');

        this.bloomNode = bloom(
            bloomSource,
            params.bloomStrength ?? 0.85,
            params.bloomRadius ?? 0.9,
            params.bloomThreshold ?? 0.5,
        );

        // Runtime-mutable uniforms.
        this.uExposure = uniform(params.exposure ?? 1.08);
        this.uContrast = uniform(params.contrast ?? 1.12);
        this.uSaturation = uniform(params.saturation ?? 1.22);
        this.uVignette = uniform(params.vignette ?? params.vignetteDarkness ?? 0.26);
        this.uChromatic = uniform(params.chromatic ?? 0.0013);
        this.uDiffusion = uniform(params.diffusion ?? 0.16);
        this.uGrain = uniform(params.grain ?? params.grainStrength ?? 0.022);
        this.uDither = uniform(params.dither ?? 0.0018);
        this.uGodray = uniform(params.godray ?? 0.6);
        this.uTime = uniform(0);
        this.uWarmth = uniform(0); // 0 cool Reverie → 1 warm Triumph (drives grade)
        this.uSunScreen = uniform(new THREE.Vector2(0.5, 0.5));
        this.uSunVisible = uniform(0);
        this.uWarmTint = uniform(new THREE.Color(0xffb070));

        this._baseBloom = params.bloomStrength ?? 0.85;
        this._baseChromatic = params.chromatic ?? 0.0013;
        this._baseGodray = params.godray ?? 0.6;

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

        // 3. God-rays: march from the pixel toward the sun, accumulating the bright
        // (emissive) channel. Cheap radial light-scatter, gated on sun visibility.
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
        const godrays = rayAccum.div(float(GODRAY_STEPS)).mul(this.uGodray).mul(this.uSunVisible);

        // 4. ★ Soft-focus dreamy diffusion: a cheap 4-tap blur of the scene, lifted
        // additively → the ethereal Sky glow without a heavy multi-pass blur.
        const dOff = float(0.0018).add(this.uDiffusion.mul(0.0024));
        const soft = sceneColor.sample(uvNode.add(vec2(dOff, 0.0))).rgb
            .add(sceneColor.sample(uvNode.add(vec2(dOff.negate(), 0.0))).rgb)
            .add(sceneColor.sample(uvNode.add(vec2(0.0, dOff))).rgb)
            .add(sceneColor.sample(uvNode.add(vec2(0.0, dOff.negate()))).rgb)
            .mul(0.25)
            .mul(this.uDiffusion);

        // 5. Combine: scene chroma + god-rays + soft diffusion + bloom.
        const withBloom = chroma.add(godrays).add(soft).add(this.bloomNode.rgb);

        // 6. Vignette (smooth dark falloff).
        const vignetteFactor = smoothstep(float(0.95), float(0.42), dist);
        const vignetted = mix(
            withBloom.mul(float(1.0).sub(this.uVignette)),
            withBloom,
            vignetteFactor,
        );

        // 7. ACES filmic tonemap.
        const exposed = vignetted.mul(this.uExposure);
        const acesNum = exposed.mul(exposed.mul(2.51).add(0.03));
        const acesDen = exposed.mul(exposed.mul(2.43).add(0.59)).add(0.14);
        const aces = clamp(acesNum.div(acesDen), float(0.0), float(1.0));

        // 8. ★ Golden-hour grade — warm push with warmth, then luma-preserving
        // saturation + contrast. Built FUNCTIONALLY (no .assign) — reassigning a
        // toVar in the post output-node graph throws "No stack defined for assign"
        // and silently drops the op. See docs/SKY_CHILDREN_V2_AAA_PLAN.md / memory.
        const warmGraded = mix(aces, aces.mul(this.uWarmTint), this.uWarmth.mul(0.55));
        const luma = dot(warmGraded, vec3(0.2126, 0.7152, 0.0722));
        const saturated = mix(vec3(luma), warmGraded, this.uSaturation);
        const graded = saturated.sub(0.5).mul(this.uContrast).add(0.5);

        // 9. Signature finish: animated film grain + dither.
        const grainSeed = uvNode.mul(140.0).add(vec2(this.uTime.mul(0.71), this.uTime.mul(1.13)));
        const grain = fract(sin(dot(grainSeed, vec2(12.9898, 78.233))).mul(43758.5453))
            .sub(0.5).mul(this.uGrain);
        const ditherSeed = uvNode.mul(317.0).add(vec2(0.17, 0.31));
        const dither = fract(sin(dot(ditherSeed, vec2(127.1, 269.5))).mul(43758.5453))
            .sub(0.5).mul(this.uDither);

        const finalColor = clamp(
            graded.add(vec3(grain)).add(vec3(dither)),
            float(0.0),
            float(1.0),
        );
        this.postProcessing.outputNode = vec4(finalColor, 1.0);
        this.postProcessing.needsUpdate = true;
    }

    isEnabled() {
        return this.postProcessing !== null;
    }

    setProfile(profile = {}) {
        if (!this.postProcessing) return;
        if (this.bloomNode?.strength && profile.bloomStrength !== undefined) {
            this.bloomNode.strength.value = profile.bloomStrength;
            this._baseBloom = profile.bloomStrength;
        }
        if (this.bloomNode?.radius && profile.bloomRadius !== undefined) {
            this.bloomNode.radius.value = profile.bloomRadius;
        }
        if (this.bloomNode?.threshold && profile.bloomThreshold !== undefined) {
            this.bloomNode.threshold.value = profile.bloomThreshold;
        }
        if (profile.exposure !== undefined) this.uExposure.value = profile.exposure;
        if (profile.contrast !== undefined) this.uContrast.value = profile.contrast;
        if (profile.saturation !== undefined) this.uSaturation.value = profile.saturation;
    }

    /** Per-frame runtime update. Pass a CACHED object — no per-frame allocation. */
    update(p = {}) {
        if (!this.postProcessing) return;
        if (p.time !== undefined) this.uTime.value = p.time;
        if (p.warmth !== undefined) this.uWarmth.value = p.warmth;
        if (p.warmTint) this.uWarmTint.value.copy(p.warmTint);
        if (p.sunScreen) this.uSunScreen.value.copy(p.sunScreen);
        if (p.sunVisible !== undefined) this.uSunVisible.value = p.sunVisible;
        if (p.bloomBoost !== undefined && this.bloomNode?.strength) {
            this.bloomNode.strength.value = (this._baseBloom ?? 0.85) + p.bloomBoost;
        }
        if (p.chromaBoost !== undefined) {
            this.uChromatic.value = (this._baseChromatic ?? 0.0013) + p.chromaBoost;
        }
        if (p.godrayBoost !== undefined) {
            this.uGodray.value = (this._baseGodray ?? 0.6) + p.godrayBoost;
        }
    }

    updateDynamic(p) {
        this.update(p);
    }

    // PostProcessing follows the renderer's drawing-buffer size automatically.
    setPixelRatio() {}

    setSize() {}

    render() {
        if (this.postProcessing) this.postProcessing.render();
    }

    dispose() {
        disposeBloomNodeDeep(this.bloomNode);
        this.postProcessing = null;
        this.bloomNode = null;
    }
}

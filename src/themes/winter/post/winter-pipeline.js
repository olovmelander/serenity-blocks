/* eslint-disable import/no-unresolved, camelcase */
/**
 * Winter AAA — Cinematic Temporal Post + Frost (Phase 3)
 *
 * Modern TSL post stack on THREE.PostProcessing (r181), modeled on the shipped
 * Electric Dreams V3 pipeline, winter-tuned. Replaces the old bloom + cold
 * vignette + 4-tap god-ray WinterPost.
 *
 * Stack (in order):
 *   1. MRT emissive bloom (only aurora / moon / ice glints bloom)
 *   2. Gust motion-streak (cheap directional blur, gated on gust strength)
 *   3. Chromatic aberration (radial, scales toward edges + with storm)
 *   4. Cold vignette
 *   5. ACES filmic tonemap + COLD winter grade (blue shadow lift) + sat/contrast
 *   6. ★ Screen-edge frost crystallization (grows inward with storm intensity)
 *   7. Film grain + dither (anti-banding)
 *
 * Deferred (documented follow-up, needs in-browser tuning): true depth-aware
 * bokeh DOF — the snow material already does a per-particle depth-softening
 * (winter-materials.js), so this stack ships without a screen-space DOF pass.
 *
 * See docs/WINTER_AAA_PLAN.md §3.3.
 */

import * as THREE from 'three/webgpu';
import {
    clamp,
    dot,
    emissive,
    float,
    fract,
    length,
    max,
    min,
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
    mx_noise_float,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { disposeBloomNodeDeep } from '../../shared/bloom-dispose.js';

export class WinterPipeline {
    constructor(renderer, scene, camera, params = {}) {
        this.renderer = renderer;
        this.scene = scene;
        this.camera = camera;
        this.useMRT = params.useMRT ?? true;
        this.bloomScale = params.bloomScale ?? 0.6;
        this.size = { width: 0, height: 0 };

        this.postProcessing = new THREE.PostProcessing(renderer);
        const scenePass = pass(scene, camera);
        this.scenePass = scenePass;

        let bloomSource;
        if (this.useMRT) {
            scenePass.setMRT(mrt({ output, emissive }));
            bloomSource = scenePass.getTextureNode('emissive');
        } else {
            bloomSource = scenePass.getTextureNode('output');
        }
        const sceneColor = scenePass.getTextureNode('output');

        this.bloomNode = bloom(
            bloomSource,
            params.bloomStrength ?? 0.2,
            params.bloomRadius ?? 0.5,
            params.bloomThreshold ?? 0.7,
        );

        // --- Runtime uniforms ---
        this.uTime = uniform(0);
        this.uExposure = uniform(params.exposure ?? 0.82);
        this.uContrast = uniform(params.contrast ?? 1.18);
        this.uSaturation = uniform(params.saturation ?? 1.12);
        this.uVignetteDarkness = uniform(params.vignetteDarkness ?? 0.62);
        this.uChromaticStrength = uniform(params.chromaticStrength ?? 0.0011);
        this.uGrainStrength = uniform(params.grainStrength ?? 0.0026);
        this.uDitherStrength = uniform(params.ditherStrength ?? 0.002);
        this.uColdStrength = uniform(params.coldStrength ?? 0.35);
        // Gust motion-streak
        this.uMotionVec = uniform(new THREE.Vector2(1, 0));
        this.uMotionStrength = uniform(0); // 0..~0.02 in UV
        // Frost crystallization (screen-edge)
        this.uFrost = uniform(0); // 0..1 reach inward from edges
        this.uFrostColor = uniform(params.frostColor ?? new THREE.Color(0.78, 0.9, 1.0));

        const uv = viewportUV;
        const centered = uv.sub(vec2(0.5, 0.5));
        const dist = length(centered);

        // --- 2. Gust motion-streak: average a few taps along the wind vector ---
        const step = this.uMotionVec.mul(this.uMotionStrength);
        const m0 = sceneColor.sample(uv);
        const m1 = sceneColor.sample(uv.add(step));
        const m2 = sceneColor.sample(uv.sub(step));
        const m3 = sceneColor.sample(uv.add(step.mul(2.0)));
        const streaked = m0.add(m1).add(m2).add(m3).mul(0.25);

        // --- 3. Chromatic aberration (radial, stronger at edges) ---
        const edgeBoost = float(1.0).add(dist.mul(0.6));
        const chromaOffset = centered.mul(this.uChromaticStrength).mul(edgeBoost);
        const sampleR = sceneColor.sample(uv.add(chromaOffset)).r;
        const sampleB = sceneColor.sample(uv.sub(chromaOffset)).b;
        const chroma = vec4(sampleR, streaked.g, sampleB, streaked.a);

        const withBloom = chroma.add(this.bloomNode);

        // --- 4. Cold vignette ---
        const vignetteFactor = smoothstep(0.92, 0.4, dist);
        const vignetted = mix(
            withBloom.rgb.mul(float(1.0).sub(this.uVignetteDarkness)),
            withBloom.rgb,
            vignetteFactor,
        );

        // --- 5. ACES filmic tonemap ---
        const exposed = vignetted.mul(this.uExposure);
        const acesNum = exposed.mul(exposed.mul(2.51).add(0.03));
        const acesDen = exposed.mul(exposed.mul(2.43).add(0.59)).add(0.14);
        // NOTE: plain `let` reassignment (no .toVar()/.assign()) — this graph is
        // built at top level, not inside an Fn(), so .assign() has no TSL stack.
        let toned = clamp(acesNum.div(acesDen), 0.0, 1.0);

        // Cold winter grade: cool the whole image + lift shadows toward blue.
        const coolTint = vec3(0.92, 0.98, 1.08);
        const shadowLift = float(1.0).sub(smoothstep(0.0, 0.45, dot(toned, vec3(0.299, 0.587, 0.114))));
        toned = mix(toned, toned.mul(coolTint), this.uColdStrength);
        toned = toned.add(vec3(0.0, 0.012, 0.03).mul(shadowLift).mul(this.uColdStrength));

        // Saturation (luma-preserving) + contrast around mid.
        const luma = dot(toned, vec3(0.2126, 0.7152, 0.0722));
        const contrastGraded = mix(vec3(luma), toned, this.uSaturation).sub(0.5).mul(this.uContrast).add(0.5);
        // Winter is intentionally a night scene. Keep a tiny cold shadow floor
        // after contrast so the sky does not collapse to pure black in linear
        // WebGPU post while still leaving headroom for storm whiteout peaks.
        const shadowMask = float(1.0).sub(smoothstep(0.02, 0.22, luma));
        const shadowFloor = vec3(0.006, 0.01, 0.02).mul(float(0.55).add(this.uColdStrength.mul(0.2)));
        const graded = max(contrastGraded, shadowFloor.mul(shadowMask));

        // --- 6. ★ Screen-edge frost crystallization ---
        // Distance to nearest screen edge (0 at edge → 0.5 at center).
        const edgeDist = min(min(uv.x, float(1.0).sub(uv.x)), min(uv.y, float(1.0).sub(uv.y)));
        const frostAmt = clamp(this.uFrost, 0.0, 1.0);
        // Reach: 1 at the very edge → 0 by `frostReach` inward. Use a guarded
        // division (denominator always > 0) — NOT smoothstep(front,front,..),
        // which divides by zero when frost is 0 → NaN → white screen.
        const frostReach = float(0.02).add(frostAmt.mul(0.38));
        const reach = clamp(float(1.0).sub(edgeDist.div(frostReach)), 0.0, 1.0);
        // Feathery crystalline pattern (layered noise → fern-like fronds).
        const fr1 = mx_noise_float(vec3(uv.mul(38.0), this.uTime.mul(0.05))).mul(0.5).add(0.5);
        const fr2 = mx_noise_float(vec3(uv.mul(120.0), this.uTime.mul(0.02))).mul(0.5).add(0.5);
        const crystal = clamp(fr1.mul(0.65).add(fr2.mul(0.35)), 0.0, 1.0);
        const frostMask = reach.mul(smoothstep(0.35, 0.95, crystal)).mul(frostAmt);
        const frosted = mix(
            graded,
            max(graded, vec3(this.uFrostColor.r, this.uFrostColor.g, this.uFrostColor.b)),
            frostMask.mul(0.85),
        );

        // --- 7. Film grain + dither ---
        const grainSeed = uv.mul(132.0).add(vec2(this.uTime.mul(0.73), this.uTime.mul(1.17)));
        const grain = fract(sin(dot(grainSeed, vec2(12.9898, 78.233))).mul(43758.5453))
            .sub(0.5).mul(this.uGrainStrength);
        const ditherSeed = uv.mul(317.0).add(vec2(0.17, 0.31));
        const dither = fract(sin(dot(ditherSeed, vec2(127.1, 269.5))).mul(43758.5453))
            .sub(0.5).mul(this.uDitherStrength);

        const finalColor = clamp(frosted.add(vec3(grain)).add(vec3(dither)), 0.0, 1.0);
        this.postProcessing.outputNode = vec4(finalColor, 1.0);
        this.postProcessing.needsUpdate = true;
    }

    /** Static-ish params (bloom mostly). Kept compatible with the old WinterPost. */
    updateParams(params = {}) {
        if (params.bloomStrength !== undefined) this.bloomNode.strength.value = params.bloomStrength;
        if (params.bloomRadius !== undefined) this.bloomNode.radius.value = params.bloomRadius;
        if (params.bloomThreshold !== undefined) this.bloomNode.threshold.value = params.bloomThreshold;
        if (params.bloomScale !== undefined) {
            this.bloomScale = params.bloomScale;
            this._resizeBloom();
        }
    }

    /**
     * Per-frame storm-driven params. Pass a cached object — no per-frame allocs.
     *   { time, intensity, whiteout, gust, motionX, motionY }
     */
    updateDynamic(p = {}) {
        if (p.time !== undefined) this.uTime.value = p.time;
        if (p.intensity !== undefined) {
            // Storm pushes chromatic aberration + a touch of cold grade.
            this.uChromaticStrength.value = 0.0009 + p.intensity * 0.0020 + (p.whiteout || 0) * 0.0018;
            this.uColdStrength.value = 0.3 + p.intensity * 0.18 + (p.whiteout || 0) * 0.15;
        }
        if (p.whiteout !== undefined) {
            // Whiteout slightly dims exposure and pushes frost.
            this.uExposure.value = 1.0 - Math.min(0.12, (p.whiteout || 0) * 0.12);
        }
        if (p.frost !== undefined) this.uFrost.value = Math.min(1, Math.max(0, p.frost));
        if (p.motionX !== undefined && p.motionY !== undefined && this.uMotionVec.value) {
            this.uMotionVec.value.set(p.motionX, p.motionY);
        }
        if (p.gust !== undefined) {
            this.uMotionStrength.value = Math.min(0.02, Math.max(0, p.gust) * 0.014);
        }
    }

    updateTime(time) {
        this.uTime.value = time;
    }

    render() {
        this.postProcessing.render();
    }

    _resizeBloom() {
        if (this.size.width > 0 && this.bloomNode?._separableBlurMaterials?.length) {
            const w = Math.max(1, Math.floor(this.size.width * this.bloomScale));
            const h = Math.max(1, Math.floor(this.size.height * this.bloomScale));
            this.bloomNode.setSize(w, h);
        }
    }

    setSize(width, height) {
        this.size.width = width;
        this.size.height = height;
        this.scenePass.setSize(width, height);
        this._resizeBloom();
    }

    dispose() {
        this.scenePass.dispose();
        disposeBloomNodeDeep(this.bloomNode);
        this.postProcessing.dispose();
    }
}

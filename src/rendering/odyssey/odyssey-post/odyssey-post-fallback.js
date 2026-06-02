/**
 * @fileoverview OdysseyFallbackPipeline — WebGL cinematic post for the board
 *
 * Part of the Odyssey AAA "Cosmic Ascent" overhaul (Phase 1 — rendering core).
 * See docs/ODYSSEY_MODE_AAA_OVERHAUL_PLAN.md §4.1.
 *
 * WHY THIS IS THE PRIMARY PATH (not a "fallback") FOR NOW: the board's content is
 * 42 raw GLSL ShaderMaterials (path + nodes + all 8 chapter environments). A WebGPU
 * backend (three/webgpu WebGPURenderer) renders only TSL node materials, so the
 * renderer swap cannot happen until those materials are converted to TSL (the work
 * of Phases 2–4). Until then the board stays on THREE.WebGLRenderer, and this
 * pipeline delivers the P1 "world-class filmic finish" on it.
 *
 * It extends the existing PostProcessingStack — reusing its bloom + chromatic
 * aberration + vignette + film-grain passes and the chapter-seam FX-boost API —
 * and inserts one extra pass that is the heart of the upgrade:
 *
 *     RenderPass → Bloom → [EXPOSURE → ACES tonemap → per-chapter GRADE] → CA → Vignette → Grain
 *
 * The new ToneGrade pass is what the board has been missing: a consistent filmic
 * tonemap (the board had NONE — highlights just clipped) plus a director-driven
 * exposure + grade that warms/intensifies the whole frame with journey energy.
 * Placing it after bloom also tames the previously blown-out full-screen bloom.
 *
 * All director-driven values come from OdysseyDirector.getState() via update().
 * If no director state is supplied, it renders a neutral ACES pass (exposure 1,
 * grade 0), so it is always safe.
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import {
    PostProcessingStack,
    ChromaticAberrationShader,
    VignetteShader,
    FilmGrainShader,
} from '../effects/PostProcessingStack.js';

// ACES tends to brighten low-mids and roll off highlights; a small base exposure
// keeps the graded frame punchy. Combined with the per-chapter exposure from the
// director (1.0–1.2). Tunable in-browser via ?odysseyAAA=1.
const BASE_EXPOSURE = 1.1;

// ═══════════════════════════════════════════════════════════════════════════════
// TONE + GRADE SHADER — exposure → ACES (Narkowicz) → subtle director-driven grade
// ═══════════════════════════════════════════════════════════════════════════════

const ToneGradeShader = {
    uniforms: {
        tDiffuse: { value: null },
        uExposure: { value: 1.0 },
        uGrade: { value: 0.0 }, // 0 calm → 1 intensified (from director.post.grade)
        uTint: { value: new THREE.Color(1, 1, 1) }, // world key-light color
    },
    vertexShader: `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float uExposure;
        uniform float uGrade;
        uniform vec3 uTint;
        varying vec2 vUv;

        // Narkowicz 2015 ACES filmic approximation.
        vec3 aces(vec3 x) {
            const float a = 2.51;
            const float b = 0.03;
            const float c = 2.43;
            const float d = 0.59;
            const float e = 0.14;
            return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
        }

        void main() {
            vec4 src = texture2D(tDiffuse, vUv);

            // Exposure then filmic tonemap (fixes clipped highlights / blown bloom).
            vec3 color = aces(src.rgb * uExposure);

            // Gentle, energy-driven grade: a touch of saturation + a warm/world tint
            // push + a small contrast lift. All scaled by uGrade so idle stays neutral.
            float luma = dot(color, vec3(0.299, 0.587, 0.114));
            vec3 saturated = mix(vec3(luma), color, 1.0 + uGrade * 0.18);
            vec3 tinted = mix(saturated, saturated * uTint, uGrade * 0.12);
            vec3 graded = mix(vec3(0.5), tinted, 1.0 + uGrade * 0.07);

            gl_FragColor = vec4(clamp(graded, 0.0, 1.0), src.a);
        }
    `,
};

export class OdysseyFallbackPipeline extends PostProcessingStack {
    /**
     * Build the composer chain. Overrides PostProcessingStack.initialize() so the
     * ToneGrade pass lands directly after bloom and before CA/vignette/grain.
     * (Called by the parent constructor — runs before subclass field initializers,
     * so it only touches `this.passes` / `this.composer`, which the parent sets up.)
     */
    initialize() {
        const width = this.renderer.domElement.clientWidth;
        const height = this.renderer.domElement.clientHeight;

        this.composer = new EffectComposer(this.renderer);

        // 1. Base scene.
        const renderPass = new RenderPass(this.scene, this.camera);
        this.composer.addPass(renderPass);
        this.passes.render = renderPass;

        // 2. Bloom (kept selective via UnrealBloom's luminance threshold; ACES below
        //    rolls off the bright additions so it no longer blows out the frame).
        if (this.qualitySettings.bloom) {
            const bloomPass = new UnrealBloomPass(
                new THREE.Vector2(width, height),
                this.qualitySettings.bloomStrength || 0.5,
                0.4,
                0.85,
            );
            this.composer.addPass(bloomPass);
            this.passes.bloom = bloomPass;
        }

        // 3. Tone + grade (the P1 upgrade — exposure → ACES → director grade).
        const toneGradePass = new ShaderPass(ToneGradeShader);
        this.composer.addPass(toneGradePass);
        this.passes.toneGrade = toneGradePass;

        // 4. Chromatic aberration.
        if (this.qualitySettings.chromatic) {
            const chromaticPass = new ShaderPass(ChromaticAberrationShader);
            chromaticPass.uniforms.uStrength.value = this.qualitySettings.chromaticStrength || 0.003;
            this.composer.addPass(chromaticPass);
            this.passes.chromatic = chromaticPass;
        }

        // 5. Vignette.
        if (this.qualitySettings.vignette) {
            const vignettePass = new ShaderPass(VignetteShader);
            vignettePass.uniforms.uIntensity.value = this.qualitySettings.vignetteIntensity || 0.4;
            this.composer.addPass(vignettePass);
            this.passes.vignette = vignettePass;
        }

        // 6. Film grain (last, subtle overlay).
        if (this.qualitySettings.filmGrain) {
            const grainPass = new ShaderPass(FilmGrainShader);
            grainPass.uniforms.uIntensity.value = this.qualitySettings.filmGrainIntensity || 0.08;
            this.composer.addPass(grainPass);
            this.passes.grain = grainPass;
        }

        // Remember the authored bloom base so per-frame director multipliers don't
        // compound (the parent's update() also writes bloom.strength).
        this._baseBloomStrength = this.qualitySettings.bloomStrength || 0.5;
    }

    /**
     * @param {number} deltaTime
     * @param {object} [directorState] - OdysseyDirector.getState()
     */
    update(deltaTime, directorState = null) {
        // Parent handles grain time + seam-boost decay + base+boost on bloom/CA/vignette.
        super.update(deltaTime);

        const s = directorState;

        // Layer the director's energy-driven bloom multiplier on top of base+boost.
        if (this.passes.bloom) {
            const base = this._baseBloomStrength || this.qualitySettings.bloomStrength || 0.5;
            const boost = this.passes.bloom.strength - base; // seam boost the parent applied
            const mul = s?.post?.bloom ? Math.max(0, s.post.bloom) : 1;
            this.passes.bloom.strength = (base * mul) + Math.max(0, boost);
        }

        // Drive the tone/grade pass from director atmosphere + post emphasis.
        if (this.passes.toneGrade) {
            const u = this.passes.toneGrade.uniforms;
            const exposure = s?.atmosphere?.exposure ? s.atmosphere.exposure : 1;
            u.uExposure.value = BASE_EXPOSURE * exposure;
            u.uGrade.value = s?.post?.grade ? THREE.MathUtils.clamp(s.post.grade, 0, 1) : 0;
            const tint = s?.atmosphere?.lightColor;
            if (tint && typeof tint.r === 'number') {
                // Bias the tint toward white so the grade stays gentle, never a wash.
                u.uTint.value.setRGB(
                    0.5 + tint.r * 0.5,
                    0.5 + tint.g * 0.5,
                    0.5 + tint.b * 0.5,
                );
            }
        }
    }
}

export default OdysseyFallbackPipeline;

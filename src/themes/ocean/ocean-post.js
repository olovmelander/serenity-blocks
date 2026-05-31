/* eslint-disable import/no-extraneous-dependencies, import/no-unresolved, max-classes-per-file */
/**
 * Ocean Theme — Post-Processing
 *
 * WebGPU path: THREE.PostProcessing + MRT(output, emissive) + bloom +
 *   linear-depth absorption fog + TSL Loop god rays + chromatic aberration +
 *   ACES tonemap + Abzu grade + vignette + Extreme-only DOF.
 *
 * WebGL path: Legacy EffectComposer (color grade + optional bloom).
 */

// ═══════════════════════════════════════════════════════════════════════════════
// WebGPU TSL Post (primary pipeline)
// ═══════════════════════════════════════════════════════════════════════════════

import * as THREE from 'three';
import * as THREE_GPU from 'three/webgpu';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import {
    abs,
    clamp,
    dot,
    emissive,
    float,
    fract,
    int,
    length,
    Loop,
    max,
    mix,
    mrt,
    output,
    pass,
    perspectiveDepthToViewZ,
    sin,
    smoothstep,
    uniform,
    vec4,
    vec2,
    vec3,
    viewportUV,
    viewZToOrthographicDepth,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { chromaticAberration } from 'three/addons/tsl/display/ChromaticAberrationNode.js';

// 5-tap Poisson disc sample offsets (unit disc)
const POISSON_TAPS = [
    [0.0, 0.0],
    [0.55, 0.13],
    [-0.42, 0.48],
    [-0.32, -0.55],
    [0.31, -0.62],
];

export class OceanPost {
    constructor(renderer, scene, camera, params = {}) {
        this.renderer = renderer;
        this.useMRT = params.useMRT ?? true;
        this.sceneScale = params.sceneScale ?? 1.0;
        this.bloomScale = params.bloomScale ?? 0.6;
        this.postProcessing = new THREE_GPU.PostProcessing(renderer);

        // Scene pass + MRT
        this.scenePass = pass(scene, camera);
        if (this.useMRT) {
            this.scenePass.setMRT(mrt({ output, emissive }));
        }

        const sceneColor = this.scenePass.getTextureNode('output');
        const depthTexture = this.scenePass.getTextureNode('depth');
        const bloomSource = this.useMRT ? this.scenePass.getTextureNode('emissive') : sceneColor;

        // Bloom — bumped strength + lowered threshold so warm coral tips and
        // god-ray motes contribute. Matches the reference photo's bright glow.
        this.bloomNode = bloom(
            bloomSource,
            params.bloomStrength ?? 0.32,
            params.bloomRadius ?? 0.5,
            params.bloomThreshold ?? 0.78,
        );

        // Uniforms — daylight tuning, dialed back from the initial overshoot.
        // Exposure modest, absorption fog restored enough to give distance
        // some saturation drop, god-ray strength kept, vignette restored
        // enough to frame the brightness. Tuned to land between the original
        // moody dim and the washed-out daylit pass.
        this.uTime = uniform(0);
        this.uExposure = uniform(params.exposure ?? 1.08);
        this.uGradeStrength = uniform(params.gradeStrength ?? 0.85);
        this.uVignetteDarkness = uniform(params.vignetteDarkness ?? 0.18);
        this.uVignetteOffset = uniform(params.vignetteOffset ?? 1.12);
        this.uFogDensity = uniform(params.fogDensity ?? 0.34);
        this.uCameraNear = uniform(camera.near);
        this.uCameraFar = uniform(camera.far);
        this.uShaftStrength = uniform(params.shaftStrength ?? 0.55);
        this.uSunScreen = uniform(params.sunScreen ?? new THREE.Vector2(0.5, 1.0));
        this.uShaftSamples = int(params.shaftSamples ?? 8);
        // Phase 4: edge-pinch chromatic aberration
        this.uChromaStrength = uniform(params.chromaStrength ?? 0.0);
        // Base chroma is preserved so surge-driven boosts are added on top.
        this.baseChromaStrength = params.chromaStrength ?? 0.0;
        this.chromaSurgeBoost = params.chromaSurgeBoost ?? 0.022;
        this.chromaticAberrationEnabled = params.chromaticAberrationEnabled !== false;
        // Real screen-space surface refraction. Kept subtle so the theme stays readable.
        this.uRefractionStrength = uniform(
            params.refractionEnabled === false ? 0.0 : (params.refractionStrength ?? 0.0),
        );
        this.uGameplayPulse = uniform(params.gameplayPulse ?? 0.0);
        this.uComboSurge = uniform(params.comboSurge ?? 0.0);
        this.uCausticSweepStrength = uniform(params.causticSweepStrength ?? 0.0);
        // Phase 6: variable-radius DOF (Extreme only), driven by normalized scene depth.
        this.uDofStrength = uniform(params.dofStrength ?? 0.0);
        this.uFocalDepth = uniform(params.focalDepth ?? 0.55);
        this.uDofMaxRadius = uniform(params.dofMaxRadius ?? 0.012);
        this.uDofDeadZone = uniform(params.dofDeadZone ?? 0.035);

        const uv = viewportUV;
        const centered = uv.sub(0.5).mul(2.0);
        const dist = length(centered);
        // Daylit absorption color — distance fades to a deeper saturated
        // cyan so the falloff still feels like underwater depth, not flat
        // overcast haze. Sits between the original cobalt and the earlier
        // too-bright pale cyan.
        const deepWater = vec3(0.10, 0.40, 0.58);

        const getLinearDepth = (sampleUv) => {
            const depthSample = depthTexture.sample(sampleUv).x;
            const viewZ = perspectiveDepthToViewZ(depthSample, this.uCameraNear, this.uCameraFar);
            return clamp(
                viewZToOrthographicDepth(viewZ, this.uCameraNear, this.uCameraFar),
                float(0.0),
                float(1.0),
            );
        };

        const sampleAbsorbed = (sampleUv) => {
            const sample = sceneColor.sample(sampleUv);
            const linearDepth = getLinearDepth(sampleUv);
            const absorption = clamp(
                smoothstep(float(0.1), float(1.0), linearDepth).mul(this.uFogDensity),
                float(0.0),
                float(0.68),
            );
            return vec4(mix(sample.rgb, deepWater, absorption), sample.a);
        };

        const directSample = sampleAbsorbed(uv);

        // Screen-space refraction (Medium quality and below skip this)
        const refractionEnabled = params.refractionEnabled === true;
        let baseSample;
        if (refractionEnabled) {
            const surfaceMask = smoothstep(float(0.52), float(0.95), uv.y).mul(
                float(1.0).sub(smoothstep(float(0.985), float(1.0), uv.y)),
            );
            const refractionMask = clamp(
                surfaceMask.mul(this.uRefractionStrength),
                float(0.0),
                float(1.0),
            );
            const gameplayRefractionMask = clamp(
                surfaceMask.mul(this.uGameplayPulse).mul(0.45),
                float(0.0),
                float(0.5),
            );
            const refractionDrive = clamp(
                refractionMask.add(gameplayRefractionMask),
                float(0.0),
                float(1.0),
            );
            const refractionOffset = vec2(
                sin(uv.y.mul(34.0).add(this.uTime.mul(0.72))).mul(0.0028),
                sin(uv.x.mul(26.0).sub(this.uTime.mul(0.58))).mul(0.0017),
            ).mul(refractionDrive);
            const refractedSample = sampleAbsorbed(
                clamp(uv.add(refractionOffset), vec2(0.0), vec2(1.0)),
            );
            baseSample = mix(
                directSample,
                refractedSample,
                clamp(
                    refractionMask.mul(0.62).add(gameplayRefractionMask.mul(0.7)),
                    float(0.0),
                    float(0.78),
                ),
            );
        } else {
            baseSample = directSample;
        }

        const baseDepth = getLinearDepth(uv);

        const gameplayWave = sin(uv.x.mul(42.0).add(this.uTime.mul(3.2))).mul(
            sin(uv.y.mul(29.0).sub(this.uTime.mul(2.6))),
        );
        const gameplayCaustic = smoothstep(float(0.64), float(1.0), gameplayWave.mul(0.5).add(0.5))
            .mul(smoothstep(float(0.08), float(0.72), uv.y))
            .mul(float(1.0).sub(smoothstep(float(0.94), float(1.0), uv.y)))
            .mul(this.uCausticSweepStrength);

        // ── DOF (Phase 6, Extreme only) ──
        const dofEnabled = params.dofEnabled === true;
        let focusPick;
        if (dofEnabled) {
            // Variable-radius 5-tap Poisson sampling around a normalized scene-depth focal plane.
            const dofMissDist = max(
                abs(baseDepth.sub(this.uFocalDepth)).sub(this.uDofDeadZone),
                float(0.0),
            );
            const dofRadius = clamp(dofMissDist.mul(this.uDofStrength), float(0.0), this.uDofMaxRadius);
            let dofAccum = vec3(0.0);
            for (let i = 0; i < POISSON_TAPS.length; i += 1) {
                const [tx, ty] = POISSON_TAPS[i];
                const offset = vec2(float(tx), float(ty)).mul(dofRadius);
                dofAccum = dofAccum.add(sampleAbsorbed(uv.add(offset)).rgb);
            }
            const dofSampled = dofAccum.mul(float(1.0 / POISSON_TAPS.length));
            const sharpSampled = baseSample.rgb;
            const dofWeight = clamp(
                dofRadius.div(this.uDofMaxRadius.add(float(0.0001))),
                float(0.0),
                float(1.0),
            );
            focusPick = vec4(mix(sharpSampled, dofSampled, dofWeight), baseSample.a);
        } else {
            focusPick = baseSample;
        }

        // ── Edge-pinch chromatic aberration (Phase 4) ──
        // Stronger at the screen edges — looking through a water lens. We feed the
        // already-DOF-blurred scene into the canonical chromaticAberration node so
        // the two effects compose naturally.
        const chromated = chromaticAberration(focusPick, this.uChromaStrength, vec2(0.5, 0.5), 1.1);

        // ── God rays (TSL Loop) ──
        // WS 2.1: per-pixel hash dither on the start offset hides banding when
        // sample count is reduced (Extreme 10→8). The bloom-source feed is
        // soft, so randomizing positions becomes high-freq noise the eye
        // tonemaps as additional shimmer rather than visible bands.
        const shaftsEnabled = (params.shaftStrength ?? 0) > 0 && (params.shaftSamples ?? 0) > 0;
        const shafts = (() => {
            if (!shaftsEnabled) return vec3(0.0);
            const shaftDir = this.uSunScreen.sub(uv);
            const shaftStep = float(0.08);
            const dither = fract(sin(dot(uv, vec2(12.9898, 78.233))).mul(43758.5453));
            const sum = vec3(0.0).toVar();
            Loop(
                {
                    start: int(0),
                    end: this.uShaftSamples,
                    type: 'int',
                    condition: '<',
                },
                ({ i }) => {
                    const t = float(i).add(dither);
                    const sampleUv = clamp(
                        uv.add(shaftDir.mul(shaftStep).mul(t)),
                        vec2(0.0),
                        vec2(1.0),
                    );
                    const sample = bloomSource.sample(sampleUv).rgb;
                    const luma = dot(sample, vec3(0.2126, 0.7152, 0.0722));
                    const weight = float(1.0).sub(t.div(float(this.uShaftSamples)));
                    sum.addAssign(
                        sample.mul(weight).mul(smoothstep(float(0.05), float(0.3), luma)),
                    );
                },
            );
            return sum;
        })();
        // Warm gold tint for god rays
        const shaftColor = shaftsEnabled
            ? shafts.mul(this.uShaftStrength.add(this.uComboSurge.mul(0.7))).mul(vec3(1.0, 0.88, 0.62))
            : vec3(0.0);

        // ── Vignette ──
        const vignette = smoothstep(this.uVignetteOffset, this.uVignetteOffset.sub(0.5), dist);
        const vignetteColor = mix(
            chromated.mul(float(1.0).sub(this.uVignetteDarkness)),
            chromated,
            vignette,
        );

        // ── Combine: scene + god rays + bloom ──
        // bloomNode outputs a vec4; adding it to a vec3 is fine (xyz channels combine).
        const combined = vignetteColor.add(vec4(shaftColor, float(0.0))).add(this.bloomNode);

        // ── Exposure ──
        const exposed = combined.rgb.mul(this.uExposure);

        // ── ACES Filmic Tonemap ──
        const acesA = float(2.51);
        const acesB = float(0.03);
        const acesC = float(2.43);
        const acesD = float(0.59);
        const acesE = float(0.14);
        const acesNum = exposed.mul(exposed.mul(acesA).add(acesB));
        const acesDen = exposed.mul(exposed.mul(acesC).add(acesD)).add(acesE);
        let graded = clamp(acesNum.div(acesDen), float(0.0), float(1.0));

        // ── Abzu-inspired split-tone grade ──
        // Strong teal shadows / warm gold highlights with punchy contrast — the
        // tonemap output is otherwise too uniform-cyan to read as "underwater
        // sanctuary". Push the split harder than a typical desaturated grade.
        const luma = dot(graded, vec3(0.2126, 0.7152, 0.0722));

        const shadowTint = vec3(0.0, 0.08, 0.20);
        const shadowMask = float(1.0).sub(smoothstep(float(0.05), float(0.42), luma));
        graded = graded.add(shadowTint.mul(shadowMask.mul(0.32)).mul(this.uGradeStrength));

        const warmHighlight = vec3(0.40, 0.30, 0.10);
        const highlightMask = smoothstep(float(0.42), float(0.92), luma);
        graded = graded.add(warmHighlight.mul(highlightMask.mul(0.14)).mul(this.uGradeStrength));
        graded = graded.add(vec3(0.12, 0.18, 0.22).mul(gameplayCaustic.mul(0.35)));
        graded = graded.add(
            vec3(0.12, 0.08, 0.04).mul(highlightMask).mul(this.uComboSurge.mul(0.28)),
        );

        const midBlue = vec3(0.01, 0.14, 0.28);
        graded = graded.add(
            midBlue.mul(float(1.0).sub(highlightMask)).mul(0.10).mul(this.uGradeStrength),
        );
        const surfaceAzureLift = smoothstep(float(0.52), float(1.0), uv.y)
            .mul(float(1.0).sub(shadowMask))
            .mul(this.uGradeStrength);
        graded = graded.add(vec3(0.02, 0.12, 0.24).mul(surfaceAzureLift.mul(0.12)));

        // Punchier contrast — the previous 1.12 was too soft for AAA-style depth.
        // Increased to 1.18 for better silhouette separation.
        graded = mix(graded, graded.sub(0.5).mul(1.18).add(0.5), this.uGradeStrength);

        this.postProcessing.outputNode = vec4(graded, combined.a);
        this.postProcessing.needsUpdate = true;
        this.size = { width: 0, height: 0 };
    }

    /**
     * Returns the scene pass so other systems (e.g. water surface refraction)
     * can sample the rendered scene texture inside their own materials.
     */
    getScenePass() {
        return this.scenePass;
    }

    updateTime(time) {
        this.uTime.value = time;
    }

    updateParams(params = {}) {
        if (params.bloomStrength !== undefined && this.bloomNode?.strength) {
            this.bloomNode.strength.value = params.bloomStrength;
        }
        if (params.bloomRadius !== undefined) this.bloomNode.radius.value = params.bloomRadius;
        if (params.bloomThreshold !== undefined) this.bloomNode.threshold.value = params.bloomThreshold;
        if (params.exposure !== undefined) this.uExposure.value = params.exposure;
        if (params.gradeStrength !== undefined) this.uGradeStrength.value = params.gradeStrength;
        if (params.vignetteDarkness !== undefined) this.uVignetteDarkness.value = params.vignetteDarkness;
        if (params.vignetteOffset !== undefined) this.uVignetteOffset.value = params.vignetteOffset;
        if (params.shaftStrength !== undefined) this.uShaftStrength.value = params.shaftStrength;
        if (params.fogDensity !== undefined) this.uFogDensity.value = params.fogDensity;
        if (params.chromaStrength !== undefined) {
            this.baseChromaStrength = params.chromaStrength;
            this.uChromaStrength.value = params.chromaStrength;
        }
        if (params.chromaSurgeBoost !== undefined) {
            this.chromaSurgeBoost = params.chromaSurgeBoost;
        }
        if (params.chromaticAberrationEnabled !== undefined) {
            this.chromaticAberrationEnabled = params.chromaticAberrationEnabled === true;
        }
        if (params.refractionEnabled !== undefined || params.refractionStrength !== undefined) {
            this.uRefractionStrength.value = params.refractionEnabled === false
                ? 0.0
                : (params.refractionStrength ?? this.uRefractionStrength.value);
        }
        if (params.gameplayPulse !== undefined) this.uGameplayPulse.value = params.gameplayPulse;
        if (params.comboSurge !== undefined) {
            this.uComboSurge.value = params.comboSurge;
            const surgeBoost = this.chromaticAberrationEnabled
                ? Math.max(0, params.comboSurge - 0.55) * this.chromaSurgeBoost
                : 0;
            this.uChromaStrength.value = this.baseChromaStrength + surgeBoost;
        }
        if (params.causticSweepStrength !== undefined) this.uCausticSweepStrength.value = params.causticSweepStrength;
        if (params.dofStrength !== undefined) this.uDofStrength.value = params.dofStrength;
        if (params.focalDepth !== undefined) this.uFocalDepth.value = params.focalDepth;
        if (params.dofMaxRadius !== undefined) this.uDofMaxRadius.value = params.dofMaxRadius;
        if (params.dofDeadZone !== undefined) this.uDofDeadZone.value = params.dofDeadZone;
        if (params.sunScreen !== undefined) {
            const v = this.uSunScreen.value;
            if (v && typeof v.set === 'function') v.set(params.sunScreen.x, params.sunScreen.y);
        }
    }

    render() {
        this.postProcessing.render();
    }

    setSize(width, height) {
        this.size.width = width;
        this.size.height = height;
        const sceneWidth = Math.max(1, Math.floor(width * this.sceneScale));
        const sceneHeight = Math.max(1, Math.floor(height * this.sceneScale));
        this.scenePass.setSize(sceneWidth, sceneHeight);
        if (this.bloomNode?._separableBlurMaterials?.length) {
            const w = Math.max(1, Math.floor(sceneWidth * this.bloomScale));
            const h = Math.max(1, Math.floor(sceneHeight * this.bloomScale));
            this.bloomNode.setSize(w, h);
        }
    }

    dispose() {
        this.scenePass.dispose();
        this.bloomNode.dispose();
        this.postProcessing.dispose();
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// WebGL Legacy Post (fallback)
// ═══════════════════════════════════════════════════════════════════════════════

const OCEAN_GRADE_SHADER = {
    uniforms: {
        tDiffuse: { value: null },
        uTime: { value: 0 },
        uGlowIntensity: { value: 0.8 },
        uGradeStrength: { value: 0.92 },
        uVignette: { value: 0.25 },
        uSaturation: { value: 1.08 },
        uContrast: { value: 1.075 },
        uBlackLift: { value: 0.045 },
        uGameplayPulse: { value: 0 },
        uComboSurge: { value: 0 },
        uCausticSweepStrength: { value: 0 },
        uChromaEnabled: { value: 0 },
        uResolution: { value: new THREE.Vector2(1, 1) },
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
        uniform float uTime;
        uniform float uGlowIntensity;
        uniform float uGradeStrength;
        uniform float uVignette;
        uniform float uSaturation;
        uniform float uContrast;
        uniform float uBlackLift;
        uniform float uGameplayPulse;
        uniform float uComboSurge;
        uniform float uCausticSweepStrength;
        uniform float uChromaEnabled;
        uniform vec2 uResolution;
        varying vec2 vUv;

        void main() {
            vec2 px = 1.0 / max(uResolution, vec2(1.0));
            float surfaceGlow = smoothstep(0.58, 1.0, vUv.y);
            float gameplayRefraction = clamp(surfaceGlow * uGameplayPulse * 0.45, 0.0, 0.5);
            vec2 refractionOffset = vec2(
                sin(vUv.y * 34.0 + uTime * 0.72) * 1.8,
                sin(vUv.x * 26.0 - uTime * 0.58) * 1.1
            ) * px * gameplayRefraction;
            vec2 sampleUv = clamp(vUv + refractionOffset, vec2(0.0), vec2(1.0));
            vec4 texel = texture2D(tDiffuse, sampleUv);
            float chromaPixels = max(0.0, uComboSurge - 0.55) * uChromaEnabled * 3.5;
            if (chromaPixels > 0.0) {
                vec2 chromaOffset = px * chromaPixels * vec2(1.5, 0.9);
                texel.r = texture2D(tDiffuse, clamp(sampleUv + chromaOffset, vec2(0.0), vec2(1.0))).r;
                texel.b = texture2D(tDiffuse, clamp(sampleUv - chromaOffset, vec2(0.0), vec2(1.0))).b;
            }
            vec3 color = texel.rgb;

            float luminance = dot(color, vec3(0.299, 0.587, 0.114));
            vec3 graded = mix(vec3(luminance), color, uSaturation);
            graded = (graded - 0.5) * uContrast + 0.5;
            graded = max(graded, vec3(uBlackLift));

            vec3 shadowTint = vec3(0.0, 0.08, 0.115);
            vec3 midTeal = vec3(0.01, 0.17, 0.18);
            vec3 warmHighlight = vec3(0.18, 0.12, 0.045);
            float shadowMask = 1.0 - smoothstep(0.05, 0.46, luminance);
            float highlightMask = smoothstep(0.36, 0.92, luminance);
            graded += shadowTint * shadowMask * 0.1;
            graded += midTeal * (1.0 - highlightMask) * 0.055;
            graded += warmHighlight * highlightMask * 0.09;

            graded += vec3(0.025, 0.14, 0.135) * surfaceGlow * 0.11;

            float caustic = sin(vUv.x * 28.0 + uTime * 0.72) * sin(vUv.y * 19.0 - uTime * 0.46);
            float fine = sin((vUv.x + vUv.y) * 64.0 - uTime * 1.1);
            caustic = pow(max(caustic * 0.48 + fine * 0.08 + 0.5, 0.0), 8.5);
            graded += vec3(0.035, 0.18, 0.16) * caustic * (0.04 + uGlowIntensity * 0.018);
            float gameplayCaustic = sin(vUv.x * 42.0 + uTime * 3.2)
                * sin(vUv.y * 29.0 - uTime * 2.6);
            gameplayCaustic = smoothstep(0.64, 1.0, gameplayCaustic * 0.5 + 0.5)
                * smoothstep(0.08, 0.72, vUv.y)
                * (1.0 - smoothstep(0.94, 1.0, vUv.y));
            graded += vec3(0.08, 0.17, 0.12) * gameplayCaustic * uCausticSweepStrength * 0.45;
            graded += vec3(0.12, 0.065, 0.018) * uComboSurge * smoothstep(0.58, 1.0, luminance) * 0.32;
            graded += vec3(0.03, 0.13, 0.13) * uGameplayPulse * surfaceGlow * 0.16;

            float dist = length(vUv - 0.5);
            float vignette = smoothstep(0.82, 0.24, dist);
            graded *= mix(1.0 - uVignette, 1.0, vignette);
            graded += vec3(0.0, 0.028, 0.038) * smoothstep(0.66, 1.0, 1.0 - vUv.y);

            color = mix(color, graded, uGradeStrength);
            gl_FragColor = vec4(max(color, vec3(0.0)), texel.a);
        }
    `,
};

export class OceanPostProcessingLegacy {
    constructor({
        renderer, scene, camera, preset,
    }) {
        this.renderer = renderer;
        this.scene = scene;
        this.camera = camera;
        this.preset = preset;
        this.composer = null;
        this.gradePass = null;
        this.bloomPass = null;
        this.enabled = false;
    }

    init() {
        const post = this.preset?.postProcessing;
        if (!post?.grade && !post?.bloom) return;

        const width = window.innerWidth;
        const height = window.innerHeight;
        const pixelRatio = this.renderer.getPixelRatio();
        const renderTarget = new THREE.WebGLRenderTarget(width * pixelRatio, height * pixelRatio, {
            type: THREE.HalfFloatType,
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
            depthBuffer: true,
            stencilBuffer: false,
        });

        this.composer = new EffectComposer(this.renderer, renderTarget);
        this.composer.setPixelRatio(pixelRatio);
        this.composer.setSize(width, height);
        this.composer.addPass(new RenderPass(this.scene, this.camera));

        if (post.bloom) {
            this.bloomPass = new UnrealBloomPass(
                new THREE.Vector2(width * 0.5 * pixelRatio, height * 0.5 * pixelRatio),
                post.bloomStrength ?? 0.16,
                post.bloomRadius ?? 0.55,
                post.bloomThreshold ?? 0.78,
            );
            this.composer.addPass(this.bloomPass);
        }

        if (post.grade) {
            this.gradePass = new ShaderPass(OCEAN_GRADE_SHADER);
            this.gradePass.uniforms.uGradeStrength.value = post.gradeStrength ?? 0.92;
            this.gradePass.uniforms.uVignette.value = post.vignette ?? 0.25;
            this.gradePass.uniforms.uBlackLift.value = post.blackLift ?? 0.075;
            this.gradePass.uniforms.uResolution.value.set(width * pixelRatio, height * pixelRatio);
            this.composer.addPass(this.gradePass);
        }

        this.enabled = true;
    }

    resize(width, height) {
        if (!this.composer) return;
        const pixelRatio = this.renderer.getPixelRatio();
        this.composer.setPixelRatio(pixelRatio);
        this.composer.setSize(width, height);
        this.bloomPass?.setSize(width * 0.5 * pixelRatio, height * 0.5 * pixelRatio);
        this.gradePass?.uniforms?.uResolution?.value?.set(width * pixelRatio, height * pixelRatio);
    }

    updateParams(params = {}) {
        if (this.gradePass?.uniforms) {
            if (params.gameplayPulse !== undefined) this.gradePass.uniforms.uGameplayPulse.value = params.gameplayPulse;
            if (params.comboSurge !== undefined) this.gradePass.uniforms.uComboSurge.value = params.comboSurge;
            if (params.chromaticAberrationEnabled !== undefined) {
                this.gradePass.uniforms.uChromaEnabled.value = params.chromaticAberrationEnabled === true ? 1 : 0;
            }
            if (params.causticSweepStrength !== undefined) {
                this.gradePass.uniforms.uCausticSweepStrength.value = params.causticSweepStrength;
            }
        }
    }

    render(elapsed, glowIntensity) {
        if (!this.enabled || !this.composer) {
            this.renderer.render(this.scene, this.camera);
            return;
        }

        if (this.gradePass?.uniforms) {
            this.gradePass.uniforms.uTime.value = elapsed;
            this.gradePass.uniforms.uGlowIntensity.value = glowIntensity;
        }
        this.composer.render();
    }

    dispose() {
        if (this.gradePass?.material) this.gradePass.material.dispose();
        if (this.bloomPass?.dispose) this.bloomPass.dispose();
        if (this.composer?.dispose) this.composer.dispose();

        this.composer = null;
        this.gradePass = null;
        this.bloomPass = null;
        this.enabled = false;
        this.renderer = null;
        this.scene = null;
        this.camera = null;
    }
}

// Re-export legacy class under the old name for backward compat
export { OceanPostProcessingLegacy as OceanPostProcessing };

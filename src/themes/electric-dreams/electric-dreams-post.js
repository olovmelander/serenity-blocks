/* eslint-disable import/no-unresolved */
/**
 * Electric Dreams Theme - Post-Processing Pipeline
 * MRT bloom, chromatic aberration, vignette, god rays, ACES tone mapping, color grading
 */
import * as THREE from 'three';
import * as WEBGPU from 'three/webgpu';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import {
    abs,
    emissive,
    mrt,
    output,
    pass,
    pow,
    viewportUV,
    uniform,
    clamp,
    dot,
    float,
    fract,
    length,
    max,
    mix,
    sin,
    smoothstep,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { disposeBloomNodeDeep } from '../shared/bloom-dispose.js';

// ─────────────────────────────────────────────────────────────────────────────
// Quality Profiles
// ─────────────────────────────────────────────────────────────────────────────

export const ELECTRIC_DREAMS_POST_PROFILES = Object.freeze({
    Minimal: Object.freeze({
        enabled: false,
        bloomStrength: 0,
        bloomRadius: 0.5,
        bloomThreshold: 0.25,
        bloomDownsample: 0.6,
        exposure: 1.0,
        contrast: 1.02,
        saturation: 1.0,
        vignetteOffset: 1.1,
        vignetteDarkness: 0.2,
        ditherStrength: 0.001,
        useFilmGrain: false,
        grainStrength: 0,
        chromaticStrength: 0,
        godRayStrength: 0,
        godRaySamples: 0,
        glassRimStrength: 0,
    }),
    Low: Object.freeze({
        enabled: false,
        bloomStrength: 0,
        bloomRadius: 0.5,
        bloomThreshold: 0.22,
        bloomDownsample: 0.6,
        exposure: 1.0,
        contrast: 1.03,
        saturation: 1.0,
        vignetteOffset: 1.1,
        vignetteDarkness: 0.25,
        ditherStrength: 0.001,
        useFilmGrain: false,
        grainStrength: 0,
        chromaticStrength: 0,
        godRayStrength: 0,
        godRaySamples: 0,
        glassRimStrength: 0,
    }),
    Medium: Object.freeze({
        enabled: true,
        bloomStrength: 0.38,
        bloomRadius: 0.52,
        bloomThreshold: 0.24,
        bloomDownsample: 0.45,
        exposure: 0.93,
        contrast: 1.16,
        saturation: 1.14,
        vignetteOffset: 1.06,
        vignetteDarkness: 0.48,
        ditherStrength: 0.0015,
        useFilmGrain: false,
        grainStrength: 0,
        chromaticStrength: 0.0018,
        godRayStrength: 0.028,
        godRaySamples: 6,
        glassRimStrength: 0,
    }),
    High: Object.freeze({
        enabled: true,
        bloomStrength: 0.46,
        bloomRadius: 0.56,
        bloomThreshold: 0.22,
        bloomDownsample: 0.5,
        exposure: 0.91,
        contrast: 1.19,
        saturation: 1.16,
        vignetteOffset: 1.02,
        vignetteDarkness: 0.56,
        ditherStrength: 0.0018,
        useFilmGrain: true,
        grainStrength: 0.0022,
        chromaticStrength: 0.0028,
        godRayStrength: 0.05,
        godRaySamples: 10,
        glassRimStrength: 0,
    }),
    Ultra: Object.freeze({
        enabled: true,
        bloomStrength: 0.58,
        bloomRadius: 0.62,
        bloomThreshold: 0.18,
        bloomDownsample: 0.55,
        exposure: 0.91,
        contrast: 1.2,
        saturation: 1.18,
        vignetteOffset: 0.98,
        vignetteDarkness: 0.64,
        ditherStrength: 0.002,
        useFilmGrain: true,
        grainStrength: 0.003,
        chromaticStrength: 0.0042,
        godRayStrength: 0.08,
        godRaySamples: 12,
        // Glass rim active on Ultra+ — replaces the world-space sphere overlay
        // (which is now disabled at this tier; post pass gives the same look).
        glassRimStrength: 0.65,
    }),
    Extreme: Object.freeze({
        enabled: true,
        bloomStrength: 0.68,
        bloomRadius: 0.66,
        bloomThreshold: 0.16,
        bloomDownsample: 0.6,
        exposure: 0.92,
        contrast: 1.22,
        saturation: 1.2,
        vignetteOffset: 0.94,
        vignetteDarkness: 0.7,
        ditherStrength: 0.0022,
        useFilmGrain: true,
        grainStrength: 0.0036,
        chromaticStrength: 0.0055,
        godRayStrength: 0.11,
        godRaySamples: 14,
        glassRimStrength: 0.85,
    }),
});

export function getElectricDreamsPostProfile(qualityName) {
    const key = typeof qualityName === 'string' ? qualityName : 'High';
    return { ...(ELECTRIC_DREAMS_POST_PROFILES[key] || ELECTRIC_DREAMS_POST_PROFILES.High) };
}

// ─────────────────────────────────────────────────────────────────────────────
// WebGL Fallback Grade Shader
// ─────────────────────────────────────────────────────────────────────────────

const GRADE_SHADER = {
    uniforms: {
        tDiffuse: { value: null },
        uExposure: { value: 1.03 },
        uContrast: { value: 1.06 },
        uSaturation: { value: 1.04 },
        uVignetteOffset: { value: 1.12 },
        uVignetteDarkness: { value: 0.35 },
        uGrainStrength: { value: 0.001 },
        uDitherStrength: { value: 0.0018 },
        uChromaticStrength: { value: 0.004 },
        uShockwaveStrength: { value: 0.0 },
        uShockwaveCenter: { value: new THREE.Vector2(0.5, 0.5) },
        uTime: { value: 0.0 },
    },
    vertexShader: `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        varying vec2 vUv;
        uniform sampler2D tDiffuse;
        uniform float uExposure;
        uniform float uContrast;
        uniform float uSaturation;
        uniform float uVignetteOffset;
        uniform float uVignetteDarkness;
        uniform float uGrainStrength;
        uniform float uDitherStrength;
        uniform float uChromaticStrength;
        uniform float uShockwaveStrength;
        uniform vec2 uShockwaveCenter;
        uniform float uTime;

        float randomGrain(vec2 uv) {
            float x = dot(uv + vec2(uTime * 0.0031, uTime * 0.0017), vec2(12.9898, 78.233));
            return fract(sin(x) * 43758.5453) - 0.5;
        }

        vec3 sampleChromatic(vec2 uv, float strength) {
            vec2 centered = uv - 0.5;
            vec2 radial = centered * strength;
            float r = texture2D(tDiffuse, uv + radial).r;
            float g = texture2D(tDiffuse, uv).g;
            float b = texture2D(tDiffuse, uv - radial).b;
            return vec3(r, g, b);
        }

        vec2 applyShockwave(vec2 uv) {
            vec2 delta = uv - uShockwaveCenter;
            float dist = length(delta);
            if (dist < 0.0001) {
                return uv;
            }
            float ring = 1.0 - smoothstep(0.0, 0.18, abs(dist - 0.22));
            float falloff = 1.0 - smoothstep(0.45, 0.9, dist);
            return uv + normalize(delta) * ring * falloff * uShockwaveStrength * 0.025;
        }

        void main() {
            vec2 warpedUv = applyShockwave(vUv);
            vec2 centered = (warpedUv - 0.5) * 2.0;
            float dist = length(centered);

            vec3 color = sampleChromatic(warpedUv, uChromaticStrength);

            // ACES filmic tone mapping
            color *= uExposure;
            vec3 x = color;
            color = clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);

            // Saturation
            float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
            color = mix(vec3(luma), color, uSaturation);

            // Contrast
            color = (color - 0.5) * uContrast + 0.5;

            // Vignette
            float vignette = smoothstep(uVignetteOffset, uVignetteOffset - 0.55, dist);
            color = mix(color * (1.0 - uVignetteDarkness), color, vignette);

            // Film grain + dither
            float grain = randomGrain(vUv * 132.0) * uGrainStrength;
            float dither = randomGrain(vUv * 317.0 + 0.17) * uDitherStrength;
            color += vec3(grain + dither);

            gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
        }
    `,
};

// ─────────────────────────────────────────────────────────────────────────────
// Post-Processing Class
// ─────────────────────────────────────────────────────────────────────────────

export class ElectricDreamsPost {
    constructor(renderer, scene, camera, params = {}) {
        this.renderer = renderer;
        this.scene = scene;
        this.camera = camera;
        this.isWebGPU = renderer?.backend?.isWebGPUBackend === true;
        this.requestedMRT = params.useMRT === true;
        this.useMRT = this.requestedMRT;
        this.resolutionScale = params.resolutionScale ?? 1;
        this.pixelRatio = params.pixelRatio ?? 1;
        this.size = { width: 0, height: 0 };
        this.lastRenderCostMs = 0;
        this.mrtInitError = null;

        this.postProcessing = null;
        this.composer = null;
        this.renderPass = null;
        this.bloomPass = null;
        this.gradePass = null;
        this.scenePass = null;
        this.bloomNode = null;

        if (this.isWebGPU) {
            this.setupWebGPU(params);
        } else if (renderer?.isWebGLRenderer === true) {
            this.setupWebGL(params);
        }
    }

    setupWebGPU(params = {}) {
        this.postProcessing = new WEBGPU.PostProcessing(this.renderer);
        this.scenePass = pass(this.scene, this.camera);
        if (this.useMRT) {
            try {
                this.scenePass.setMRT(mrt({ output, emissive }));
            } catch (error) {
                this.mrtInitError = error;
                this.useMRT = false;
            }
        }

        const sceneColor = this.scenePass.getTextureNode('output');
        const bloomSource = this.useMRT ? this.scenePass.getTextureNode('emissive') : sceneColor;

        // Selective bloom from emissive channel
        this.bloomNode = bloom(
            bloomSource,
            params.bloomStrength ?? 0.55,
            params.bloomRadius ?? 0.55,
            params.bloomThreshold ?? 0.15,
        );

        this.bloomDownsample = params.bloomDownsample ?? 0.7;
        const originalBloomSetSize = this.bloomNode.setSize.bind(this.bloomNode);
        this.bloomNode.setSize = (width, height) => {
            originalBloomSetSize(width * this.bloomDownsample, height * this.bloomDownsample);
        };

        // Uniforms
        this.uExposure = uniform(params.exposure ?? 1.03);
        this.uContrast = uniform(params.contrast ?? 1.06);
        this.uSaturation = uniform(params.saturation ?? 1.06);
        this.uVignetteOffset = uniform(params.vignetteOffset ?? 1.14);
        this.uVignetteDarkness = uniform(params.vignetteDarkness ?? 0.35);
        this.uGrainStrength = uniform(params.useFilmGrain ? (params.grainStrength ?? 0.001) : 0);
        this.uDitherStrength = uniform(params.ditherStrength ?? 0.0018);
        this.uChromaticStrength = uniform(params.chromaticStrength ?? 0.004);
        this.uGodRayStrength = uniform(params.godRayStrength ?? 0);
        this.uShockwaveStrength = uniform(params.shockwaveStrength ?? 0);
        this.uShockwaveCenter = uniform(new THREE.Vector2(0.5, 0.5));
        this.uTime = uniform(0);
        this.uLensCenter = uniform(new THREE.Vector2(0.5, 0.5));
        // Glass rim strength — replaces the world-space glass sphere overlay.
        // 0 = disabled (post pass adds nothing). Theme drives this from preset.
        this.uGlassRimStrength = uniform(params.glassRimStrength ?? 0);

        const uvNode = viewportUV;
        const shockDelta = uvNode.sub(this.uShockwaveCenter);
        const shockDist = length(shockDelta);
        const safeShockDist = max(shockDist, float(0.0001));
        const shockDir = shockDelta.div(safeShockDist);
        const shockRing = float(1.0).sub(smoothstep(float(0.0), float(0.18), abs(shockDist.sub(0.22))));
        const shockFalloff = float(1.0).sub(smoothstep(float(0.45), float(0.9), shockDist));
        const distortedUv = uvNode.add(
            shockDir.mul(shockRing).mul(shockFalloff).mul(this.uShockwaveStrength).mul(0.025),
        );
        const centered = distortedUv.sub(this.uLensCenter);
        const dist = length(centered);

        // Chromatic aberration (stronger at edges)
        const edgeChroma = dist.mul(0.5);
        const chromaStrength = this.uChromaticStrength.add(edgeChroma.mul(this.uChromaticStrength));
        const chromaOffset = centered.mul(chromaStrength);
        const sampleR = sceneColor.sample(distortedUv.add(chromaOffset));
        const sampleG = sceneColor.sample(distortedUv);
        const sampleB = sceneColor.sample(distortedUv.sub(chromaOffset));
        const chroma = vec4(
            sampleR.r,
            sampleG.g,
            sampleB.b,
            sampleG.a,
        );

        // Add bloom
        const bloomColor = chroma.add(this.bloomNode);

        // God rays (screen-space radial blur approximation)
        // - 3 taps instead of 4 (the 0.5 tap was marginal at the falloff edge)
        // - Luma gate on the closest tap so dark regions skip the additive cost
        //   (samples still execute on GPU, but contribution math collapses to 0)
        const godRayDir = centered.mul(-0.15);
        const gr1 = bloomSource.sample(distortedUv.add(godRayDir.mul(0.1)));
        const gr2 = bloomSource.sample(distortedUv.add(godRayDir.mul(0.22)));
        const gr3 = bloomSource.sample(distortedUv.add(godRayDir.mul(0.4)));
        const godRayAccum = gr1.add(gr2).add(gr3).mul(float(1.0 / 3.0));
        // Emissive-luma gate: only bright regions emit visible rays
        const gateLuma = dot(gr1.rgb, vec3(0.2126, 0.7152, 0.0722));
        const lumaGate = smoothstep(float(0.05), float(0.35), gateLuma);
        const godRayMask = smoothstep(float(0.8), float(0.0), dist);
        const godRays = godRayAccum.rgb.mul(this.uGodRayStrength).mul(godRayMask).mul(lumaGate);

        const combined = bloomColor.rgb.add(godRays);

        // Vignette
        const vignette = smoothstep(this.uVignetteOffset, this.uVignetteOffset.sub(0.55), dist);
        const vignetteColor = mix(
            combined.mul(float(1.0).sub(this.uVignetteDarkness)),
            combined,
            vignette,
        );

        // Glass-rim overlay (replaces the world-space glass sphere; same math, no draw call).
        // Original sphere shader was: pow(fresnel, 4.2) * blueTint * (sin(time*0.3) shimmer).
        // Screen-space equivalent: pow(1-vignette, 3) drives intensity at edges, blueTint is
        // constant, shimmer uses uTime. Zero cost on top of existing vignette computation.
        const edgeWeight = pow(float(1.0).sub(vignette), float(3.0));
        const glassShimmer = sin(this.uTime.mul(0.3)).mul(0.015).add(0.985);
        const glassTint = vec3(0.5, 0.62, 0.9);
        const glassRim = glassTint.mul(edgeWeight).mul(glassShimmer).mul(this.uGlassRimStrength);
        const glassedColor = vignetteColor.add(glassRim);

        // ACES filmic tone mapping
        const exposed = glassedColor.mul(this.uExposure);
        const acesA = float(2.51);
        const acesB = float(0.03);
        const acesC = float(2.43);
        const acesD = float(0.59);
        const acesE = float(0.14);
        const acesNum = exposed.mul(exposed.mul(acesA).add(acesB));
        const acesDen = exposed.mul(exposed.mul(acesC).add(acesD)).add(acesE);
        let graded = clamp(acesNum.div(acesDen), float(0.0), float(1.0));

        // Saturation
        const luma = dot(graded, vec3(0.2126, 0.7152, 0.0722));
        graded = mix(vec3(luma), graded, this.uSaturation);

        // Contrast
        graded = graded.sub(0.5).mul(this.uContrast).add(0.5);

        // Film grain + dither
        const grain = fract(
            sin(dot(uvNode.mul(148.37).add(vec2(this.uTime.mul(0.73), this.uTime.mul(1.17))), vec2(12.9898, 78.233)))
                .mul(43758.5453),
        ).sub(0.5).mul(this.uGrainStrength);
        const dither = fract(
            sin(dot(uvNode.mul(311.7).add(vec2(0.17, 0.31)), vec2(127.1, 269.5))).mul(43758.5453),
        ).sub(0.5).mul(this.uDitherStrength);
        const finalColor = clamp(graded.add(vec3(grain)).add(vec3(dither)), float(0.0), float(1.0));

        this.postProcessing.outputNode = vec4(finalColor, float(1.0));
        this.postProcessing.needsUpdate = true;
    }

    setupWebGL(params = {}) {
        this.composer = new EffectComposer(this.renderer);
        this.renderPass = new RenderPass(this.scene, this.camera);
        this.bloomPass = new UnrealBloomPass(
            new THREE.Vector2(window.innerWidth, window.innerHeight),
            params.bloomStrength ?? 0.55,
            params.bloomRadius ?? 0.55,
            params.bloomThreshold ?? 0.15,
        );
        this.gradePass = new ShaderPass(GRADE_SHADER);

        this.composer.addPass(this.renderPass);
        this.composer.addPass(this.bloomPass);
        this.composer.addPass(this.gradePass);

        this.update(params);
    }

    isEnabled() {
        return this.postProcessing !== null || this.composer !== null;
    }

    updateDynamic(params = {}) {
        if (params.time !== undefined) {
            if (this.uTime) this.uTime.value = params.time;
            if (this.gradePass?.uniforms?.uTime) this.gradePass.uniforms.uTime.value = params.time;
        }
        if (params.exposure !== undefined) {
            if (this.uExposure) this.uExposure.value = params.exposure;
            if (this.gradePass?.uniforms?.uExposure) this.gradePass.uniforms.uExposure.value = params.exposure;
        }
        if (params.bloomStrength !== undefined) {
            if (this.bloomNode?.strength) this.bloomNode.strength.value = params.bloomStrength;
            if (this.bloomPass) this.bloomPass.strength = params.bloomStrength;
        }
        if (params.godRayStrength !== undefined) {
            if (this.uGodRayStrength) this.uGodRayStrength.value = params.godRayStrength;
        }
        if (params.chromaticStrength !== undefined) {
            if (this.uChromaticStrength) this.uChromaticStrength.value = params.chromaticStrength;
            if (this.gradePass?.uniforms?.uChromaticStrength) {
                this.gradePass.uniforms.uChromaticStrength.value = params.chromaticStrength;
            }
        }
        if (params.vignetteDarkness !== undefined) {
            if (this.uVignetteDarkness) this.uVignetteDarkness.value = params.vignetteDarkness;
            if (this.gradePass?.uniforms?.uVignetteDarkness) {
                this.gradePass.uniforms.uVignetteDarkness.value = params.vignetteDarkness;
            }
        }
        if (params.shockwaveStrength !== undefined) {
            if (this.uShockwaveStrength) this.uShockwaveStrength.value = params.shockwaveStrength;
            if (this.gradePass?.uniforms?.uShockwaveStrength) {
                this.gradePass.uniforms.uShockwaveStrength.value = params.shockwaveStrength;
            }
        }
        if (params.shockwaveCenter !== undefined) {
            if (this.uShockwaveCenter) this.uShockwaveCenter.value.copy(params.shockwaveCenter);
            if (this.gradePass?.uniforms?.uShockwaveCenter) {
                this.gradePass.uniforms.uShockwaveCenter.value.copy(params.shockwaveCenter);
            }
        }
    }

    update(params = {}) {
        if (params.bloomRadius !== undefined) {
            if (this.bloomNode?.radius) this.bloomNode.radius.value = params.bloomRadius;
            if (this.bloomPass) this.bloomPass.radius = params.bloomRadius;
        }
        if (params.bloomThreshold !== undefined) {
            if (this.bloomNode?.threshold) this.bloomNode.threshold.value = params.bloomThreshold;
            if (this.bloomPass) this.bloomPass.threshold = params.bloomThreshold;
        }
        if (params.bloomDownsample !== undefined) {
            this.bloomDownsample = params.bloomDownsample;
            if (this.size.width > 0 && this.size.height > 0) {
                this.applySize();
            }
        }

        const uniforms = this.gradePass?.uniforms;
        if (params.exposure !== undefined) {
            if (this.uExposure) this.uExposure.value = params.exposure;
            if (uniforms?.uExposure) uniforms.uExposure.value = params.exposure;
        }
        if (params.contrast !== undefined) {
            if (this.uContrast) this.uContrast.value = params.contrast;
            if (uniforms?.uContrast) uniforms.uContrast.value = params.contrast;
        }
        if (params.saturation !== undefined) {
            if (this.uSaturation) this.uSaturation.value = params.saturation;
            if (uniforms?.uSaturation) uniforms.uSaturation.value = params.saturation;
        }
        if (params.vignetteOffset !== undefined) {
            if (this.uVignetteOffset) this.uVignetteOffset.value = params.vignetteOffset;
            if (uniforms?.uVignetteOffset) uniforms.uVignetteOffset.value = params.vignetteOffset;
        }
        if (params.vignetteDarkness !== undefined) {
            if (this.uVignetteDarkness) this.uVignetteDarkness.value = params.vignetteDarkness;
            if (uniforms?.uVignetteDarkness) uniforms.uVignetteDarkness.value = params.vignetteDarkness;
        }
        if (params.grainStrength !== undefined) {
            if (this.uGrainStrength) this.uGrainStrength.value = params.grainStrength;
            if (uniforms?.uGrainStrength) uniforms.uGrainStrength.value = params.grainStrength;
        }
        if (params.ditherStrength !== undefined) {
            if (this.uDitherStrength) this.uDitherStrength.value = params.ditherStrength;
            if (uniforms?.uDitherStrength) uniforms.uDitherStrength.value = params.ditherStrength;
        }
        if (params.chromaticStrength !== undefined) {
            if (this.uChromaticStrength) this.uChromaticStrength.value = params.chromaticStrength;
            if (uniforms?.uChromaticStrength) uniforms.uChromaticStrength.value = params.chromaticStrength;
        }
        if (params.shockwaveStrength !== undefined) {
            if (this.uShockwaveStrength) this.uShockwaveStrength.value = params.shockwaveStrength;
            if (uniforms?.uShockwaveStrength) uniforms.uShockwaveStrength.value = params.shockwaveStrength;
        }
        if (params.shockwaveCenter !== undefined) {
            if (this.uShockwaveCenter) this.uShockwaveCenter.value.copy(params.shockwaveCenter);
            if (uniforms?.uShockwaveCenter) uniforms.uShockwaveCenter.value.copy(params.shockwaveCenter);
        }
        if (params.useFilmGrain !== undefined) {
            const grain = params.useFilmGrain ? (params.grainStrength ?? 0.001) : 0;
            if (this.uGrainStrength) this.uGrainStrength.value = grain;
            if (uniforms?.uGrainStrength) uniforms.uGrainStrength.value = grain;
        }
        if (params.godRayStrength !== undefined && this.uGodRayStrength) {
            this.uGodRayStrength.value = params.godRayStrength;
        }
        if (params.glassRimStrength !== undefined && this.uGlassRimStrength) {
            this.uGlassRimStrength.value = params.glassRimStrength;
        }
        if (params.time !== undefined) {
            if (this.uTime) this.uTime.value = params.time;
            if (uniforms?.uTime) uniforms.uTime.value = params.time;
        }
        if (params.resolutionScale !== undefined) {
            const nextScale = THREE.MathUtils.clamp(params.resolutionScale, 0.35, 1);
            if (Math.abs(nextScale - this.resolutionScale) >= 0.001) {
                this.resolutionScale = nextScale;
                if (this.size.width > 0 && this.size.height > 0) {
                    this.applySize();
                }
            }
        }
    }

    setSize(width, height) {
        this.size.width = width;
        this.size.height = height;
        this.applySize();
    }

    setPixelRatio(pixelRatio) {
        this.pixelRatio = Number.isFinite(pixelRatio) ? pixelRatio : 1;
        if (this.composer?.setPixelRatio) {
            this.composer.setPixelRatio(this.pixelRatio);
        }
        this.applySize();
    }

    applySize() {
        const scaledWidth = Math.max(1, Math.round(this.size.width * this.resolutionScale * this.pixelRatio));
        const scaledHeight = Math.max(1, Math.round(this.size.height * this.resolutionScale * this.pixelRatio));
        const composerWidth = Math.max(1, Math.round(this.size.width * this.resolutionScale));
        const composerHeight = Math.max(1, Math.round(this.size.height * this.resolutionScale));

        if (this.scenePass?.setSize) this.scenePass.setSize(scaledWidth, scaledHeight);
        if (this.bloomNode?._separableBlurMaterials?.length) this.bloomNode.setSize(scaledWidth, scaledHeight);
        if (this.postProcessing?.setSize) this.postProcessing.setSize(scaledWidth, scaledHeight);
        if (this.composer?.setSize) this.composer.setSize(composerWidth, composerHeight);
    }

    render() {
        const start = typeof performance !== 'undefined' ? performance.now() : Date.now();
        if (this.postProcessing) {
            this.postProcessing.render();
        } else if (this.composer) {
            this.composer.render();
        }
        const end = typeof performance !== 'undefined' ? performance.now() : Date.now();
        this.lastRenderCostMs = Math.max(0, end - start);
    }

    dispose() {
        if (this.scenePass?.dispose) this.scenePass.dispose();
        disposeBloomNodeDeep(this.bloomNode);
        if (this.postProcessing?.dispose) this.postProcessing.dispose();
        if (this.composer?.dispose) this.composer.dispose();
        this.postProcessing = null;
        this.composer = null;
        this.renderPass = null;
        this.bloomPass = null;
        this.gradePass = null;
        this.scenePass = null;
        this.bloomNode = null;
    }
}

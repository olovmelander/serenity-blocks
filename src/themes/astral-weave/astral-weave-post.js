/* eslint-disable import/no-unresolved */
import * as THREE from 'three';
import * as WEBGPU from 'three/webgpu';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import {
    emissive,
    mrt,
    output,
    pass,
    viewportUV,
    uniform,
    float,
    clamp,
    dot,
    fract,
    length,
    mix,
    sin,
    smoothstep,
    vec2,
    vec3,
    vec4,
    texture,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { chromaticAberration } from 'three/addons/tsl/display/ChromaticAberrationNode.js';
import { disposeBloomNodeDeep } from '../shared/bloom-dispose.js';
import { withEmissiveMaterialBlending } from '../shared/mrt-blend.js';

export const ASTRAL_WEAVE_POST_PROFILES = Object.freeze({
    Minimal: Object.freeze({
        enabled: false,
        bloomStrength: 0,
        bloomRadius: 0.45,
        bloomThreshold: 0.28,
        bloomDownsample: 0.6,
        exposure: 1.0,
        contrast: 1.015,
        saturation: 1.0,
        vignetteOffset: 1.12,
        vignetteDarkness: 0.12,
        ditherStrength: 0.0012,
        useFilmGrain: false,
        grainStrength: 0,
        lensDirtStrength: 0,
        chromaticStrength: 0,
        useLensing: false,
    }),
    Low: Object.freeze({
        enabled: false,
        bloomStrength: 0,
        bloomRadius: 0.45,
        bloomThreshold: 0.24,
        bloomDownsample: 0.6,
        exposure: 1.0,
        contrast: 1.015,
        saturation: 1.0,
        vignetteOffset: 1.12,
        vignetteDarkness: 0.12,
        ditherStrength: 0.0012,
        useFilmGrain: false,
        grainStrength: 0,
        lensDirtStrength: 0,
        chromaticStrength: 0,
        useLensing: false,
    }),
    Medium: Object.freeze({
        enabled: true,
        bloomStrength: 0.16,
        bloomRadius: 0.54,
        bloomThreshold: 0.58,
        bloomDownsample: 0.64,
        exposure: 1.0,
        contrast: 1.025,
        saturation: 1.065,
        vignetteOffset: 1.1,
        vignetteDarkness: 0.14,
        ditherStrength: 0.0012,
        useFilmGrain: false,
        grainStrength: 0,
        lensDirtStrength: 0,
        chromaticStrength: 0.0005,
        useLensing: false,
    }),
    High: Object.freeze({
        enabled: true,
        bloomStrength: 0.2,
        bloomRadius: 0.56,
        bloomThreshold: 0.58,
        bloomDownsample: 0.7,
        exposure: 1.0,
        contrast: 1.03,
        saturation: 1.075,
        vignetteOffset: 1.12,
        vignetteDarkness: 0.16,
        ditherStrength: 0.0013,
        useFilmGrain: false,
        grainStrength: 0,
        lensDirtStrength: 0.006,
        chromaticStrength: 0.0007,
        useLensing: false,
    }),
    Ultra: Object.freeze({
        enabled: true,
        bloomStrength: 0.22,
        bloomRadius: 0.58,
        bloomThreshold: 0.56,
        bloomDownsample: 0.76,
        exposure: 1.0,
        contrast: 1.03,
        saturation: 1.08,
        vignetteOffset: 1.14,
        vignetteDarkness: 0.17,
        ditherStrength: 0.0014,
        useFilmGrain: false,
        grainStrength: 0,
        lensDirtStrength: 0.008,
        chromaticStrength: 0.0009,
        useLensing: true,
    }),
    Extreme: Object.freeze({
        enabled: true,
        bloomStrength: 0.24,
        bloomRadius: 0.6,
        bloomThreshold: 0.56,
        bloomDownsample: 0.8,
        exposure: 1.0,
        contrast: 1.035,
        saturation: 1.08,
        vignetteOffset: 1.16,
        vignetteDarkness: 0.18,
        ditherStrength: 0.0014,
        useFilmGrain: false,
        grainStrength: 0,
        lensDirtStrength: 0.01,
        chromaticStrength: 0.001,
        useLensing: true,
    }),
});

export function getAstralWeavePostProfile(qualityName) {
    const key = typeof qualityName === 'string' ? qualityName : 'High';
    return { ...(ASTRAL_WEAVE_POST_PROFILES[key] || ASTRAL_WEAVE_POST_PROFILES.High) };
}

const ASTRAL_WEAVE_GRADE_SHADER = {
    uniforms: {
        tDiffuse: { value: null },
        tLensDirt: { value: null },
        uExposure: { value: 1.0 },
        uContrast: { value: 1.03 },
        uSaturation: { value: 1.075 },
        uVignetteOffset: { value: 1.12 },
        uVignetteDarkness: { value: 0.16 },
        uGrainStrength: { value: 0 },
        uDitherStrength: { value: 0.0013 },
        uLensDirtStrength: { value: 0.006 },
        uChromaticStrength: { value: 0.0007 },
        uLensingStrength: { value: 0.0 },
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
        uniform sampler2D tLensDirt;
        uniform float uExposure;
        uniform float uContrast;
        uniform float uSaturation;
        uniform float uVignetteOffset;
        uniform float uVignetteDarkness;
        uniform float uGrainStrength;
        uniform float uDitherStrength;
        uniform float uLensDirtStrength;
        uniform float uChromaticStrength;
        uniform float uLensingStrength;
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

        void main() {
            vec2 centered = (vUv - vec2(0.5, 0.46)) * 2.0;
            float dist = length(centered);
            float lensMask = (1.0 - smoothstep(0.0, 0.6, dist)) * uLensingStrength;
            vec2 warpedUv = vUv - centered * lensMask * 0.0035;

            vec3 color = sampleChromatic(warpedUv, uChromaticStrength + lensMask * 0.0015);
            vec3 lensDirt = texture2D(tLensDirt, vUv).rgb;
            color += color * lensDirt * uLensDirtStrength * 0.12;

            color *= uExposure;
            float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
            color = mix(vec3(luma), color, uSaturation);
            // A midpoint contrast subtraction erased low-intensity nebula hues.
            // This gentle highlight lift leaves black and shadow colors intact.
            color *= 1.0 + (uContrast - 1.0) * smoothstep(0.08, 0.75, luma);

            float vignette = 1.0 - smoothstep(uVignetteOffset - 0.55, uVignetteOffset, dist);
            color = mix(color * (1.0 - uVignetteDarkness), color, vignette);

            float grain = randomGrain(vUv * 132.0) * uGrainStrength;
            color += vec3(grain);

            float dither = randomGrain(vUv * 317.0 + 0.17) * uDitherStrength;
            color += vec3(dither);

            color = clamp(color, vec3(0.0), vec3(1.0));
            gl_FragColor = vec4(color, 1.0);
        }
    `,
};

export class AstralWeavePost {
    constructor(renderer, scene, camera, params = {}) {
        this.renderer = renderer;
        this.scene = scene;
        this.camera = camera;
        this.isWebGPU = renderer?.backend?.isWebGPUBackend === true;
        this.useMRT = params.useMRT === true;
        this.size = { width: 0, height: 0 };
        this.lastRenderCostMs = 0;

        this.postProcessing = null;
        this.composer = null;
        this.renderPass = null;
        this.bloomPass = null;
        this.gradePass = null;
        this.scenePass = null;
        this.bloomNode = null;

        this.profile = params.profile || 'full';
        this.lensDirtTexture = params.lensDirtTexture || null;

        if (renderer?.isWebGPURenderer === true) {
            this.setupWebGPU(params);
        } else if (renderer?.isWebGLRenderer === true) {
            this.setupWebGL(params);
        }
    }

    setupWebGPU(params = {}) {
        this.postProcessing = new WEBGPU.RenderPipeline(this.renderer);
        this.scenePass = pass(this.scene, this.camera);
        if (this.useMRT) {
            this.scenePass.setMRT(withEmissiveMaterialBlending(mrt({ output, emissive })));
        }

        const sceneColor = this.scenePass.getTextureNode('output');
        const bloomSource = this.useMRT ? this.scenePass.getTextureNode('emissive') : sceneColor;

        this.bloomNode = bloom(
            bloomSource,
            params.bloomStrength ?? 0.2,
            params.bloomRadius ?? 0.56,
            params.bloomThreshold ?? 0.58,
        );

        this.bloomDownsample = params.bloomDownsample ?? 0.72;
        // The old size patch also applied BloomNode's internal half-resolution.
        // Preserve that budget through r186's public resolution API.
        this.bloomNode.setResolutionScale(this.bloomDownsample * 0.5);

        this.uExposure = uniform(params.exposure ?? 1.0);
        this.uContrast = uniform(params.contrast ?? 1.03);
        this.uSaturation = uniform(params.saturation ?? 1.075);
        this.uVignetteOffset = uniform(params.vignetteOffset ?? 1.12);
        this.uVignetteDarkness = uniform(params.vignetteDarkness ?? 0.16);
        this.uGrainStrength = uniform(params.useFilmGrain ? (params.grainStrength ?? 0.00115) : 0);
        this.uDitherStrength = uniform(params.ditherStrength ?? 0.0013);
        this.uLensDirtStrength = uniform(params.lensDirtStrength ?? 0);
        this.uChromaticStrength = uniform(params.chromaticStrength ?? 0);
        this.uLensingStrength = uniform(0);
        this.uTime = uniform(0);
        this.uLensCenter = uniform(new THREE.Vector2(0.5, 0.46));

        const uvNode = viewportUV;
        const centered = uvNode.sub(this.uLensCenter);
        const dist = length(centered.mul(2));
        const lensMask = float(1).sub(smoothstep(float(0), float(0.6), dist)).mul(this.uLensingStrength);
        const warpedUv = uvNode.sub(centered.mul(lensMask).mul(0.007));
        const sceneSample = sceneColor.sample(warpedUv);
        const chroma = chromaticAberration(
            sceneSample,
            this.uChromaticStrength.add(lensMask.mul(0.0015)),
            this.uLensCenter,
            1.05,
        );
        const bloomColor = chroma.add(this.bloomNode);

        let combined = bloomColor;
        if (this.lensDirtTexture) {
            const dirt = texture(this.lensDirtTexture).rgb;
            combined = combined.add(this.bloomNode.mul(dirt).mul(this.uLensDirtStrength));
        }

        const vignette = float(1).sub(smoothstep(this.uVignetteOffset.sub(0.55), this.uVignetteOffset, dist));
        const vignetteColor = mix(
            combined.mul(float(1.0).sub(this.uVignetteDarkness)),
            combined,
            vignette,
        );

        const exposed = vignetteColor.rgb.mul(this.uExposure);
        const acesA = float(2.51);
        const acesB = float(0.03);
        const acesC = float(2.43);
        const acesD = float(0.59);
        const acesE = float(0.14);
        const acesNum = exposed.mul(exposed.mul(acesA).add(acesB));
        const acesDen = exposed.mul(exposed.mul(acesC).add(acesD)).add(acesE);
        let graded = clamp(acesNum.div(acesDen), float(0.0), float(1.0));

        const luma = dot(graded, vec3(0.2126, 0.7152, 0.0722));
        graded = mix(vec3(luma), graded, this.uSaturation);
        graded = graded.mul(float(1).add(
            this.uContrast.sub(1).mul(smoothstep(float(0.08), float(0.75), luma)),
        ));

        const grain = fract(
            sin(dot(uvNode.mul(148.37).add(vec2(this.uTime.mul(0.73), this.uTime.mul(1.17))), vec2(12.9898, 78.233)))
                .mul(43758.5453),
        ).sub(0.5).mul(this.uGrainStrength);
        const dither = fract(
            sin(dot(uvNode.mul(311.7).add(vec2(0.17, 0.31)), vec2(127.1, 269.5))).mul(43758.5453),
        ).sub(0.5).mul(this.uDitherStrength);
        const finalColor = clamp(graded.add(vec3(grain)).add(vec3(dither)), float(0.0), float(1.0));

        this.postProcessing.outputNode = vec4(finalColor, vignetteColor.a);
        this.postProcessing.needsUpdate = true;
    }

    setupWebGL(params = {}) {
        this.composer = new EffectComposer(this.renderer);
        this.renderPass = new RenderPass(this.scene, this.camera);
        this.bloomPass = new UnrealBloomPass(
            new THREE.Vector2(window.innerWidth, window.innerHeight),
            params.bloomStrength ?? 0.2,
            params.bloomRadius ?? 0.56,
            params.bloomThreshold ?? 0.58,
        );
        this.gradePass = new ShaderPass(ASTRAL_WEAVE_GRADE_SHADER);
        this.gradePass.uniforms.tLensDirt.value = this.lensDirtTexture;

        this.composer.addPass(this.renderPass);
        this.composer.addPass(this.bloomPass);
        this.composer.addPass(this.gradePass);

        this.updateStaticProfile(params);
    }

    isEnabled() {
        return this.postProcessing !== null || this.composer !== null;
    }

    updateDynamic(params = {}) {
        if (params.time !== undefined) {
            if (this.uTime) this.uTime.value = params.time;
            if (this.gradePass?.uniforms?.uTime) this.gradePass.uniforms.uTime.value = params.time;
        }
        if (params.bloomStrength !== undefined) {
            if (this.bloomNode?.strength) this.bloomNode.strength.value = params.bloomStrength;
            if (this.bloomPass) this.bloomPass.strength = params.bloomStrength;
        }
        if (params.lensingStrength !== undefined) {
            if (this.uLensingStrength) this.uLensingStrength.value = params.lensingStrength;
            if (this.gradePass?.uniforms?.uLensingStrength) {
                this.gradePass.uniforms.uLensingStrength.value = params.lensingStrength;
            }
        }
    }

    updateStaticProfile(params = {}) {
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
            this.bloomNode?.setResolutionScale(this.bloomDownsample * 0.5);
            if (this.size.width > 0 && this.size.height > 0 && this.bloomNode?._separableBlurMaterials?.length) {
                this.bloomNode.setSize(this.size.width, this.size.height);
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
        if (params.lensDirtStrength !== undefined) {
            if (this.uLensDirtStrength) this.uLensDirtStrength.value = params.lensDirtStrength;
            if (uniforms?.uLensDirtStrength) uniforms.uLensDirtStrength.value = params.lensDirtStrength;
        }
        if (params.chromaticStrength !== undefined) {
            if (this.uChromaticStrength) this.uChromaticStrength.value = params.chromaticStrength;
            if (uniforms?.uChromaticStrength) uniforms.uChromaticStrength.value = params.chromaticStrength;
        }
        if (params.useFilmGrain !== undefined) {
            const grain = params.useFilmGrain ? (params.grainStrength ?? 0.00115) : 0;
            if (this.uGrainStrength) this.uGrainStrength.value = grain;
            if (uniforms?.uGrainStrength) uniforms.uGrainStrength.value = grain;
        }
        if (params.lensDirtTexture !== undefined && uniforms?.tLensDirt) {
            uniforms.tLensDirt.value = params.lensDirtTexture;
        }
    }

    setSize(width, height) {
        this.size.width = width;
        this.size.height = height;
        if (this.scenePass?.setSize) this.scenePass.setSize(width, height);
        if (this.bloomNode?._separableBlurMaterials?.length) this.bloomNode.setSize(width, height);
        if (this.postProcessing?.setSize) this.postProcessing.setSize(width, height);
        if (this.composer?.setSize) this.composer.setSize(width, height);
    }

    getLastRenderCostMs() {
        return this.lastRenderCostMs;
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
        if (this.scenePass?.dispose) {
            this.scenePass.dispose();
        }
        disposeBloomNodeDeep(this.bloomNode);
        if (this.postProcessing?.dispose) {
            this.postProcessing.dispose();
        }
        if (this.composer?.dispose) {
            this.renderPass?.dispose?.();
            this.bloomPass?.dispose?.();
            this.gradePass?.dispose?.();
            this.composer.dispose();
        }
        this.postProcessing = null;
        this.composer = null;
        this.renderPass = null;
        this.bloomPass = null;
        this.gradePass = null;
        this.scenePass = null;
        this.bloomNode = null;
    }
}

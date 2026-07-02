/**
 * Swedish Forest post-processing abstraction.
 *
 * WebGPU path: TSL PostProcessing with optional emissive MRT bloom,
 * ACES tonemapping, warm grading, vignette, and subtle grain.
 *
 * WebGL path: EffectComposer fallback with bloom + equivalent grade shader.
 */

import * as THREE from 'three';
import * as WEBGPU from 'three/webgpu';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import {
    emissive,
    mrt,
    output,
    pass,
    viewportUV,
    uniform,
    float,
    vec2,
    vec3,
    vec4,
    dot,
    mix,
    smoothstep,
    clamp,
    max,
    fract,
    sin,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';

function colorToVec3(color) {
    if (color?.isColor) {
        return new THREE.Vector3(color.r, color.g, color.b);
    }
    if (Array.isArray(color) && color.length >= 3) {
        return new THREE.Vector3(Number(color[0]) || 0, Number(color[1]) || 0, Number(color[2]) || 0);
    }
    return new THREE.Vector3(1, 1, 1);
}

function createSwedishForestGradeShader(params = {}) {
    const warmTint = colorToVec3(params.warmTint ?? new THREE.Color(1.08, 0.98, 0.88));
    const crushedBlacks = colorToVec3(params.crushBlacks ?? new THREE.Color(0.02, 0.01, 0.005));

    return {
        uniforms: {
            tDiffuse: { value: null },
            uExposure: { value: params.exposure ?? 1.05 },
            uContrast: { value: params.contrast ?? 1.04 },
            uSaturation: { value: params.saturation ?? 1.12 },
            uWarmTint: { value: warmTint },
            uCrushBlacks: { value: crushedBlacks },
            uVignetteOffset: { value: params.vignetteOffset ?? 1.3 },
            uVignetteDarkness: { value: params.vignetteDarkness ?? 0.4 },
            uGrainStrength: { value: params.grainStrength ?? 0.015 },
            uTime: { value: 0 },
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
            uniform vec3 uWarmTint;
            uniform vec3 uCrushBlacks;
            uniform float uVignetteOffset;
            uniform float uVignetteDarkness;
            uniform float uGrainStrength;
            uniform float uTime;

            vec3 ACESFilm(vec3 x) {
                const float a = 2.51;
                const float b = 0.03;
                const float c = 2.43;
                const float d = 0.59;
                const float e = 0.14;
                return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
            }

            float randomGrain(vec2 uv) {
                float seed = dot(uv + vec2(uTime * 0.013, uTime * -0.017), vec2(12.9898, 78.233));
                return fract(sin(seed) * 43758.5453) - 0.5;
            }

            void main() {
                vec4 sampleColor = texture2D(tDiffuse, vUv);
                vec3 col = sampleColor.rgb * uExposure;

                col = ACESFilm(col);
                col *= uWarmTint;
                col = (col - 0.5) * uContrast + 0.5;

                float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
                col = mix(vec3(luma), col, uSaturation);
                col = max(col, uCrushBlacks);

                vec2 vignetteUv = vUv - 0.5;
                float vignetteDist = dot(vignetteUv, vignetteUv);
                float vignette = smoothstep(
                    uVignetteOffset,
                    uVignetteOffset - uVignetteDarkness,
                    1.0 - vignetteDist
                );
                col *= vignette;

                float grain = randomGrain(vUv * 180.0) * uGrainStrength;
                col = clamp(col + vec3(grain), vec3(0.0), vec3(1.0));

                gl_FragColor = vec4(col, sampleColor.a);
            }
        `,
    };
}

export class SwedishForestPost {
    constructor(renderer, scene, camera, params = {}) {
        this.renderer = renderer;
        this.scene = scene;
        this.camera = camera;
        this.isWebGPU = renderer?.backend?.isWebGPUBackend === true;
        this.useMRT = params.useMRT === true;
        this.useBloom = params.useBloom !== false;
        this.resolutionScale = params.resolutionScale ?? 1;
        this.bloomDownsample = Math.max(0.25, Math.min(1, params.bloomDownsample ?? 0.5));
        this.size = { width: 0, height: 0 };
        this.pixelRatio = 1;

        this.postProcessing = null;
        this.scenePass = null;
        this.bloomNode = null;

        this.composer = null;
        this.renderPass = null;
        this.bloomPass = null;
        this.gradePass = null;

        if (this.isWebGPU) {
            this.setupWebGPU(scene, camera, params);
        } else if (renderer?.isWebGLRenderer === true) {
            this.setupWebGL(scene, camera, params);
        }
    }

    setupWebGPU(scene, camera, params) {
        this.postProcessing = new WEBGPU.PostProcessing(this.renderer);
        this.scenePass = pass(scene, camera);

        if (this.useMRT) {
            this.scenePass.setMRT(mrt({ output, emissive }));
        }

        const sceneColor = this.scenePass.getTextureNode('output');
        let combined = sceneColor;

        if (this.useBloom) {
            const bloomSource = this.useMRT
                ? this.scenePass.getTextureNode('emissive')
                : sceneColor;

            this.bloomNode = bloom(
                bloomSource,
                params.bloomStrength ?? 0.35,
                params.bloomRadius ?? 0.5,
                params.bloomThreshold ?? 0.8,
            );
            // Run bloom at half resolution — it's a wide blur so full-res is wasteful
            this.bloomHalfRes = this.bloomDownsample < 1;
            combined = combined.add(this.bloomNode);
        }

        this.uExposure = uniform(params.exposure ?? 1.05);
        this.uContrast = uniform(params.contrast ?? 1.04);
        this.uSaturation = uniform(params.saturation ?? 1.12);
        this.uWarmTint = uniform(params.warmTint ?? new THREE.Color(1.08, 0.98, 0.88));
        this.uCrushBlacks = uniform(params.crushBlacks ?? new THREE.Color(0.02, 0.01, 0.005));
        this.uVignetteOffset = uniform(params.vignetteOffset ?? 1.3);
        this.uVignetteDarkness = uniform(params.vignetteDarkness ?? 0.4);
        this.uGrainStrength = uniform(params.grainStrength ?? 0.015);
        this.uDitherStrength = uniform(params.ditherStrength ?? 0.0014);
        this.uSunScreen = uniform(params.sunScreen ?? new THREE.Vector2(0.5, 0.5));
        this.uSunGlowStrength = uniform(params.sunGlowStrength ?? 0);
        this.uSunGlowVisibility = uniform(0);
        this.uTime = uniform(0);

        let graded = combined.xyz.mul(this.uExposure);

        const acesA = float(2.51);
        const acesB = float(0.03);
        const acesC = float(2.43);
        const acesD = float(0.59);
        const acesE = float(0.14);
        const acesNumerator = graded.mul(acesA).add(acesB).mul(graded);
        const acesDenominator = graded.mul(acesC).add(acesD).mul(graded).add(acesE);
        graded = clamp(acesNumerator.div(acesDenominator), float(0.0), float(1.0));

        graded = graded.mul(this.uWarmTint);
        graded = graded.sub(0.5).mul(this.uContrast).add(0.5);

        const luminance = dot(graded, vec3(0.2126, 0.7152, 0.0722));
        graded = mix(vec3(luminance), graded, this.uSaturation);
        graded = max(graded, this.uCrushBlacks);

        const vignetteUv = viewportUV.sub(0.5);
        const vignetteDist = dot(vignetteUv, vignetteUv);
        const vignette = smoothstep(
            this.uVignetteOffset,
            this.uVignetteOffset.sub(this.uVignetteDarkness),
            float(1.0).sub(vignetteDist),
        );
        graded = graded.mul(vignette);

        const sunOffset = viewportUV.sub(this.uSunScreen);
        const sunDistance = dot(sunOffset, sunOffset);
        const sunVeil = smoothstep(0.22, 0.0, sunDistance)
            .mul(this.uSunGlowStrength)
            .mul(this.uSunGlowVisibility);
        graded = clamp(graded.add(vec3(1.0, 0.48, 0.16).mul(sunVeil)), float(0.0), float(1.0));

        const grainSeed = dot(
            viewportUV.add(vec2(this.uTime.mul(0.013), this.uTime.mul(-0.017))),
            vec2(12.9898, 78.233),
        );
        const grainNoise = fract(sin(grainSeed).mul(43758.5453));
        const grain = grainNoise.sub(0.5).mul(this.uGrainStrength);
        graded = clamp(graded.add(vec3(grain)), float(0.0), float(1.0));

        const ditherSeed = dot(viewportUV.mul(2048.0), vec2(171.17, 231.43));
        const dither = fract(sin(ditherSeed).mul(43758.5453)).sub(0.5).mul(this.uDitherStrength);
        graded = clamp(graded.add(vec3(dither)), float(0.0), float(1.0));

        this.postProcessing.outputNode = vec4(graded, combined.a);
        this.postProcessing.needsUpdate = true;
    }

    setupWebGL(scene, camera, params) {
        this.composer = new EffectComposer(this.renderer);
        this.renderPass = new RenderPass(scene, camera);
        this.composer.addPass(this.renderPass);

        if (this.useBloom) {
            this.bloomPass = new UnrealBloomPass(
                new THREE.Vector2(window.innerWidth, window.innerHeight),
                params.bloomStrength ?? 0.35,
                params.bloomRadius ?? 0.5,
                params.bloomThreshold ?? 0.8,
            );
            this.composer.addPass(this.bloomPass);
        }

        this.gradePass = new ShaderPass(createSwedishForestGradeShader(params));
        this.composer.addPass(this.gradePass);
    }

    isEnabled() {
        return this.postProcessing !== null || this.composer !== null;
    }

    update(params = {}) {
        if (params.time !== undefined) {
            if (this.uTime) this.uTime.value = params.time;
            if (this.gradePass?.uniforms?.uTime) this.gradePass.uniforms.uTime.value = params.time;
        }

        if (params.bloomStrength !== undefined) {
            if (this.bloomNode?.strength) this.bloomNode.strength.value = params.bloomStrength;
            if (this.bloomPass) this.bloomPass.strength = params.bloomStrength;
        }
        if (params.bloomRadius !== undefined) {
            if (this.bloomNode?.radius) this.bloomNode.radius.value = params.bloomRadius;
            if (this.bloomPass) this.bloomPass.radius = params.bloomRadius;
        }
        if (params.bloomThreshold !== undefined) {
            if (this.bloomNode?.threshold) this.bloomNode.threshold.value = params.bloomThreshold;
            if (this.bloomPass) this.bloomPass.threshold = params.bloomThreshold;
        }

        if (params.exposure !== undefined) {
            if (this.uExposure) this.uExposure.value = params.exposure;
            if (this.gradePass?.uniforms?.uExposure) this.gradePass.uniforms.uExposure.value = params.exposure;
        }
        if (params.contrast !== undefined) {
            if (this.uContrast) this.uContrast.value = params.contrast;
            if (this.gradePass?.uniforms?.uContrast) this.gradePass.uniforms.uContrast.value = params.contrast;
        }
        if (params.saturation !== undefined) {
            if (this.uSaturation) this.uSaturation.value = params.saturation;
            if (this.gradePass?.uniforms?.uSaturation) this.gradePass.uniforms.uSaturation.value = params.saturation;
        }
        if (params.warmTint !== undefined) {
            if (this.uWarmTint) this.uWarmTint.value.copy(params.warmTint);
            if (this.gradePass?.uniforms?.uWarmTint) this.gradePass.uniforms.uWarmTint.value.copy(colorToVec3(params.warmTint));
        }
        if (params.crushBlacks !== undefined) {
            if (this.uCrushBlacks) this.uCrushBlacks.value.copy(params.crushBlacks);
            if (this.gradePass?.uniforms?.uCrushBlacks) this.gradePass.uniforms.uCrushBlacks.value.copy(colorToVec3(params.crushBlacks));
        }
        if (params.vignetteOffset !== undefined) {
            if (this.uVignetteOffset) this.uVignetteOffset.value = params.vignetteOffset;
            if (this.gradePass?.uniforms?.uVignetteOffset) this.gradePass.uniforms.uVignetteOffset.value = params.vignetteOffset;
        }
        if (params.vignetteDarkness !== undefined) {
            if (this.uVignetteDarkness) this.uVignetteDarkness.value = params.vignetteDarkness;
            if (this.gradePass?.uniforms?.uVignetteDarkness) this.gradePass.uniforms.uVignetteDarkness.value = params.vignetteDarkness;
        }
        if (params.grainStrength !== undefined) {
            if (this.uGrainStrength) this.uGrainStrength.value = params.grainStrength;
            if (this.gradePass?.uniforms?.uGrainStrength) this.gradePass.uniforms.uGrainStrength.value = params.grainStrength;
        }
        if (params.ditherStrength !== undefined && this.uDitherStrength) {
            this.uDitherStrength.value = params.ditherStrength;
        }
        if (params.sunGlowStrength !== undefined && this.uSunGlowStrength) {
            this.uSunGlowStrength.value = params.sunGlowStrength;
        }
        if (params.sunGlowVisibility !== undefined && this.uSunGlowVisibility) {
            this.uSunGlowVisibility.value = params.sunGlowVisibility;
        }
        if (params.sunScreenX !== undefined && params.sunScreenY !== undefined && this.uSunScreen) {
            this.uSunScreen.value.set(params.sunScreenX, params.sunScreenY);
        }

        if (params.resolutionScale !== undefined) {
            const nextScale = params.resolutionScale;
            if (Number.isFinite(nextScale) && Math.abs(nextScale - this.resolutionScale) >= 0.001) {
                this.resolutionScale = nextScale;
                this.applySize();
            }
        }
    }

    render(delta) {
        if (this.postProcessing) {
            this.postProcessing.render();
            return;
        }
        if (this.composer) {
            this.composer.render(delta);
            return;
        }
        this.renderer.render(this.scene, this.camera);
    }

    setPixelRatio(pixelRatio) {
        this.pixelRatio = Number.isFinite(pixelRatio) ? pixelRatio : 1;
        if (this.composer) {
            this.composer.setPixelRatio(this.pixelRatio);
        }
        this.applySize();
    }

    setSize(width, height) {
        this.size.width = width;
        this.size.height = height;
        this.applySize();
    }

    applySize() {
        const width = Math.max(1, Math.round(this.size.width * this.resolutionScale));
        const height = Math.max(1, Math.round(this.size.height * this.resolutionScale));

        if (this.scenePass) {
            const scaledWidth = Math.max(1, Math.round(width * this.pixelRatio));
            const scaledHeight = Math.max(1, Math.round(height * this.pixelRatio));
            this.scenePass.setSize(scaledWidth, scaledHeight);
            if (this.bloomNode?._separableBlurMaterials?.length) {
                this.bloomNode.setSize(
                    Math.max(1, Math.round(scaledWidth * this.bloomDownsample)),
                    Math.max(1, Math.round(scaledHeight * this.bloomDownsample)),
                );
            }
        }

        if (this.composer) {
            this.composer.setSize(width, height);
        }
    }

    dispose() {
        if (this.scenePass) {
            this.scenePass.dispose();
            this.scenePass = null;
        }
        if (this.bloomNode) {
            this.bloomNode.dispose();
            this.bloomNode = null;
        }
        if (this.postProcessing) {
            this.postProcessing.dispose();
            this.postProcessing = null;
        }
        if (this.composer) {
            this.composer.dispose();
            this.composer = null;
        }

        this.renderPass = null;
        this.bloomPass = null;
        this.gradePass = null;
    }
}

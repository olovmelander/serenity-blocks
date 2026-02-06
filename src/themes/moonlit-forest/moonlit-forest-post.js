/**
 * Moonlit Forest post-processing abstraction.
 *
 * WebGPU path uses TSL PostProcessing with bloom, grading, grain, and vignette.
 * WebGL path uses EffectComposer with bloom + grading/vignette shader fallback.
 */

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
    vec2,
    vec3,
    vec4,
    dot,
    length,
    mix,
    smoothstep,
    saturation,
    clamp,
    fract,
    sin,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';

const MOONLIT_GRADE_SHADER = {
    uniforms: {
        tDiffuse: { value: null },
        uExposure: { value: 1.03 },
        uContrast: { value: 1.045 },
        uSaturation: { value: 1.05 },
        uTintColor: { value: new THREE.Color(0.91, 0.97, 1.06) },
        uTintStrength: { value: 0.11 },
        uVignetteOffset: { value: 1.08 },
        uVignetteDarkness: { value: 0.3 },
        uGrainStrength: { value: 0.0024 },
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
        uniform vec3 uTintColor;
        uniform float uTintStrength;
        uniform float uVignetteOffset;
        uniform float uVignetteDarkness;
        uniform float uGrainStrength;
        uniform float uTime;

        float randomGrain(vec2 uv) {
            float x = dot(uv + vec2(uTime * 0.0031, uTime * 0.0017), vec2(12.9898, 78.233));
            return fract(sin(x) * 43758.5453) - 0.5;
        }

        void main() {
            vec4 colorSample = texture2D(tDiffuse, vUv);
            vec3 color = colorSample.rgb * uExposure;

            float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
            color = mix(vec3(luma), color, uSaturation);
            color = (color - 0.5) * uContrast + 0.5;
            color = mix(color, color * uTintColor, uTintStrength);

            vec2 centered = (vUv - 0.5) * 2.0;
            float dist = length(centered);
            float vignette = smoothstep(uVignetteOffset, uVignetteOffset - 0.55, dist);
            color = mix(color * (1.0 - uVignetteDarkness), color, vignette);

            float grain = randomGrain(vUv * 120.0) * uGrainStrength;
            color += vec3(grain);
            color = clamp(color, vec3(0.0), vec3(1.0));

            gl_FragColor = vec4(color, colorSample.a);
        }
    `,
};

export class MoonlitForestPost {
    constructor(renderer, scene, camera, params = {}) {
        this.renderer = renderer;
        this.scene = scene;
        this.camera = camera;
        this.isWebGPU = renderer?.backend?.isWebGPUBackend === true;
        this.useMRT = params.useMRT === true;
        this.resolutionScale = params.resolutionScale ?? 1;
        this.size = { width: 0, height: 0 };

        this.composer = null;
        this.postProcessing = null;
        this.scenePass = null;
        this.bloomPass = null;
        this.bloomNode = null;
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
        const bloomSource = this.useMRT ? this.scenePass.getTextureNode('emissive') : sceneColor;

        this.bloomNode = bloom(
            bloomSource,
            params.bloomStrength ?? 0.35,
            params.bloomRadius ?? 0.55,
            params.bloomThreshold ?? 0.2,
        );

        this.bloomDownsample = params.bloomDownsample ?? 0.8;
        const originalBloomSetSize = this.bloomNode.setSize.bind(this.bloomNode);
        this.bloomNode.setSize = (width, height) => {
            originalBloomSetSize(width * this.bloomDownsample, height * this.bloomDownsample);
        };

        this.uExposure = uniform(params.exposure ?? 1.03);
        this.uContrast = uniform(params.contrast ?? 1.045);
        this.uSaturation = uniform(params.saturation ?? 1.05);
        this.uTintStrength = uniform(params.tintStrength ?? 0.11);
        this.uVignetteOffset = uniform(params.vignetteOffset ?? 1.08);
        this.uVignetteDarkness = uniform(params.vignetteDarkness ?? 0.3);
        this.uGrainStrength = uniform(params.grainStrength ?? 0.0024);
        this.uTime = uniform(0);
        this.uTintColor = uniform(new WEBGPU.Color(0.91, 0.97, 1.06));

        const uv = viewportUV;
        const baseColor = sceneColor.sample(uv);
        const bloomColor = baseColor.add(this.bloomNode);

        const centered = uv.sub(0.5).mul(2.0);
        const dist = length(centered);
        const vignette = smoothstep(this.uVignetteOffset, this.uVignetteOffset.sub(0.55), dist);
        const vignetteColor = mix(
            bloomColor.mul(float(1.0).sub(this.uVignetteDarkness)),
            bloomColor,
            vignette,
        );

        let graded = vignetteColor.xyz.mul(this.uExposure);
        const luma = dot(graded, vec3(0.2126, 0.7152, 0.0722));
        graded = saturation(graded, this.uSaturation);
        graded = graded.sub(0.5).mul(this.uContrast).add(0.5);
        graded = mix(vec3(luma), graded, this.uSaturation);
        graded = mix(graded, graded.mul(this.uTintColor), this.uTintStrength);

        const noise = fract(sin(dot(uv.mul(120.0), vec2(12.9898, 78.233))).mul(43758.5453));
        const grain = noise.sub(0.5).mul(this.uGrainStrength);
        graded = clamp(graded.add(vec3(grain)), float(0.0), float(1.0));

        this.postProcessing.outputNode = vec4(graded, vignetteColor.w);
        this.postProcessing.needsUpdate = true;
    }

    setupWebGL(scene, camera, params) {
        this.composer = new EffectComposer(this.renderer);
        this.renderPass = new RenderPass(scene, camera);
        this.bloomPass = new UnrealBloomPass(
            new THREE.Vector2(window.innerWidth, window.innerHeight),
            params.bloomStrength ?? 0.35,
            params.bloomRadius ?? 0.55,
            params.bloomThreshold ?? 0.2,
        );

        this.gradePass = new ShaderPass(MOONLIT_GRADE_SHADER);
        this.update(params);

        this.composer.addPass(this.renderPass);
        this.composer.addPass(this.bloomPass);
        this.composer.addPass(this.gradePass);
    }

    isEnabled() {
        return this.composer !== null || this.postProcessing !== null;
    }

    update(params = {}) {
        if (params.time !== undefined) {
            if (this.uTime) this.uTime.value = params.time;
            if (this.gradePass?.uniforms?.uTime) this.gradePass.uniforms.uTime.value = params.time;
        }

        if (params.bloomStrength !== undefined) {
            if (this.bloomNode) this.bloomNode.strength.value = params.bloomStrength;
            if (this.bloomPass) this.bloomPass.strength = params.bloomStrength;
        }
        if (params.bloomRadius !== undefined) {
            if (this.bloomNode) this.bloomNode.radius.value = params.bloomRadius;
            if (this.bloomPass) this.bloomPass.radius = params.bloomRadius;
        }
        if (params.bloomThreshold !== undefined) {
            if (this.bloomNode) this.bloomNode.threshold.value = params.bloomThreshold;
            if (this.bloomPass) this.bloomPass.threshold = params.bloomThreshold;
        }
        if (params.bloomDownsample !== undefined) {
            this.bloomDownsample = params.bloomDownsample;
            if (this.size.width > 0 && this.size.height > 0 && this.bloomNode?._separableBlurMaterials?.length) {
                this.bloomNode.setSize(this.size.width, this.size.height);
            }
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
        if (params.tintStrength !== undefined) {
            if (this.uTintStrength) this.uTintStrength.value = params.tintStrength;
            if (this.gradePass?.uniforms?.uTintStrength) this.gradePass.uniforms.uTintStrength.value = params.tintStrength;
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

        if (params.resolutionScale !== undefined) {
            this.resolutionScale = params.resolutionScale;
            if (this.size.width > 0 && this.size.height > 0) {
                this.setSize(this.size.width, this.size.height);
            }
        }
    }

    render() {
        if (this.postProcessing) {
            this.postProcessing.render();
            return;
        }
        if (this.composer) {
            this.composer.render();
            return;
        }
        this.renderer.render(this.scene, this.camera);
    }

    setSize(width, height) {
        this.size.width = width;
        this.size.height = height;

        const scaledWidth = Math.max(1, Math.round(width * this.resolutionScale));
        const scaledHeight = Math.max(1, Math.round(height * this.resolutionScale));

        if (this.scenePass) {
            this.scenePass.setSize(scaledWidth, scaledHeight);
        }
        if (this.bloomNode?._separableBlurMaterials?.length) {
            this.bloomNode.setSize(scaledWidth, scaledHeight);
        }
        if (this.composer) {
            this.composer.setSize(scaledWidth, scaledHeight);
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

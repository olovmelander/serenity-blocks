/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Lunara Theme — Post-processing.
 *
 * WebGPU: TSL PostProcessing with optional MRT bloom + filmic grade + vignette.
 * WebGL2: EffectComposer with UnrealBloomPass + grade ShaderPass.
 */

import * as THREE from 'three';
import * as WEBGPU from 'three/webgpu';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import {
    pass,
    mrt,
    output,
    emissive,
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
    clamp,
    fract,
    sin,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';

const LUNARA_GRADE_SHADER = {
    uniforms: {
        tDiffuse: { value: null },
        uExposure: { value: 1.05 },
        uContrast: { value: 1.06 },
        uSaturation: { value: 1.18 },
        uTintColor: { value: new THREE.Color(0.95, 0.88, 1.05) },
        uTintStrength: { value: 0.14 },
        uVignetteOffset: { value: 1.06 },
        uVignetteDarkness: { value: 0.32 },
        uGrainStrength: { value: 0.0028 },
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

        float grainNoise(vec2 uv) {
            float x = dot(uv + vec2(uTime * 0.0029, uTime * 0.0019), vec2(12.9898, 78.233));
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

            float grain = grainNoise(vUv * 110.0) * uGrainStrength;
            color += vec3(grain);
            color = clamp(color, vec3(0.0), vec3(1.0));

            gl_FragColor = vec4(color, colorSample.a);
        }
    `,
};

export class LunaraPost {
    constructor(renderer, scene, camera, params = {}) {
        this.renderer = renderer;
        this.scene = scene;
        this.camera = camera;
        this.isWebGPU = renderer?.backend?.isWebGPUBackend === true;
        this.useMRT = params.useMRT === true;
        this.resolutionScale = params.resolutionScale ?? 1.0;
        this.bloomDownsample = params.bloomDownsample ?? 0.85;
        this.size = { width: 0, height: 0 };

        this.scenePass = null;
        this.bloomNode = null;
        this.postProcessing = null;
        this.composer = null;
        this.bloomPass = null;
        this.gradePass = null;

        if (this.isWebGPU) {
            this.setupWebGPU(params);
        } else {
            this.setupWebGL(params);
        }
    }

    setupWebGPU(params) {
        this.postProcessing = new WEBGPU.PostProcessing(this.renderer);
        this.scenePass = pass(this.scene, this.camera);
        if (this.useMRT) {
            this.scenePass.setMRT(mrt({ output, emissive }));
        }

        const sceneColor = this.scenePass.getTextureNode('output');
        const bloomSource = this.useMRT ? this.scenePass.getTextureNode('emissive') : sceneColor;

        this.bloomNode = bloom(
            bloomSource,
            params.bloomStrength ?? 0.55,
            params.bloomRadius ?? 0.42,
            params.bloomThreshold ?? 0.32,
        );

        const originalSetSize = this.bloomNode.setSize.bind(this.bloomNode);
        this.bloomNode.setSize = (w, h) => {
            originalSetSize(w * this.bloomDownsample, h * this.bloomDownsample);
        };

        this.uExposure = uniform(params.exposure ?? 1.05);
        this.uContrast = uniform(params.contrast ?? 1.06);
        this.uSaturation = uniform(params.saturation ?? 1.18);
        this.uTintStrength = uniform(params.tintStrength ?? 0.14);
        this.uVignetteOffset = uniform(params.vignetteOffset ?? 1.06);
        this.uVignetteDarkness = uniform(params.vignetteDarkness ?? 0.32);
        this.uGrainStrength = uniform(params.grainStrength ?? 0.0028);
        this.uTintColor = uniform(new THREE.Color(0.95, 0.88, 1.05));
        this.uTime = uniform(0);

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
        graded = mix(vec3(luma), graded, this.uSaturation);
        graded = graded.sub(0.5).mul(this.uContrast).add(0.5);
        graded = mix(graded, graded.mul(this.uTintColor), this.uTintStrength);

        const noise = fract(sin(dot(uv.mul(110.0), vec2(12.9898, 78.233))).mul(43758.5453));
        const grain = noise.sub(0.5).mul(this.uGrainStrength);
        graded = clamp(graded.add(vec3(grain)), float(0.0), float(1.0));

        this.postProcessing.outputNode = vec4(graded, vignetteColor.w);
        this.postProcessing.needsUpdate = true;
    }

    setupWebGL(params) {
        this.composer = new EffectComposer(this.renderer);
        this.renderPass = new RenderPass(this.scene, this.camera);
        this.bloomPass = new UnrealBloomPass(
            new THREE.Vector2(window.innerWidth, window.innerHeight),
            params.bloomStrength ?? 0.55,
            params.bloomRadius ?? 0.42,
            params.bloomThreshold ?? 0.32,
        );

        this.gradePass = new ShaderPass(LUNARA_GRADE_SHADER);
        const u = this.gradePass.uniforms;
        if (params.exposure !== undefined) u.uExposure.value = params.exposure;
        if (params.contrast !== undefined) u.uContrast.value = params.contrast;
        if (params.saturation !== undefined) u.uSaturation.value = params.saturation;
        if (params.tintStrength !== undefined) u.uTintStrength.value = params.tintStrength;
        if (params.vignetteOffset !== undefined) u.uVignetteOffset.value = params.vignetteOffset;
        if (params.vignetteDarkness !== undefined) u.uVignetteDarkness.value = params.vignetteDarkness;
        if (params.grainStrength !== undefined) u.uGrainStrength.value = params.grainStrength;

        this.composer.addPass(this.renderPass);
        this.composer.addPass(this.bloomPass);
        this.composer.addPass(this.gradePass);
    }

    update({ time, bloomStrength, exposure } = {}) {
        if (time !== undefined) {
            if (this.uTime) this.uTime.value = time;
            if (this.gradePass?.uniforms?.uTime) this.gradePass.uniforms.uTime.value = time;
        }
        if (bloomStrength !== undefined) {
            if (this.bloomNode) this.bloomNode.strength.value = bloomStrength;
            if (this.bloomPass) this.bloomPass.strength = bloomStrength;
        }
        if (exposure !== undefined) {
            if (this.uExposure) this.uExposure.value = exposure;
            if (this.gradePass?.uniforms?.uExposure) this.gradePass.uniforms.uExposure.value = exposure;
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
        const w = Math.max(1, Math.round(width * this.resolutionScale));
        const h = Math.max(1, Math.round(height * this.resolutionScale));

        if (this.scenePass?.setSize) this.scenePass.setSize(w, h);
        if (this.bloomNode?._separableBlurMaterials?.length) this.bloomNode.setSize(w, h);
        if (this.composer) this.composer.setSize(w, h);
        if (this.bloomPass?.setSize) this.bloomPass.setSize(w, h);
    }

    dispose() {
        if (this.scenePass?.dispose) this.scenePass.dispose();
        if (this.bloomNode?.dispose) this.bloomNode.dispose();
        if (this.postProcessing?.dispose) this.postProcessing.dispose();
        if (this.composer?.dispose) this.composer.dispose();
        this.scenePass = null;
        this.bloomNode = null;
        this.postProcessing = null;
        this.composer = null;
        this.bloomPass = null;
        this.gradePass = null;
    }
}

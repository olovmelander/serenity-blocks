/**
 * Moonrise Summit - Post Processing
 *
 * Thin wrapper around EffectComposer that adds:
 *   - RenderPass (scene → screen)
 *   - UnrealBloomPass (threshold 0.4 so only bright emissives bloom)
 *   - ShaderPass (Ghibli grade: vignette + chromatic aberration +
 *     cool-violet shadow lift + film grain)
 *
 * Works with both WebGLRenderer and WebGPURenderer.
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

const ghibliGradeShader = {
    uniforms: {
        tDiffuse: { value: null },
        uTime: { value: 0 },
        uVignette: { value: 0.45 },
        uCAStrength: { value: 0.0008 },
        uGradeLift: { value: new THREE.Vector3(0.018, 0.025, 0.055) },
        uGradeGain: { value: new THREE.Vector3(1.0, 1.01, 1.035) },
        uSaturation: { value: 1.08 },
        uGrainAmount: { value: 0.025 },
    },
    vertexShader: /* glsl */`
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: /* glsl */`
        uniform sampler2D tDiffuse;
        uniform float uTime;
        uniform float uVignette;
        uniform float uCAStrength;
        uniform vec3 uGradeLift;
        uniform vec3 uGradeGain;
        uniform float uSaturation;
        uniform float uGrainAmount;

        varying vec2 vUv;

        float rand(vec2 co) {
            return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
        }

        void main() {
            vec2 uv = vUv;
            vec2 center = uv - 0.5;
            float dist = length(center);

            // Chromatic aberration (radial, scales with distance from center)
            vec2 caDir = center * uCAStrength * (1.0 + dist * 2.0);
            float r = texture2D(tDiffuse, uv - caDir).r;
            float g = texture2D(tDiffuse, uv).g;
            float b = texture2D(tDiffuse, uv + caDir).b;
            vec3 col = vec3(r, g, b);

            // Lift shadows toward indigo, gain highlights toward cool teal
            col = col + uGradeLift * (1.0 - col);
            col = col * uGradeGain;
            float luma = dot(col, vec3(0.299, 0.587, 0.114));
            col = mix(vec3(luma), col, uSaturation);

            // Subtle time-animated film grain
            float grain = (rand(uv + fract(uTime * 0.1)) - 0.5) * uGrainAmount;
            col += grain;

            // Vignette (cinematic edge darkening)
            float vignette = 1.0 - dist * dist * uVignette * 2.4;
            vignette = clamp(vignette, 0.0, 1.0);
            col *= vignette;

            gl_FragColor = vec4(col, 1.0);
        }
    `,
};

export class MoonriseSummitPost {
    constructor(renderer, scene, camera, params = {}) {
        this.renderer = renderer;
        this.scene = scene;
        this.camera = camera;

        const width = window.innerWidth;
        const height = window.innerHeight;

        this.composer = new EffectComposer(renderer);
        this.composer.setSize(width, height);

        this.renderPass = new RenderPass(scene, camera);
        this.composer.addPass(this.renderPass);

        this.bloomPass = new UnrealBloomPass(
            new THREE.Vector2(width, height),
            params.bloomStrength ?? 0.85,
            params.bloomRadius ?? 0.7,
            params.bloomThreshold ?? 0.4,
        );
        this.composer.addPass(this.bloomPass);

        this.ghibliPass = new ShaderPass(ghibliGradeShader);
        if (params.vignette !== undefined) this.ghibliPass.uniforms.uVignette.value = params.vignette;
        if (params.grain !== undefined) this.ghibliPass.uniforms.uGrainAmount.value = params.grain;
        if (params.ca !== undefined) this.ghibliPass.uniforms.uCAStrength.value = params.ca;
        this.composer.addPass(this.ghibliPass);
    }

    setSize(width, height) {
        this.composer.setSize(width, height);
        if (this.bloomPass) this.bloomPass.setSize(width, height);
    }

    updateTime(time) {
        this.ghibliPass.uniforms.uTime.value = time;
    }

    updateParams(params = {}) {
        if (params.bloomStrength !== undefined) this.bloomPass.strength = params.bloomStrength;
        if (params.bloomRadius !== undefined) this.bloomPass.radius = params.bloomRadius;
        if (params.bloomThreshold !== undefined) this.bloomPass.threshold = params.bloomThreshold;
        if (params.vignette !== undefined) this.ghibliPass.uniforms.uVignette.value = params.vignette;
        if (params.grain !== undefined) this.ghibliPass.uniforms.uGrainAmount.value = params.grain;
        if (params.ca !== undefined) this.ghibliPass.uniforms.uCAStrength.value = params.ca;
    }

    render() {
        this.composer.render();
    }

    dispose() {
        if (this.composer) {
            this.composer.passes.forEach((pass) => {
                if (typeof pass.dispose === 'function') pass.dispose();
            });
            if (typeof this.composer.dispose === 'function') this.composer.dispose();
            this.composer = null;
        }
    }
}

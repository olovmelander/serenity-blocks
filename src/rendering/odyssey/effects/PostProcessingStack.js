/**
 * @fileoverview PostProcessingStack - Modular cinematic post-processing
 *
 * Enhanced post-processing pipeline with:
 * - Chromatic Aberration (speed/intensity moments)
 * - Dynamic Vignette (atmosphere/focus)
 * - Film Grain (cinematic texture)
 * - Integration with existing UnrealBloomPass
 *
 * All effects are toggleable per quality preset.
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

// ═══════════════════════════════════════════════════════════════════════════════
// CHROMATIC ABERRATION SHADER
// ═══════════════════════════════════════════════════════════════════════════════

const ChromaticAberrationShader = {
    uniforms: {
        tDiffuse: { value: null },
        uStrength: { value: 0.003 },
        uEnabled: { value: 1.0 },
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
        uniform float uStrength;
        uniform float uEnabled;
        varying vec2 vUv;
        
        void main() {
            if (uEnabled < 0.5) {
                gl_FragColor = texture2D(tDiffuse, vUv);
                return;
            }
            
            vec2 center = vUv - 0.5;
            float dist = length(center);
            
            // RGB split based on distance from center
            vec2 offset = center * uStrength * dist;
            
            float r = texture2D(tDiffuse, vUv + offset).r;
            float g = texture2D(tDiffuse, vUv).g;
            float b = texture2D(tDiffuse, vUv - offset).b;
            
            gl_FragColor = vec4(r, g, b, 1.0);
        }
    `,
};

// ═══════════════════════════════════════════════════════════════════════════════
// DYNAMIC VIGNETTE SHADER
// ═══════════════════════════════════════════════════════════════════════════════

const VignetteShader = {
    uniforms: {
        tDiffuse: { value: null },
        uIntensity: { value: 0.4 },
        uSmoothness: { value: 0.5 },
        uEnabled: { value: 1.0 },
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
        uniform float uIntensity;
        uniform float uSmoothness;
        uniform float uEnabled;
        varying vec2 vUv;
        
        void main() {
            vec4 color = texture2D(tDiffuse, vUv);
            
            if (uEnabled < 0.5) {
                gl_FragColor = color;
                return;
            }
            
            vec2 center = vUv - 0.5;
            float dist = length(center) * 2.0;
            
            // Smooth vignette falloff
            float vignette = 1.0 - smoothstep(1.0 - uSmoothness, 1.0, dist * uIntensity);
            
            color.rgb *= vignette;
            gl_FragColor = color;
        }
    `,
};

// ═══════════════════════════════════════════════════════════════════════════════
// FILM GRAIN SHADER
// ═══════════════════════════════════════════════════════════════════════════════

const FilmGrainShader = {
    uniforms: {
        tDiffuse: { value: null },
        uTime: { value: 0 },
        uIntensity: { value: 0.08 },
        uEnabled: { value: 1.0 },
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
        uniform float uIntensity;
        uniform float uEnabled;
        varying vec2 vUv;
        
        // Simple noise function
        float random(vec2 co) {
            return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453);
        }
        
        void main() {
            vec4 color = texture2D(tDiffuse, vUv);
            
            if (uEnabled < 0.5) {
                gl_FragColor = color;
                return;
            }
            
            // Animated grain
            float grain = random(vUv + fract(uTime * 0.1)) * 2.0 - 1.0;
            
            // Apply grain with luminance awareness (less grain in bright areas)
            float luminance = dot(color.rgb, vec3(0.299, 0.587, 0.114));
            float grainAmount = uIntensity * (1.0 - luminance * 0.5);
            
            color.rgb += grain * grainAmount;
            
            gl_FragColor = color;
        }
    `,
};

// ═══════════════════════════════════════════════════════════════════════════════
// POST-PROCESSING STACK CLASS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Quality preset configurations for post-processing
 */
const POSTFX_QUALITY = {
    Minimal: {
        bloom: false,
        chromatic: false,
        vignette: false,
        filmGrain: false,
    },
    Low: {
        bloom: true,
        bloomStrength: 0.4,
        chromatic: false,
        vignette: true,
        vignetteIntensity: 0.3,
        filmGrain: false,
    },
    Medium: {
        bloom: true,
        bloomStrength: 0.5,
        chromatic: false,
        vignette: true,
        vignetteIntensity: 0.35,
        filmGrain: false,
    },
    High: {
        bloom: true,
        bloomStrength: 0.6,
        chromatic: true,
        chromaticStrength: 0.002,
        vignette: true,
        vignetteIntensity: 0.4,
        filmGrain: false,
    },
    Ultra: {
        bloom: true,
        bloomStrength: 0.7,
        chromatic: true,
        chromaticStrength: 0.003,
        vignette: true,
        vignetteIntensity: 0.45,
        filmGrain: true,
        filmGrainIntensity: 0.06,
    },
    Extreme: {
        bloom: true,
        bloomStrength: 0.8,
        chromatic: true,
        chromaticStrength: 0.004,
        vignette: true,
        vignetteIntensity: 0.5,
        filmGrain: true,
        filmGrainIntensity: 0.08,
    },
};

/**
 * PostProcessingStack - Modular cinematic post-processing
 */
export class PostProcessingStack {
    /**
     * @param {THREE.WebGLRenderer} renderer
     * @param {THREE.Scene} scene
     * @param {THREE.Camera} camera
     * @param {string} quality - Quality preset name
     */
    constructor(renderer, scene, camera, quality = 'High') {
        this.renderer = renderer;
        this.scene = scene;
        this.camera = camera;

        this.composer = null;
        this.passes = {};
        this.time = 0;

        // Get quality settings
        this.qualitySettings = POSTFX_QUALITY[quality] || POSTFX_QUALITY.High;

        // Dynamic effect state (for transition intensification)
        this.dynamicState = {
            chromaticBoost: 0,
            vignetteBoost: 0,
        };

        this.initialize();

        console.log('[PostProcessingStack] Initialized with quality:', quality);
    }

    /**
     * Initialize the effect composer and passes
     */
    initialize() {
        const width = this.renderer.domElement.clientWidth;
        const height = this.renderer.domElement.clientHeight;

        this.composer = new EffectComposer(this.renderer);

        // 1. Render pass (base scene)
        const renderPass = new RenderPass(this.scene, this.camera);
        this.composer.addPass(renderPass);
        this.passes.render = renderPass;

        // 2. Bloom pass
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

        // 3. Chromatic aberration pass
        if (this.qualitySettings.chromatic) {
            const chromaticPass = new ShaderPass(ChromaticAberrationShader);
            chromaticPass.uniforms.uStrength.value = this.qualitySettings.chromaticStrength || 0.003;
            this.composer.addPass(chromaticPass);
            this.passes.chromatic = chromaticPass;
        }

        // 4. Vignette pass
        if (this.qualitySettings.vignette) {
            const vignettePass = new ShaderPass(VignetteShader);
            vignettePass.uniforms.uIntensity.value = this.qualitySettings.vignetteIntensity || 0.4;
            this.composer.addPass(vignettePass);
            this.passes.vignette = vignettePass;
        }

        // 5. Film grain pass (last for subtle overlay)
        if (this.qualitySettings.filmGrain) {
            const grainPass = new ShaderPass(FilmGrainShader);
            grainPass.uniforms.uIntensity.value = this.qualitySettings.filmGrainIntensity || 0.08;
            this.composer.addPass(grainPass);
            this.passes.grain = grainPass;
        }
    }

    /**
     * Update effects each frame
     * @param {number} deltaTime
     */
    update(deltaTime) {
        this.time += deltaTime;

        // Update film grain time
        if (this.passes.grain) {
            this.passes.grain.uniforms.uTime.value = this.time;
        }

        // Apply dynamic boosts (decay over time)
        if (this.passes.chromatic && this.dynamicState.chromaticBoost > 0) {
            const baseStrength = this.qualitySettings.chromaticStrength || 0.003;
            this.passes.chromatic.uniforms.uStrength.value = baseStrength + this.dynamicState.chromaticBoost;
            this.dynamicState.chromaticBoost *= 0.95; // Decay
        }

        if (this.passes.vignette && this.dynamicState.vignetteBoost > 0) {
            const baseIntensity = this.qualitySettings.vignetteIntensity || 0.4;
            this.passes.vignette.uniforms.uIntensity.value = baseIntensity + this.dynamicState.vignetteBoost;
            this.dynamicState.vignetteBoost *= 0.95; // Decay
        }
    }

    /**
     * Render the post-processed scene
     */
    render() {
        this.composer.render();
    }

    /**
     * Trigger transition effect (intensifies chromatic + vignette briefly)
     */
    triggerTransitionEffect() {
        this.dynamicState.chromaticBoost = 0.01; // Extra chromatic split
        this.dynamicState.vignetteBoost = 0.2; // Extra vignette darkness
    }

    /**
     * Set chromatic aberration strength directly
     * @param {number} strength
     */
    setChromaticStrength(strength) {
        if (this.passes.chromatic) {
            this.passes.chromatic.uniforms.uStrength.value = strength;
        }
    }

    /**
     * Set vignette intensity directly
     * @param {number} intensity
     */
    setVignetteIntensity(intensity) {
        if (this.passes.vignette) {
            this.passes.vignette.uniforms.uIntensity.value = intensity;
        }
    }

    /**
     * Handle window resize
     * @param {number} width
     * @param {number} height
     */
    resize(width, height) {
        this.composer.setSize(width, height);
        if (this.passes.bloom) {
            this.passes.bloom.resolution.set(width, height);
        }
    }

    /**
     * Dispose of all resources
     */
    dispose() {
        this.composer?.dispose();
        console.log('[PostProcessingStack] Disposed');
    }
}

export default PostProcessingStack;
